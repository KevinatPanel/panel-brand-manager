// ---------------------------------------------------------------------------
// Small brand-styled UI primitives shared across views.
// Hard corners, hairline borders, Inter labels, Signal Green only for CTAs.
// ---------------------------------------------------------------------------

import { useState } from 'react';

export function Eyebrow({ children, className = '' }) {
  return <div className={`eyebrow text-text-muted ${className}`}>{children}</div>;
}

// Labelled field wrapper.
export function Field({ label, children }) {
  return (
    <label className="block">
      <Eyebrow className="mb-1.5">{label}</Eyebrow>
      {children}
    </label>
  );
}

const inputBase =
  'w-full bg-space border border-hairline px-3 py-2 text-[13px] text-text-primary ' +
  'placeholder:text-text-disabled outline-none focus:border-signal/60 transition-colors';

export function Input(props) {
  return <input {...props} className={`${inputBase} ${props.className ?? ''}`} />;
}

export function TextArea(props) {
  return <textarea {...props} className={`${inputBase} resize-none ${props.className ?? ''}`} />;
}

export function Select({ children, ...props }) {
  return (
    <select {...props} className={`${inputBase} appearance-none ${props.className ?? ''}`}>
      {children}
    </select>
  );
}

// Primary CTA uses Signal Green; secondary/ghost stay monochrome.
export function Button({ variant = 'secondary', className = '', ...props }) {
  const styles = {
    primary: 'bg-signal text-space hover:bg-signal/90 font-medium',
    secondary: 'border border-hairline text-text-primary hover:bg-card-hover',
    ghost: 'text-text-secondary hover:text-text-primary',
    danger: 'border border-red-500/40 text-red-400 hover:bg-red-500/10',
  }[variant];
  return (
    <button
      {...props}
      className={`px-3 py-2 text-[13px] transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${styles} ${className}`}
    />
  );
}

// Phosphor icons (regular weight, 256 grid), inlined to avoid a dependency.
const ICON_PATHS = {
  copy: 'M216,32H88a8,8,0,0,0-8,8V80H40a8,8,0,0,0-8,8V216a8,8,0,0,0,8,8H168a8,8,0,0,0,8-8V176h40a8,8,0,0,0,8-8V40A8,8,0,0,0,216,32ZM160,208H48V96H160Zm48-48H176V88a8,8,0,0,0-8-8H96V48H208Z',
  check: 'M229.66,77.66l-128,128a8,8,0,0,1-11.32,0l-56-56a8,8,0,0,1,11.32-11.32L96,188.69,218.34,66.34a8,8,0,0,1,11.32,11.32Z',
  eye: 'M247.31,124.76c-.35-.79-8.82-19.58-27.65-38.41C194.57,61.26,162.88,48,128,48S61.43,61.26,36.34,86.35C17.51,105.18,9,124,8.69,124.76a8,8,0,0,0,0,6.5c.35.79,8.82,19.57,27.65,38.4C61.43,194.74,93.12,208,128,208s66.57-13.26,91.66-38.34c18.83-18.83,27.3-37.61,27.65-38.4A8,8,0,0,0,247.31,124.76ZM128,192c-30.78,0-57.67-11.19-79.93-33.25A133.47,133.47,0,0,1,25,128,133.33,133.33,0,0,1,48.07,97.25C70.33,75.19,97.22,64,128,64s57.67,11.19,79.93,33.25A133.46,133.46,0,0,1,231.05,128C223.84,141.46,192.43,192,128,192Zm0-112a48,48,0,1,0,48,48A48.05,48.05,0,0,0,128,80Zm0,80a32,32,0,1,1,32-32A32,32,0,0,1,128,160Z',
  // Four corner brackets — "open full record" / expand-to-page.
  expand:
    'M40,40L40,88L56,88L56,56L88,56L88,40Z ' +
    'M216,40L216,88L200,88L200,56L168,56L168,40Z ' +
    'M40,216L40,168L56,168L56,200L88,200L88,216Z ' +
    'M216,216L216,168L200,168L200,200L168,200L168,216Z',
  // Filled pin/pentagon — pinned note indicator.
  pin: 'M88,48L168,48L168,120L128,208L88,120Z',
  // Lid + handle + tapered can — delete/remove.
  trash: 'M104,48L152,48L152,72L104,72Z M64,72L192,72L192,88L64,88Z M76,96L180,96L170,208L86,208Z',
  // Rectangular ring — attachment/paperclip.
  paperclip: 'M88,40L168,40L168,180L88,180Z M104,164L152,164L152,56L104,56Z',
};

export function Icon({ name, className = 'w-4 h-4' }) {
  return (
    <svg viewBox="0 0 256 256" className={className} fill="currentColor" aria-hidden="true">
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

// Square hairline icon button — the obvious-affordance sibling of Button for
// compact icon-only actions (copy email, view conversation).
export function IconButton({ icon, active = false, className = '', ...props }) {
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex items-center justify-center h-7 w-7 shrink-0 border transition-colors ${
        active
          ? 'border-signal/50 text-signal'
          : 'border-hairline text-text-muted hover:text-text-primary hover:bg-card-hover'
      } ${className}`}
    >
      <Icon name={icon} />
    </button>
  );
}

// Square copy-to-clipboard icon button. stopPropagation/preventDefault so it can
// live inside a <label> (e.g. the review-queue person rows) without toggling it.
export function CopyButton({ value, className = '' }) {
  const [copied, setCopied] = useState(false);
  async function copy(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable (non-secure context) — silently no-op */
    }
  }
  return (
    <IconButton
      icon={copied ? 'check' : 'copy'}
      active={copied}
      onClick={copy}
      title={copied ? 'Copied' : 'Copy email'}
      aria-label={copied ? 'Copied' : 'Copy email'}
      className={className}
    />
  );
}

// Channel label chip (Email / LinkedIn / Slack / Mixed).
export function ChannelTag({ channel }) {
  if (!channel) return null;
  return (
    <span className="eyebrow text-text-secondary border border-hairline px-1.5 py-0.5">
      {channel}
    </span>
  );
}
