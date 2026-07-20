import { Link } from 'react-router-dom';
import { formatCurrency } from '../lib/stages.js';
import { Modal } from './Overlay.jsx';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function monthLabel(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

// Read-only per-client breakdown behind the Home page rollup widget's expand
// button. Data is passed down already-fetched from HomeSpendGoalWidget — no
// independent query here. Goal editing stays on each client's own profile
// page (SpendGoalModal), not duplicated here.
export default function HomeSpendGoalModal({ clients, goals, actuals, month, onClose }) {
  const goalByLead = new Map((goals ?? []).map((g) => [g.lead_id, g.goal_amount]));
  const actualByLead = new Map((actuals ?? []).map((a) => [a.lead_id, a.revenue]));

  const rows = clients
    .map((c) => {
      const goalAmount = goalByLead.get(c.id) ?? null;
      const actualAmount = actualByLead.get(c.id) ?? null;
      const hasActual = actualAmount != null;
      const pct = hasActual && goalAmount ? Math.round((actualAmount / goalAmount) * 100) : null;
      return { client: c, goalAmount, actualAmount, hasActual, pct };
    })
    // Clients furthest behind goal float to the top; clients with no
    // computable percent (no goal, or nothing synced yet) sink to the bottom
    // — but their actual spend, if any, still renders in the row below.
    .sort((a, b) => {
      if (a.pct == null && b.pct == null) return 0;
      if (a.pct == null) return 1;
      if (b.pct == null) return -1;
      return a.pct - b.pct;
    });

  return (
    <Modal title={`Spend vs. goal — ${monthLabel(month)}`} onClose={onClose} width="max-w-2xl">
      <div className="max-h-[60vh] overflow-y-auto space-y-2.5 pr-1">
        {rows.map(({ client, goalAmount, actualAmount, hasActual, pct }) => {
          const fillPct = pct != null ? Math.min(100, Math.max(0, pct)) : 0;
          const valueLabel = hasActual
            ? `${formatCurrency(actualAmount)}${pct != null ? ` (${pct}%)` : ''}`
            : null;
          const filled = hasActual && goalAmount != null;
          return (
            <div key={client.id} className="flex items-center gap-3">
              <Link
                to={`/clients/${client.id}`}
                onClick={onClose}
                className="text-[12px] w-32 shrink-0 truncate text-text-secondary hover:text-text-primary transition-colors"
                title={client.company_name}
              >
                {client.company_name}
              </Link>
              <div className="relative flex-1 h-9 bg-card-inset border border-hairline overflow-hidden">
                {filled && (
                  <div
                    className="absolute inset-y-0 left-0 bg-signal transition-[width] duration-700 ease-out"
                    style={{ width: `${fillPct}%` }}
                  />
                )}
                <div className="relative h-full flex items-center px-2.5">
                  {hasActual ? (
                    <span className="font-mono font-medium text-text-primary text-[13px]">{valueLabel}</span>
                  ) : (
                    <span className="text-text-disabled text-[12px]">Not started</span>
                  )}
                </div>
                {/* Signal Green fails contrast under white text (~1.4:1) — a
                    dark duplicate of the label, clipped to exactly the
                    fill's width, swaps the color only where it sits over
                    the green; the white label underneath still shows
                    through past the clip, over the dark track. */}
                {filled && (
                  <div
                    className="absolute inset-0 flex items-center px-2.5 pointer-events-none transition-[clip-path] duration-700 ease-out"
                    style={{ clipPath: `inset(0 ${100 - fillPct}% 0 0)` }}
                  >
                    <span className="font-mono font-medium text-space text-[13px] whitespace-nowrap">
                      {valueLabel}
                    </span>
                  </div>
                )}
              </div>
              <span className="font-mono font-medium text-text-secondary text-[13px] shrink-0 text-right w-20">
                {goalAmount != null ? formatCurrency(goalAmount) : '—'}
              </span>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
