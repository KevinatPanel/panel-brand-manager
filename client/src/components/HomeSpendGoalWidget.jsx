import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { formatCurrency } from '../lib/stages.js';
import { useLeads } from '../state/LeadsContext.jsx';
import { Eyebrow, IconButton } from './ui.jsx';
import HomeSpendGoalModal from './HomeSpendGoalModal.jsx';

// First-of-month date string (YYYY-MM-01) for the current month.
function monthKey() {
  const d = new Date();
  d.setDate(1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

// Fires `revealed = true` once, on mount (same one-shot approach as
// SpendGoalWidget.jsx's useRevealed — duplicated per this codebase's
// convention of keeping small per-component helpers local).
function useRevealed() {
  const ref = useRef(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setRevealed(true);
          observer.disconnect();
        }
      },
      { threshold: 0.2 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return [ref, revealed];
}

// Home dashboard widget: current-month spend vs. goal summed across every
// current client (is_client), with an expand button to a per-client
// breakdown (HomeSpendGoalModal) and a sync button to pull fresh numbers
// from Everflow for every client on demand. Goal editing still stays on
// each client's own profile page (SpendGoalModal).
export default function HomeSpendGoalWidget() {
  const { leads } = useLeads();
  const [goals, setGoals] = useState(null);
  const [actuals, setActuals] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ref, revealed] = useRevealed();

  const clients = leads.filter((l) => l.is_client);
  const clientIds = clients.map((c) => c.id);
  const month = monthKey();

  const load = () => {
    Promise.all([api.listSpendGoalsForMonth(clientIds, month), api.listSpendActualsForMonth(clientIds, month)])
      .then(([g, a]) => {
        setGoals(g);
        setActuals(a);
      })
      .catch(() => {
        setGoals([]);
        setActuals([]);
      });
  };

  // clientIds is a fresh array each render — join to a stable dep key.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [clientIds.join(','), month]);

  async function syncAll() {
    setBusy(true);
    try {
      await api.syncAllSpendActuals();
      load();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  const loading = goals === null || actuals === null;
  const totalGoal = (goals ?? []).reduce((sum, g) => sum + (g.goal_amount ?? 0), 0);
  const totalActual = (actuals ?? []).reduce((sum, a) => sum + (a.revenue ?? 0), 0);
  const pct = !loading && totalGoal ? Math.round((totalActual / totalGoal) * 100) : null;
  const fillPct = pct != null ? Math.min(100, Math.max(0, pct)) : 0;

  return (
    <div ref={ref} className="border border-hairline p-5 max-w-md">
      <div className="flex items-center justify-between mb-3">
        <Eyebrow>Spend vs. goal — all clients</Eyebrow>
        <div className="flex items-center gap-1">
          <IconButton
            icon="sync"
            title="Sync all clients from Everflow"
            aria-label="Sync all clients from Everflow"
            onClick={syncAll}
            disabled={loading || busy}
          />
          <IconButton
            icon="expand"
            title="Open per-client breakdown"
            aria-label="Open per-client breakdown"
            onClick={() => setExpanded(true)}
            disabled={loading || busy}
          />
        </div>
      </div>

      {loading ? (
        <div className="text-text-secondary text-[13px]">Loading…</div>
      ) : clients.length === 0 ? (
        <div className="text-text-disabled text-[13px]">No current clients yet.</div>
      ) : totalGoal === 0 ? (
        <div className="text-text-disabled text-[13px]">No goals set for this month yet.</div>
      ) : (
        <div>
          <div className="flex items-baseline gap-2 mb-2">
            <span className="font-mono font-semibold text-text-primary text-[22px]">
              {formatCurrency(totalActual)}
            </span>
            <span className="text-text-secondary text-[13px]">
              of {formatCurrency(totalGoal)} goal{pct != null ? ` (${pct}%)` : ''}
            </span>
          </div>
          <div className="relative h-3 bg-card-inset border border-hairline overflow-hidden">
            <div
              className="absolute inset-y-0 left-0 bg-signal transition-[width] duration-700 ease-out"
              style={{ width: revealed ? `${fillPct}%` : '0%' }}
            />
          </div>
        </div>
      )}

      {expanded && (
        <HomeSpendGoalModal
          clients={clients}
          goals={goals}
          actuals={actuals}
          month={month}
          onClose={() => setExpanded(false)}
        />
      )}
    </div>
  );
}
