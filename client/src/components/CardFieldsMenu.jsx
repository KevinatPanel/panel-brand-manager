import { useEffect, useRef, useState } from 'react';
import { CARD_FIELD_OPTIONS } from './DealCard.jsx';
import { IconButton } from './ui.jsx';

// Toolbar control for the Outreach board: which optional fields show on a
// deal card (company name always shows, everything else is toggleable).
// `fields`/`onChange` are controlled by the caller so the choice can be
// persisted (see OutreachView's localStorage-backed state).
export default function CardFieldsMenu({ fields, onChange }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  return (
    <div className="relative" ref={rootRef}>
      <IconButton
        icon="sliders"
        active={open}
        title="Card Fields"
        aria-label="Card Fields"
        onClick={() => setOpen((o) => !o)}
      />
      {open && (
        <div className="absolute right-0 top-full mt-1 w-56 bg-space border border-hairline z-40 p-1.5">
          {CARD_FIELD_OPTIONS.map((opt) => (
            <label
              key={opt.key}
              className="flex items-center gap-2 px-2 py-1.5 text-[13px] text-text-primary hover:bg-card-hover cursor-pointer"
            >
              <input
                type="checkbox"
                checked={!!fields[opt.key]}
                onChange={(e) => onChange({ ...fields, [opt.key]: e.target.checked })}
              />
              {opt.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
