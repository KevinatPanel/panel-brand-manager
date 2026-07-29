import { useEffect } from 'react';

// Shared Escape-to-close behavior for both overlay types below.
function useEscapeToClose(onClose) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
}

// Centered modal — used for forms (Add Deal / Add Lead / Add Touch). Dims and
// blocks the rest of the app while open (a form demands full attention), and
// closes on Escape / outside click.
export function Modal({ title, onClose, children, width = 'max-w-md' }) {
  useEscapeToClose(onClose);
  return (
    <div
      className="fixed inset-0 z-30 bg-black/85 flex items-start justify-center"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className={`mt-24 w-full ${width} bg-space border border-hairline`}>
        <div className="flex items-center justify-between px-5 h-12 border-b border-hairline">
          <div className="eyebrow text-text-secondary">{title}</div>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary text-[13px]">
            ✕
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

// Right-hand slide-in panel — used for Deal Detail / Person Detail. No
// dimming backdrop: it docks alongside whatever board is open behind it
// rather than blocking it, so the rest of the app stays visible and
// clickable. Still closes on Escape.
export function SlideOver({ onClose, children, width = 'w-[440px]' }) {
  useEscapeToClose(onClose);
  return (
    <div
      className={`fixed inset-y-0 right-0 z-30 h-full ${width} max-w-full bg-space border-l border-hairline overflow-y-auto`}
    >
      {children}
    </div>
  );
}
