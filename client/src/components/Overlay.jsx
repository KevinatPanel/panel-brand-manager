import { useEffect } from 'react';

// Shared backdrop that locks scroll and closes on Escape / outside click.
function Backdrop({ onClose, children, justify }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className={`fixed inset-0 z-30 bg-black/85 flex ${justify}`}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      {children}
    </div>
  );
}

// Centered modal — used for forms (Add Deal / Add Lead / Add Touch).
export function Modal({ title, onClose, children, width = 'max-w-md' }) {
  return (
    <Backdrop onClose={onClose} justify="items-start justify-center">
      <div className={`mt-24 w-full ${width} bg-space border border-hairline`}>
        <div className="flex items-center justify-between px-5 h-12 border-b border-hairline">
          <div className="eyebrow text-text-secondary">{title}</div>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary text-[13px]">
            ✕
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </Backdrop>
  );
}

// Right-hand slide-in panel — used for Deal Detail.
export function SlideOver({ onClose, children, width = 'w-[440px]' }) {
  return (
    <Backdrop onClose={onClose} justify="justify-end">
      <div className={`h-full ${width} max-w-full bg-space border-l border-hairline overflow-y-auto`}>
        {children}
      </div>
    </Backdrop>
  );
}
