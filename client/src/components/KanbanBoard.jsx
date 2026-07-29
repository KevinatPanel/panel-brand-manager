import { useEffect, useRef, useState } from 'react';
import DealCard from './DealCard.jsx';
import { DealCardSkeleton, Skeleton } from './ui.jsx';
import { formatCurrency } from '../lib/stages.js';

const collapseKey = (code) => `kanban-collapsed:${code}`;
const SKELETON_CARD_COUNT = 3;

// Terminal-outcome columns get a faint tint so they read as visually distinct
// from the active funnel at a glance, reusing colors already meaningful
// elsewhere in the app (signal green = positive, red = danger/lost) rather
// than introducing new palette entries.
function outcomeTint(code) {
  if (code === 'WON') return { wash: 'bg-signal/[0.04]', edge: 'border-b-signal/30' };
  if (code === 'LOST') return { wash: 'bg-red-500/[0.04]', edge: 'border-b-red-500/30' };
  return null;
}

// One Kanban column. Any column can be "collapsible" (not just LOST/WON) —
// it starts narrow per defaultOpen and expands/collapses on click. Open/
// closed state is backed by localStorage per stage code so it survives
// reloads/navigation (unlike the board's scroll position, which uses
// sessionStorage — collapse choices are meant to stick around longer).
function Column({ code, label, deals, collapsible, defaultOpen = true, weightedTotal, cardFields, onCardClick, onMoveCard, loading }) {
  const [open, setOpen] = useState(() => {
    if (!collapsible) return true;
    const saved = localStorage.getItem(collapseKey(code));
    if (saved === 'open') return true;
    if (saved === 'closed') return false;
    return defaultOpen;
  });
  const [over, setOver] = useState(false);
  const collapsed = collapsible && !open;
  const tint = outcomeTint(code);

  function setOpenPersist(next) {
    setOpen(next);
    if (collapsible) localStorage.setItem(collapseKey(code), next ? 'open' : 'closed');
  }

  // Drop-target handlers shared by the collapsed button and the expanded body.
  const dropProps = {
    onDragOver: (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setOver(true);
    },
    onDragLeave: () => setOver(false),
    onDrop: (e) => {
      e.preventDefault();
      setOver(false);
      const dealId = e.dataTransfer.getData('text/deal');
      if (dealId) onMoveCard?.(dealId, code);
    },
  };

  if (collapsed) {
    return (
      <button
        onClick={() => setOpenPersist(true)}
        {...dropProps}
        className={`shrink-0 w-12 border-l border-hairline flex flex-col items-center pt-3 gap-3 hover:bg-card-hover transition-colors ${
          tint ? tint.wash : ''
        } ${over ? 'bg-card-hover ring-1 ring-inset ring-signal' : ''}`}
        title={`${label} — ${deals.length}`}
      >
        {loading ? (
          <Skeleton className="h-[12px] w-4" />
        ) : (
          <span className="font-mono text-[12px] text-text-secondary">{deals.length}</span>
        )}
        <span
          className="eyebrow text-text-muted whitespace-nowrap"
          style={{ writingMode: 'vertical-rl' }}
        >
          {label}
        </span>
      </button>
    );
  }

  return (
    <div className="shrink-0 w-64 border-l border-hairline flex flex-col">
      <div className={`px-3 py-2 border-b ${tint ? `${tint.wash} ${tint.edge}` : 'border-hairline'}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-text-secondary">{label}</span>
          </div>
          <div className="flex items-center gap-2">
            {loading ? (
              <Skeleton className="h-[11px] w-4" />
            ) : (
              <span className="font-mono text-[11px] text-text-disabled">{deals.length}</span>
            )}
            {collapsible && (
              <button onClick={() => setOpenPersist(false)} className="text-text-muted hover:text-text-primary text-[12px]">
                ✕
              </button>
            )}
          </div>
        </div>
        {loading ? (
          <Skeleton className="h-[13px] w-16 mt-1" />
        ) : (
          typeof weightedTotal === 'number' && (
            <div className="font-mono text-[13px] text-text-primary mt-1">{formatCurrency(weightedTotal)}</div>
          )
        )}
      </div>
      <div
        {...dropProps}
        className={`flex-1 overflow-y-auto p-2 space-y-2 ${
          over ? 'bg-card-hover ring-1 ring-inset ring-signal' : ''
        }`}
      >
        {loading ? (
          Array.from({ length: SKELETON_CARD_COUNT }).map((_, i) => <DealCardSkeleton key={i} />)
        ) : deals.length === 0 ? (
          <div className="text-text-disabled text-[12px] px-1 py-3">No deals</div>
        ) : (
          deals.map((d) => <DealCard key={d.id} deal={d} fields={cardFields} onClick={() => onCardClick(d.id)} />)
        )}
      </div>
    </div>
  );
}

// columns: [{ code, label, deals, collapsible?, defaultOpen?, weightedTotal? }]
// topOffset: total height of chrome above the board (header, optional toolbar),
// so the scroll area fills the rest of the viewport. Defaults to the bare header.
// scrollKey: distinguishes saved horizontal-scroll positions per filter
// combination (e.g. the pipeline board's search-param string) — a full-page
// navigation away and back (unlike the slide-out overlay) unmounts/remounts
// this component, so scroll position is persisted to sessionStorage rather
// than relying on the DOM surviving.
export default function KanbanBoard({ columns, cardFields, onCardClick, onMoveCard, topOffset = '4rem', scrollKey = '', loading = false }) {
  const scrollRef = useRef(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const saved = sessionStorage.getItem(`board-scroll:${scrollKey}`);
    el.scrollLeft = saved != null ? Number(saved) : 0;
  }, [scrollKey]);

  return (
    <div
      ref={scrollRef}
      onScroll={(e) => sessionStorage.setItem(`board-scroll:${scrollKey}`, String(e.currentTarget.scrollLeft))}
      className="flex overflow-x-auto border-r border-hairline"
      style={{ height: `calc(100vh - ${topOffset})` }}
    >
      {columns.map((col) => (
        <Column key={col.code} {...col} cardFields={cardFields} onCardClick={onCardClick} onMoveCard={onMoveCard} loading={loading} />
      ))}
    </div>
  );
}
