import { useState } from 'react';
import { api } from '../lib/api.js';
import { STAGE_LABELS, formatCurrency } from '../lib/stages.js';
import { fmtDateOnly, todayInput, normalizeDateInput, daysBetween } from '../lib/dates.js';

// The board sizes itself with calc(100vh - topOffset), so anything below it has
// to be accounted for exactly or it lands off-screen. OutreachView subtracts
// these, and the drawer renders at exactly the same height — one source of
// truth for both.
export const DRAWER_HEADER = '2.75rem';

// Measured against the rendered rows (29px head / 41px row at a 16px root).
const HEAD_H = '1.8125rem';
const ROW_H = '2.5625rem';
const BODY_MAX = '40vh';

// Fit the rows rather than always claiming 40vh — a single parked deal
// shouldn't leave a screen-height void under it. Caps at 40vh and scrolls
// beyond that.
export const drawerBody = (rowCount) =>
  `min(${BODY_MAX}, calc(${HEAD_H} + ${rowCount} * ${ROW_H}))`;

const GRID_COLS = '1.4fr 1fr 0.8fr 1.1fr 1.6fr auto';

// How many days until a deal comes back. Both dates are anchored at local noon
// so the count is exact whole days regardless of zone.
const daysUntil = (dateStr) =>
  daysBetween(normalizeDateInput(todayInput()), normalizeDateInput(dateStr));

// The parked half of the pipeline, gathered in one place — the board shows
// snoozed deals only scattered across their stage columns (and only when the
// "Show snoozed" toggle is on), which answers "is this one parked?" but not
// "what did I park, and when does it come back?".
//
// Lists actively-snoozed deals only, so the count always matches the toolbar
// toggle's. A deal whose date has arrived is already back on the board with a
// "Snooze ended" chip, so it leaves this list the moment it wakes.
// `open` is controlled by OutreachView rather than held here: the board sizes
// itself off a calc() that has to shrink by exactly this drawer's height, so
// both need to read the same flag.
export default function SnoozedDrawer({ deals, open, onToggle, onOpenDeal, onRefresh }) {
  const [busyId, setBusyId] = useState(null);

  async function wakeNow(id) {
    setBusyId(id);
    try {
      await api.updateDeal(id, { snoozed_until: null, snooze_note: null });
      await onRefresh();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusyId(null);
    }
  }

  // Soonest wake first — the ones about to come back are the ones worth
  // reading. Plain string compare: both are canonical "YYYY-MM-DD".
  const sorted = [...deals].sort((a, b) => (a.snoozed_until < b.snoozed_until ? -1 : 1));

  return (
    <div className="border-t border-hairline">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-6 text-text-secondary hover:text-text-primary text-[13px] transition-colors"
        style={{ height: DRAWER_HEADER }}
      >
        <span>{open ? '▾' : '▸'}</span>
        <span>Snoozed · {deals.length}</span>
        {!open && (
          <span className="text-text-disabled text-[12px]">
            — next back {fmtDateOnly(sorted[0]?.snoozed_until)}
          </span>
        )}
      </button>

      {open && (
        <div className="overflow-y-auto" style={{ height: drawerBody(deals.length) }}>
          <div
            className="grid gap-3 px-6 py-2 border-b border-hairline eyebrow text-text-muted sticky top-0 bg-space"
            style={{ gridTemplateColumns: GRID_COLS }}
          >
            <div>Company</div>
            <div>Stage</div>
            <div>Size</div>
            <div>Comes back</div>
            <div>Reason</div>
            <div />
          </div>

          {sorted.map((d) => {
            const days = daysUntil(d.snoozed_until);
            return (
              <div
                key={d.id}
                className="grid gap-3 px-6 py-2.5 border-b border-hairline items-center hover:bg-card-hover transition-colors"
                style={{ gridTemplateColumns: GRID_COLS }}
              >
                <button
                  onClick={() => onOpenDeal(d.id)}
                  className="text-left text-text-primary text-[13px] truncate hover:text-signal transition-colors"
                >
                  {d.company_name}
                </button>
                <div className="text-text-secondary text-[12px] truncate">
                  {STAGE_LABELS[d.current_stage] ?? d.current_stage}
                </div>
                <div className="font-mono text-text-secondary text-[12px]">
                  {formatCurrency(d.deal_size ?? 0)}
                </div>
                <div className="font-mono text-text-secondary text-[12px]">
                  {fmtDateOnly(d.snoozed_until)}
                  <span className="text-text-disabled"> · {days}d</span>
                </div>
                <div className="text-text-secondary text-[12px] truncate" title={d.snooze_note ?? undefined}>
                  {d.snooze_note || '—'}
                </div>
                <button
                  onClick={() => wakeNow(d.id)}
                  disabled={busyId === d.id}
                  className="text-text-muted hover:text-text-primary text-[12px] transition-colors disabled:opacity-40"
                >
                  {busyId === d.id ? 'Waking…' : 'Wake now'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
