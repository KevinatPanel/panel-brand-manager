import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { formatCurrency } from '../lib/stages.js';
import { Eyebrow, IconButton } from './ui.jsx';
import SpendGoalModal from './SpendGoalModal.jsx';

const PAST_MONTHS = 2; // + the current month = 3 actual-vs-goal rows
const FUTURE_MONTHS = 2; // goal-only rows

// First-of-month date string (YYYY-MM-DD), `offset` months from the current one.
function monthKey(offset = 0) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function monthShortLabel(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short' });
}

// Fires `revealed = true` once the element scrolls into view (or already is,
// on mount), then stops observing — a one-shot reveal trigger for the bar-fill
// animation. No animation library in this codebase; this mirrors the
// dependency-free, hand-rolled approach AnimatedNumber.jsx uses for its
// requestAnimationFrame count-up.
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

// Compact at-a-glance spend-vs-goal widget for the client page's right
// sidebar: the last 2 months + the current month (actual vs. goal), then the
// next 2 months (goal only — nothing synced yet). Read-only itself; the
// expand icon opens SpendGoalModal for goal editing + the Everflow sync
// trigger.
export default function SpendGoalWidget({ lead }) {
  const [goals, setGoals] = useState(null);
  const [actuals, setActuals] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [ref, revealed] = useRevealed();

  const load = () => {
    Promise.all([api.listSpendGoals(lead.id), api.listSpendActuals(lead.id)])
      .then(([g, a]) => {
        setGoals(g);
        setActuals(a);
      })
      .catch(() => {
        setGoals([]);
        setActuals([]);
      });
  };

  useEffect(load, [lead.id]);

  const loading = goals === null || actuals === null;
  const goalByMonth = new Map((goals ?? []).map((g) => [g.month, g]));
  const actualByMonth = new Map((actuals ?? []).map((a) => [a.month, a]));
  const months = Array.from(
    { length: PAST_MONTHS + 1 + FUTURE_MONTHS },
    (_, i) => monthKey(i - PAST_MONTHS),
  );

  // The wrapper (and its ref) always mounts, even while loading — the reveal
  // observer fires once on mount, so if this div only appeared after data
  // arrived, the fill-in animation would never trigger.
  return (
    <div ref={ref} className="px-5 py-4">
      <div className="flex items-center justify-between mb-3">
        <Eyebrow>Spend vs. goal</Eyebrow>
        <IconButton
          icon="expand"
          title="Open full breakdown"
          aria-label="Open full breakdown"
          onClick={() => setExpanded(true)}
        />
      </div>
      {!loading && (
        <div className="space-y-2.5">
          {months.map((month, i) => (
            <MonthGoalRow
              key={month}
              label={monthShortLabel(month)}
              isCurrent={i === PAST_MONTHS}
              goalAmount={goalByMonth.get(month)?.goal_amount ?? null}
              actualAmount={actualByMonth.get(month)?.revenue ?? null}
              revealed={revealed}
              delayMs={i * 80}
            />
          ))}
        </div>
      )}
      {expanded && (
        <SpendGoalModal
          lead={lead}
          onClose={() => {
            setExpanded(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function MonthGoalRow({ label, isCurrent, goalAmount, actualAmount, revealed, delayMs }) {
  const hasActual = actualAmount != null;
  const pct = hasActual && goalAmount ? Math.round((actualAmount / goalAmount) * 100) : null;
  const fillPct = pct != null ? Math.min(100, Math.max(0, pct)) : 0;

  return (
    <div className="flex items-center gap-3">
      <span className={`text-[12px] w-8 shrink-0 ${isCurrent ? 'text-text-primary font-semibold' : 'text-text-secondary'}`}>
        {label}
      </span>
      <div className="relative flex-1 h-9 bg-card-inset border border-hairline overflow-hidden">
        {hasActual && (
          <div
            className={`absolute inset-y-0 left-0 transition-[width] duration-700 ease-out ${
              isCurrent ? 'bg-signal' : 'bg-[rgba(255,255,255,0.35)]'
            }`}
            style={{ width: revealed ? `${fillPct}%` : '0%', transitionDelay: `${delayMs}ms` }}
          />
        )}
        <div className="relative h-full flex items-center px-2.5">
          {hasActual ? (
            <span className="font-mono font-medium text-text-primary text-[13px]">
              {formatCurrency(actualAmount)}{pct != null ? ` (${pct}%)` : ''}
            </span>
          ) : (
            <span className="text-text-disabled text-[12px]">Not started</span>
          )}
        </div>
      </div>
      <span className="font-mono font-medium text-text-secondary text-[13px] shrink-0 text-right">
        {goalAmount != null ? formatCurrency(goalAmount) : '—'}
      </span>
    </div>
  );
}
