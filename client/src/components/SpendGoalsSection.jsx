import { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api.js';
import { formatCurrency } from '../lib/stages.js';
import { relativeTime } from '../lib/leads.js';
import { Eyebrow, Input, Button } from './ui.jsx';

const HISTORY_MONTHS = 12;

// First-of-month date string (YYYY-MM-DD), `offset` months from the current one.
function monthKey(offset = 0) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function monthLabel(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

// Per-client monthly revenue (Everflow) vs. a goal Panel sets, with trailing
// history so past months inform the next goal. Self-fetching, same shape as
// AdTrackerSection.jsx. Actuals are cached (client_spend_actuals), synced via
// the everflow-sync Edge Function rather than queried live — see the
// migration's header comment for why.
export default function SpendGoalsSection({ lead }) {
  const [goals, setGoals] = useState(null);
  const [actuals, setActuals] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    Promise.all([api.listSpendGoals(lead.id), api.listSpendActuals(lead.id)])
      .then(([g, a]) => {
        setGoals(g);
        setActuals(a);
      })
      .catch(() => {
        setGoals([]);
        setActuals([]);
      });
  }, [lead.id]);

  useEffect(() => {
    load();
  }, [load]);

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

  if (goals === null || actuals === null) return null;

  const goalByMonth = new Map(goals.map((g) => [g.month, g]));
  const actualByMonth = new Map(actuals.map((a) => [a.month, a]));
  const months = Array.from({ length: HISTORY_MONTHS }, (_, i) => monthKey(-i));
  const [currentMonth, ...historyMonths] = months;

  const mostRecentSync = actuals.reduce(
    (max, a) => (a.synced_at && (!max || a.synced_at > max) ? a.synced_at : max),
    null,
  );
  const canSync = !!lead.everflow_advertiser_id;

  return (
    <div className="px-5 py-4 border-b border-hairline">
      <div className="flex items-center justify-between mb-3">
        <Eyebrow>Spend &amp; Goals</Eyebrow>
        <div className="flex items-center gap-2">
          {mostRecentSync && (
            <span className="text-text-disabled text-[11px]">synced {relativeTime(mostRecentSync)}</span>
          )}
          <Button
            variant="ghost"
            disabled={busy || !canSync}
            title={canSync ? 'Pull latest revenue from Everflow' : 'Add an Everflow Advertiser ID first'}
            onClick={() => after(() => api.syncSpendActuals(lead.id, { month: currentMonth }))}
          >
            ↻ Sync from Everflow
          </Button>
        </div>
      </div>

      {!canSync && actuals.length === 0 && (
        <div className="text-text-disabled text-[12px] mb-3">
          Add an Everflow Advertiser ID above, then sync to pull spend data.
        </div>
      )}

      <MonthRow
        month={currentMonth}
        goal={goalByMonth.get(currentMonth)}
        actual={actualByMonth.get(currentMonth)}
        busy={busy}
        onSetGoal={(amount) => after(() => api.upsertSpendGoal(lead.id, currentMonth, amount))}
        prominent
      />

      {historyMonths.length > 0 && (
        <div className="mt-2 max-h-[320px] overflow-y-auto">
          {historyMonths.map((month) => (
            <MonthRow
              key={month}
              month={month}
              goal={goalByMonth.get(month)}
              actual={actualByMonth.get(month)}
              busy={busy}
              onSetGoal={(amount) => after(() => api.upsertSpendGoal(lead.id, month, amount))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MonthRow({ month, goal, actual, busy, onSetGoal, prominent }) {
  const goalAmount = goal?.goal_amount ?? null;
  const actualAmount = actual?.revenue ?? null;
  const pct =
    goalAmount && actualAmount != null ? Math.min(100, Math.round((actualAmount / goalAmount) * 100)) : 0;

  return (
    <div className={prominent ? 'py-2' : 'py-1.5 border-t border-hairline'}>
      <div className="flex items-center justify-between gap-2">
        <span className={prominent ? 'text-text-primary text-[14px]' : 'text-text-secondary text-[12px]'}>
          {monthLabel(month)}
        </span>
        <span
          className={
            prominent
              ? 'font-mono text-text-primary text-[16px]'
              : 'font-mono text-text-secondary text-[12px]'
          }
        >
          {actualAmount != null ? formatCurrency(actualAmount) : 'Not synced yet'}
        </span>
      </div>
      <div className="flex items-center gap-2 mt-1">
        <span className="text-text-muted text-[11px] shrink-0">Goal</span>
        <Input
          type="number"
          defaultValue={goalAmount ?? ''}
          onBlur={(e) => e.target.value !== '' && onSetGoal(e.target.value)}
          placeholder="0"
          disabled={busy}
          className="w-28 font-mono py-1"
        />
      </div>
      {goalAmount ? (
        <div className="h-[3px] bg-hairline mt-1.5">
          <div
            className={`h-[3px] ${pct >= 100 ? 'bg-signal' : 'bg-[rgba(255,255,255,0.35)]'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}
