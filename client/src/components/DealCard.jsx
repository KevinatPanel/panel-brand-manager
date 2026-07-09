import { useState } from 'react';
import { formatCurrency, isStaleInStage, STALE_STAGE_DAYS } from '../lib/stages.js';
import { ChannelTag } from './ui.jsx';

// A single deal card for the Kanban boards.
// Shows brand (primary), owner (secondary), days-in-pipeline (mono), channel,
// and pilot spend (mono). Clicking opens the Deal Detail panel; the card is also
// draggable so it can be dropped onto another stage column. The stale red dot
// still tracks time-in-stage (a separate stagnation signal).
export default function DealCard({ deal, onClick }) {
  const stale = isStaleInStage(deal);
  const [dragging, setDragging] = useState(false);

  return (
    <button
      onClick={onClick}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/deal', deal.id);
        e.dataTransfer.effectAllowed = 'move';
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
      className={`panel-card w-full text-left p-3 block cursor-grab active:cursor-grabbing ${
        dragging ? 'opacity-50' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-text-primary text-[13px] font-medium truncate">
            {deal.brand_name}
          </div>
          <div className="text-text-secondary text-[12px] mt-0.5">{deal.owner ?? '—'}</div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {stale && (
            <span
              className="w-2 h-2 rounded-full bg-red-500"
              title={`In this stage ${deal.days_in_stage} days (over ${STALE_STAGE_DAYS}-day limit)`}
            />
          )}
        </div>
      </div>

      <div className="flex items-center justify-between mt-3">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[12px] text-text-secondary">{deal.days_in_pipeline}d</span>
          <span className="eyebrow text-text-muted">in pipeline</span>
        </div>
        <ChannelTag channel={deal.channel} />
      </div>

      <div className="mt-2 pt-2 border-t border-hairline">
        <span className="font-mono text-[12px] text-text-secondary">
          {formatCurrency(deal.pilot_spend)}
        </span>
      </div>
    </button>
  );
}
