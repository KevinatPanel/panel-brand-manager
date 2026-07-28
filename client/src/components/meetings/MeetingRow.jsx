import { useState } from 'react';
import { fmtDate } from '../../lib/dates.js';
import TranscriptsSection from '../deal/TranscriptsSection.jsx';

export const GRID_COLS = '1.4fr 1fr 1.3fr 1.1fr 0.9fr';

// One brand's inline collapsible row on the Meetings page. Collapsed, it's
// the same five columns the flat table always showed. Expanded, v1 is just
// the meeting transcript upload/list — the place an account manager drops
// what came out of the call. Mark as Lost/Delete/Stage History/Touch Log
// stay off this page for now; reach them via the full deal record page or
// Outreach's slide-out (DealDetailPanel.jsx) instead.
export default function MeetingRow({ deal }) {
  const [expanded, setExpanded] = useState(false);

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
        <div className="text-text-secondary text-[13px] truncate">{deal.primary_stakeholder_name ?? '—'}</div>
        <div className="text-text-secondary text-[13px]">{fmtDate(deal.current_stage_entered_at)}</div>
        <div className="font-mono text-text-secondary text-[13px]">{deal.days_in_stage}d</div>
      </div>

      {expanded && (
        <div className="px-6 pb-6">
          <TranscriptsSection dealId={deal.id} />
        </div>
      )}
    </div>
  );
}
