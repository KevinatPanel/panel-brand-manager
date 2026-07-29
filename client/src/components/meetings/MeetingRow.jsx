import { useState } from 'react';
import { fmtDate } from '../../lib/dates.js';
import { formatCurrency } from '../../lib/stages.js';
import { useDeals } from '../../state/DealsContext.jsx';
import TranscriptsSection from '../deal/TranscriptsSection.jsx';
import StageActions from '../deal/StageActions.jsx';
import MeetingOutcomeFields from './MeetingOutcomeFields.jsx';

export const GRID_COLS = '1.3fr 0.9fr 0.9fr 1.2fr 1fr 0.9fr';

// One brand's inline collapsible row on the Meetings page. Collapsed, it's
// the same flat columns the table always showed. Expanded, it's the working
// view of a finished meeting: stage actions (advance to Closed Won, mark
// lost, or send back to Meeting Booked for a second meeting), the outcome/
// notes fields, and the transcript upload. Delete/Stage History/Touch Log
// still require the full deal record or Outreach's slide-out.
export default function MeetingRow({ deal }) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const { refresh } = useDeals();

  async function after(fn) {
    setBusy(true);
    try {
      await fn();
      await refresh();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-b border-hairline">
      <div
        onClick={() => setExpanded((e) => !e)}
        className="grid gap-4 px-6 py-3 items-center cursor-pointer hover:bg-card-hover transition-colors"
        style={{ gridTemplateColumns: GRID_COLS }}
      >
        <div className="text-text-primary text-[13px] truncate flex items-center gap-1.5">
          <span className="text-text-disabled shrink-0">{expanded ? '▾' : '▸'}</span>
          <span className="truncate">{deal.company_name}</span>
        </div>
        <div className="text-text-secondary text-[13px] truncate">{deal.owner ?? '—'}</div>
        <div className="font-mono text-text-secondary text-[13px]">{formatCurrency(deal.deal_size)}</div>
        <div className="text-text-secondary text-[13px] truncate">{deal.primary_stakeholder_name ?? '—'}</div>
        <div className="text-text-secondary text-[13px]">{fmtDate(deal.current_stage_entered_at)}</div>
        <div className="font-mono text-text-secondary text-[13px]">{deal.days_in_stage}d</div>
      </div>

      {expanded && (
        <div className="px-6 pt-6 pb-6 grid grid-cols-2 gap-6">
          <MeetingOutcomeFields deal={deal} onChanged={refresh} />
          <div className="space-y-4">
            <TranscriptsSection dealId={deal.id} />
            <StageActions deal={deal} busy={busy} after={after} />
          </div>
        </div>
      )}
    </div>
  );
}
