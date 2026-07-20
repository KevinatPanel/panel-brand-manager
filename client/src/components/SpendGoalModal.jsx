import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { formatCurrency } from '../lib/stages.js';
import { relativeTime } from '../lib/leads.js';
import { Modal } from './Overlay.jsx';
import { Input, IconButton } from './ui.jsx';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// First-of-month date string (YYYY-MM-DD), `offset` months from the current one.
function monthKey(offset = 0) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

// YYYY-MM-01 for a given calendar year + 1-indexed month.
function yearMonthKey(year, month) {
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

// Fires `revealed = true` once, on mount (same one-shot approach as
// SpendGoalWidget.jsx's useRevealed — duplicated rather than shared since
// this codebase keeps small per-component helpers local, not a new
// lib/hooks module for two closely-coupled sibling files).
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
      { threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return [ref, revealed];
}

// Expanded Spend vs. Goal breakdown: full month history (as far back as the
// client has synced actuals) plus the rest of the current year for forward
// goal planning, with editable goals and the Everflow sync trigger — the
// capability the compact SpendGoalWidget intentionally left out.
export default function SpendGoalModal({ lead, onClose }) {
  const [goals, setGoals] = useState(null);
  const [actuals, setActuals] = useState(null);
  const [busy, setBusy] = useState(false);
  const [selectedYear, setSelectedYear] = useState(() => new Date().getFullYear());
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

  async function after(fn) {
    setBusy(true);
    try {
      await fn();
      load();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  const loading = goals === null || actuals === null;
  const canSync = !!lead.everflow_advertiser_id;
  const mostRecentSync = loading
    ? null
    : actuals.reduce((max, a) => (a.synced_at && (!max || a.synced_at > max) ? a.synced_at : max), null);

  const currentMonth = monthKey(0);
  const nowYear = new Date().getFullYear();

  // Every year that has a goal or an actual, plus the current year always —
  // most recent first, so the year you almost always want is the default tab.
  const years = loading
    ? [nowYear]
    : [...new Set([nowYear, ...goals.map((g) => Number(g.month.slice(0, 4))), ...actuals.map((a) => Number(a.month.slice(0, 4)))])].sort(
        (a, b) => b - a,
      );

  // Full calendar year for whichever year is selected, Jan at top through
  // Dec at bottom — months with neither an actual nor a goal just render as
  // empty/"Not started" rows, same fallback as the compact widget.
  const months = Array.from({ length: 12 }, (_, i) => yearMonthKey(selectedYear, i + 1));

  const goalByMonth = new Map((goals ?? []).map((g) => [g.month, g]));
  const actualByMonth = new Map((actuals ?? []).map((a) => [a.month, a]));

  return (
    <Modal title="Spend vs. goal" onClose={onClose} width="max-w-2xl">
      <div ref={ref} className="flex items-center justify-between mb-4">
        <div className="text-text-secondary text-[13px]">{lead.company_name}</div>
        <div className="flex items-center gap-2">
          {mostRecentSync && (
            <span className="text-text-disabled text-[11px]">synced {relativeTime(mostRecentSync)}</span>
          )}
          <IconButton
            icon="sync"
            disabled={busy || !canSync}
            title={canSync ? 'Pull all historical revenue from Everflow' : 'Add an Everflow Advertiser ID first'}
            aria-label="Sync from Everflow"
            onClick={() => after(() => api.syncSpendActuals(lead.id))}
          />
        </div>
      </div>

      {!loading && (
        <div className="flex items-center gap-1.5 mb-4">
          {years.map((y) => (
            <button
              key={y}
              onClick={() => setSelectedYear(y)}
              className={`px-2.5 py-1 font-mono font-medium text-[12px] border transition-colors ${
                y === selectedYear
                  ? 'border-signal/50 text-signal'
                  : 'border-hairline text-text-muted hover:text-text-primary hover:bg-card-hover'
              }`}
            >
              {y}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="text-text-secondary text-[13px]">Loading…</div>
      ) : (
        <div className="max-h-[60vh] overflow-y-auto space-y-2.5 pr-1">
          {months.map((month, i) => (
            <MonthRow
              key={month}
              label={MONTH_NAMES[i]}
              isCurrent={month === currentMonth}
              goalAmount={goalByMonth.get(month)?.goal_amount ?? null}
              actualAmount={actualByMonth.get(month)?.revenue ?? null}
              busy={busy}
              revealed={revealed}
              delayMs={Math.min(i * 60, 500)}
              onSetGoal={(amount) => after(() => api.upsertSpendGoal(lead.id, month, amount))}
            />
          ))}
        </div>
      )}
    </Modal>
  );
}

function MonthRow({ label, isCurrent, goalAmount, actualAmount, busy, revealed, delayMs, onSetGoal }) {
  const hasActual = actualAmount != null;
  const pct = hasActual && goalAmount ? Math.round((actualAmount / goalAmount) * 100) : null;
  const fillPct = pct != null ? Math.min(100, Math.max(0, pct)) : 0;
  const shownFillPct = revealed ? fillPct : 0;
  const valueLabel = hasActual ? `${formatCurrency(actualAmount)}${pct != null ? ` (${pct}%)` : ''}` : null;

  return (
    <div className="flex items-center gap-3">
      <span
        className={`text-[12px] w-8 shrink-0 ${
          isCurrent ? 'text-text-primary font-semibold' : 'text-text-secondary'
        }`}
      >
        {label}
      </span>
      <div className="relative flex-1 h-9 bg-card-inset border border-hairline overflow-hidden">
        {hasActual && (
          <div
            className={`absolute inset-y-0 left-0 transition-[width] duration-700 ease-out ${
              isCurrent ? 'bg-signal' : 'bg-[rgba(255,255,255,0.35)]'
            }`}
            style={{ width: `${shownFillPct}%`, transitionDelay: `${delayMs}ms` }}
          />
        )}
        <div className="relative h-full flex items-center px-2.5">
          {hasActual ? (
            <span className="font-mono font-medium text-text-primary text-[13px]">{valueLabel}</span>
          ) : (
            <span className="text-text-disabled text-[12px]">Not started</span>
          )}
        </div>
        {/* Signal Green fails contrast under white text (~1.4:1) — a dark
            duplicate of the label, clipped to exactly the fill's width,
            swaps the color only where it sits over the green. */}
        {hasActual && isCurrent && (
          <div
            className="absolute inset-0 flex items-center px-2.5 pointer-events-none transition-[clip-path] duration-700 ease-out"
            style={{ clipPath: `inset(0 ${100 - shownFillPct}% 0 0)`, transitionDelay: `${delayMs}ms` }}
          >
            <span className="font-mono font-medium text-space text-[13px] whitespace-nowrap">{valueLabel}</span>
          </div>
        )}
      </div>
      <GoalInput goalAmount={goalAmount} busy={busy} onSetGoal={onSetGoal} />
    </div>
  );
}

// Goal amount, shown formatted as currency ($8,000) once set. Switches to a
// plain digit-entry field on focus so typing isn't fighting formatting, then
// reformats + commits on blur.
function GoalInput({ goalAmount, busy, onSetGoal }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const displayValue = editing ? draft : goalAmount != null ? formatCurrency(goalAmount) : '';

  return (
    // Width lives on this wrapper, not the Input itself — Input's own base
    // classes include `w-full`, which (same specificity, later in Tailwind's
    // generated stylesheet) wins over a plain `w-28` passed via className,
    // stretching the field to fill the row instead of staying narrow.
    <div className="w-28 shrink-0">
      <Input
        type="text"
        inputMode="numeric"
        value={displayValue}
        onFocus={() => {
          setDraft(goalAmount != null ? String(goalAmount) : '');
          setEditing(true);
        }}
        onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ''))}
        onBlur={() => {
          setEditing(false);
          if (draft !== '') onSetGoal(draft);
        }}
        placeholder="$0"
        disabled={busy}
        className="font-mono py-1.5"
      />
    </div>
  );
}
