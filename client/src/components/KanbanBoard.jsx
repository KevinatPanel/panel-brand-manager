import { useEffect, useRef, useState } from 'react';
import DealCard from './DealCard.jsx';
import { Eyebrow } from './ui.jsx';

// One Kanban column. A "collapsed" column (used for LOST) starts narrow and
// expands on click so terminal deals don't dominate the board.
function Column({ code, label, deals, collapsible, onCardClick, onMoveCard }) {
  const [open, setOpen] = useState(false);
  const [over, setOver] = useState(false);
  const collapsed = collapsible && !open;

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
        onClick={() => setOpen(true)}
        {...dropProps}
        className={`shrink-0 w-12 border-l border-hairline flex flex-col items-center pt-3 gap-3 hover:bg-card-hover transition-colors ${
          over ? 'bg-card-hover ring-1 ring-inset ring-signal' : ''
        }`}
        title={`${label} — ${deals.length}`}
      >
        <span className="font-mono text-[12px] text-text-secondary">{deals.length}</span>
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
      <div className="flex items-center justify-between px-3 h-10 border-b border-hairline">
        <div className="flex items-center gap-2">
          <Eyebrow className="text-text-secondary">{code}</Eyebrow>
          <span className="text-[12px] text-text-secondary">{label}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[12px] text-text-muted">{deals.length}</span>
          {collapsible && (
            <button onClick={() => setOpen(false)} className="text-text-muted hover:text-text-primary text-[12px]">
              ✕
            </button>
          )}
        </div>
      </div>
      <div
        {...dropProps}
        className={`flex-1 overflow-y-auto p-2 space-y-2 ${
          over ? 'bg-card-hover ring-1 ring-inset ring-signal' : ''
        }`}
      >
        {deals.length === 0 ? (
          <div className="text-text-disabled text-[12px] px-1 py-3">No deals</div>
        ) : (
          deals.map((d) => <DealCard key={d.id} deal={d} onClick={() => onCardClick(d.id)} />)
        )}
      </div>
    </div>
  );
}

// columns: [{ code, label, deals, collapsible? }]
// topOffset: total height of chrome above the board (header, optional toolbar),
// so the scroll area fills the rest of the viewport. Defaults to the bare header.
// scrollKey: distinguishes saved horizontal-scroll positions per filter
// combination (e.g. the pipeline board's search-param string) — a full-page
// navigation away and back (unlike the slide-out overlay) unmounts/remounts
// this component, so scroll position is persisted to sessionStorage rather
// than relying on the DOM surviving.
export default function KanbanBoard({ columns, onCardClick, onMoveCard, topOffset = '4rem', scrollKey = '' }) {
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
        <Column key={col.code} {...col} onCardClick={onCardClick} onMoveCard={onMoveCard} />
      ))}
    </div>
  );
}
