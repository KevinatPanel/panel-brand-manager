import { useMemo, useRef, useState, useEffect } from 'react';
import { inputBase } from './ui.jsx';

// Down-chevron — the one piece of "this is a picker, not free text" affordance
// a native <select> gets for free from the browser and a hand-rolled <input>
// doesn't.
function Caret() {
  return (
    <svg viewBox="0 0 256 256" className="w-3.5 h-3.5" fill="currentColor" aria-hidden="true">
      <path d="M213.66,101.66l-80,80a8,8,0,0,1-11.32,0l-80-80A8,8,0,0,1,53.66,90.34L128,164.69l74.34-74.35a8,8,0,0,1,11.32,11.32Z" />
    </svg>
  );
}

// Generic searchable combobox — a drop-in replacement for a native <select>
// when the option list is long enough that scanning/native jump-to-letter
// stops being a reasonable way to find something (contacts, companies,
// deals). `pinnedOptions` are always visible regardless of the search query
// (e.g. "— No contact —", "+ New company…") and sit above a divider, ahead of
// the filtered `options`. `onChange` fires the raw selected value, not a
// synthetic event — this isn't a native element, so it follows this
// codebase's other from-scratch form controls (e.g. SpendGoalModal.jsx's
// GoalInput) rather than faking DOM event shape.
export default function SearchSelect({
  value,
  onChange,
  options,
  pinnedOptions = [],
  placeholder = 'Select…',
  emptyText = 'No matches',
  disabled = false,
  className = '',
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    function onDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [query, options]);

  const flatList = [...pinnedOptions, ...filtered];

  const resolvedLabel =
    [...pinnedOptions, ...options].find((o) => String(o.value) === String(value))?.label ?? '';

  function commit(option) {
    onChange(option.value);
    setQuery('');
    setOpen(false);
    setHighlight(0);
    inputRef.current?.blur();
  }

  function onKeyDown(e) {
    if (disabled) return;
    if (e.key === 'Escape') {
      // Only swallow Escape while the dropdown is actually open — this field
      // lives inside Modal/SlideOver, both of which close on a global
      // Escape listener (Overlay.jsx). Without stopPropagation, closing the
      // dropdown would bubble up and close the whole panel too. When the
      // dropdown isn't open, let Escape bubble normally.
      if (!open) return;
      e.stopPropagation();
      setQuery('');
      setOpen(false);
      e.currentTarget.blur();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, flatList.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (flatList[highlight]) commit(flatList[highlight]);
    }
  }

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <input
        ref={inputRef}
        type="text"
        value={open ? query : resolvedLabel}
        placeholder={open ? resolvedLabel || placeholder : placeholder}
        disabled={disabled}
        onFocus={() => {
          if (disabled) return;
          setOpen(true);
          setQuery('');
          setHighlight(0);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setHighlight(0);
        }}
        onKeyDown={onKeyDown}
        className={`${inputBase} pr-8 disabled:opacity-40 disabled:cursor-not-allowed`}
      />
      <div className="absolute inset-y-0 right-2.5 flex items-center pointer-events-none text-text-muted">
        <Caret />
      </div>

      {open && !disabled && (
        <div className="absolute left-0 top-full mt-1 w-full max-h-[60vh] overflow-y-auto bg-space border border-hairline z-40">
          {pinnedOptions.map((o) => (
            <Row key={`pinned-${o.value}`} option={o} highlighted={flatList[highlight] === o} onCommit={commit} />
          ))}
          {pinnedOptions.length > 0 && <div className="border-t border-hairline" />}
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-text-disabled text-[13px]">{emptyText}</div>
          ) : (
            filtered.map((o) => (
              <Row key={o.value} option={o} highlighted={flatList[highlight] === o} onCommit={commit} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function Row({ option, highlighted, onCommit }) {
  return (
    <button
      type="button"
      // Selecting via mousedown (not click) so this fires before the input's
      // blur — click would still work, but this keeps the interaction snappy
      // and matches the outside-click listener above being mousedown-based.
      onMouseDown={(e) => {
        e.preventDefault();
        onCommit(option);
      }}
      className={`w-full text-left px-3 py-2 text-[13px] text-text-primary transition-colors ${
        highlighted ? 'bg-card-hover' : 'hover:bg-card-hover'
      }`}
    >
      {option.label}
    </button>
  );
}
