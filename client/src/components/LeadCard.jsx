import { useState } from 'react';
import { shortLabel, relativeTime } from '../lib/leads.js';

// Horizontal lead card for the board. Draggable so it can be dropped onto a
// vertical in the side nav to re-categorize the company.
// Layout L→R: rank | name + website + completion bar + signal chips | score + updated.
export default function LeadCard({ lead, rank, onClick }) {
  const completionPct = Math.round((lead.completion ?? 0) * 100);
  const [dragging, setDragging] = useState(false);

  return (
    <button
      onClick={onClick}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/lead', String(lead.id));
        e.dataTransfer.effectAllowed = 'move';
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
      className={`panel-card w-full text-left flex items-stretch gap-4 px-4 py-3 cursor-grab active:cursor-grabbing ${
        dragging ? 'opacity-50' : ''
      }`}
    >
      {/* Rank */}
      <div className="flex items-center">
        <span className="font-mono text-text-muted text-[13px] w-6 text-right">{rank}</span>
      </div>

      {/* Main */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-text-primary font-semibold text-[14px] truncate">
            {lead.company_name}
          </span>
          {lead.in_pipeline && (
            <span className="eyebrow text-signal border border-signal/40 px-1.5 py-0.5 flex items-center gap-1 shrink-0">
              <span className="w-1.5 h-1.5 bg-signal inline-block" />
              In Pipeline
            </span>
          )}
        </div>
        {lead.website && <div className="text-text-muted text-[12px] mt-0.5 truncate">{lead.website}</div>}

        {/* Signal completion bar (completeness, NOT score) */}
        <div className="mt-2 flex items-center gap-2 max-w-xs">
          <div className="flex-1 h-[3px] bg-hairline">
            <div className="h-[3px] bg-[rgba(255,255,255,0.35)]" style={{ width: `${completionPct}%` }} />
          </div>
          <span className="font-mono text-text-muted text-[10px] w-8">{completionPct}%</span>
        </div>

        {/* Top filled signals */}
        {lead.top_signals?.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {lead.top_signals.map((s) => (
              <span
                key={s.signal_key}
                className="eyebrow text-text-secondary bg-[rgba(255,255,255,0.06)] px-1.5 py-0.5"
              >
                {shortLabel(s.signal_key, s.label)}: {s.display}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Score */}
      <div className="flex flex-col items-end justify-center shrink-0">
        <div className="flex items-baseline">
          <span className="font-mono text-text-primary text-[26px] leading-none">{lead.score}</span>
          <span className="font-mono text-text-muted text-[13px]">/100</span>
        </div>
        <span className="text-text-disabled text-[11px] mt-1">
          Updated {relativeTime(lead.score_updated_at)}
        </span>
      </div>
    </button>
  );
}
