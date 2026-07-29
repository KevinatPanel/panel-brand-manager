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

export const inputBase =
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
  // Circular arrow — refresh/sync.
  sync: 'M240,56v48a8,8,0,0,1-8,8H184a8,8,0,0,1-5.66-13.66l17.94-17.94A80,80,0,1,0,214.86,158.5a8,8,0,1,1,15,5.6A96,96,0,1,1,208,72.69L225.66,55A8,8,0,0,1,240,56Z',
  // Two horizontal slider tracks with knobs — display/filter options toggle.
  sliders:
    'M40,88H73a32,32,0,0,0,62,0h81a8,8,0,0,0,0-16H135a32,32,0,0,0-62,0H40a8,8,0,0,0,0,16Zm64-24A16,16,0,1,1,88,80,16,16,0,0,1,104,64ZM216,168H199a32,32,0,0,0-62,0H40a8,8,0,0,0,0,16h97a32,32,0,0,0,62,0h17a8,8,0,0,0,0-16Zm-48,24a16,16,0,1,1,16-16A16,16,0,0,1,168,192Z',
  // Square frame with two tab "hands" — time-in-pipeline indicator.
  clock:
    'M64,64L192,64L192,192L64,192Z M88,88L88,168L168,168L168,88Z ' +
    'M124,96L132,96L132,128L124,128Z M128,124L152,124L152,132L128,132Z',
  // Square frame with a crossbar — deal size / value indicator.
  value: 'M64,64L192,64L192,192L64,192Z M88,88L88,168L168,168L168,88Z M88,120L168,120L168,136L88,136Z',
  // Cog — settings.
  gear: 'M128,80a48,48,0,1,0,48,48A48.05,48.05,0,0,0,128,80Zm0,80a32,32,0,1,1,32-32A32,32,0,0,1,128,160Zm88-29.84q.06-2.16,0-4.32l14.92-18.64a8,8,0,0,0,1.48-7.06,107.21,107.21,0,0,0-10.88-26.25,8,8,0,0,0-6-3.93l-23.72-2.64q-1.48-1.56-3-3L186,40.54a8,8,0,0,0-3.94-6,107.71,107.71,0,0,0-26.25-10.87,8,8,0,0,0-7.06,1.49L130.16,40Q128,40,125.84,40L107.2,25.11a8,8,0,0,0-7.06-1.48A107.6,107.6,0,0,0,73.89,34.51a8,8,0,0,0-3.93,6L67.32,64.27q-1.56,1.49-3,3L40.54,70a8,8,0,0,0-6,3.94,107.71,107.71,0,0,0-10.87,26.25,8,8,0,0,0,1.49,7.06L40,125.84Q40,128,40,130.16L25.11,148.8a8,8,0,0,0-1.48,7.06,107.21,107.21,0,0,0,10.88,26.25,8,8,0,0,0,6,3.93l23.72,2.64q1.49,1.56,3,3L70,215.46a8,8,0,0,0,3.94,6,107.71,107.71,0,0,0,26.25,10.87,8,8,0,0,0,7.06-1.49L125.84,216q2.16.06,4.32,0l18.64,14.92a8,8,0,0,0,7.06,1.48,107.21,107.21,0,0,0,26.25-10.88,8,8,0,0,0,3.93-6l2.64-23.72q1.56-1.48,3-3L215.46,186a8,8,0,0,0,6-3.94,107.71,107.71,0,0,0,10.87-26.25,8,8,0,0,0-1.49-7.06Zm-16.1-6.5a73.93,73.93,0,0,1,0,8.68,8,8,0,0,0,1.74,5.48l14.19,17.73a91.57,91.57,0,0,1-6.23,15L187,173.11a8,8,0,0,0-5.1,2.64,74.11,74.11,0,0,1-6.14,6.14,8,8,0,0,0-2.64,5.1l-2.51,22.58a91.32,91.32,0,0,1-15,6.23l-17.74-14.19a8,8,0,0,0-5-1.75h-.48a73.93,73.93,0,0,1-8.68,0,8,8,0,0,0-5.48,1.74L100.45,215.8a91.57,91.57,0,0,1-15-6.23L82.89,187a8,8,0,0,0-2.64-5.1,74.11,74.11,0,0,1-6.14-6.14,8,8,0,0,0-5.1-2.64L46.43,170.6a91.32,91.32,0,0,1-6.23-15l14.19-17.74a8,8,0,0,0,1.74-5.48,73.93,73.93,0,0,1,0-8.68,8,8,0,0,0-1.74-5.48L40.2,100.45a91.57,91.57,0,0,1,6.23-15L69,82.89a8,8,0,0,0,5.1-2.64,74.11,74.11,0,0,1,6.14-6.14A8,8,0,0,0,82.89,69L85.4,46.43a91.32,91.32,0,0,1,15-6.23l17.74,14.19a8,8,0,0,0,5.48,1.74,73.93,73.93,0,0,1,8.68,0,8,8,0,0,0,5.48-1.74L155.55,40.2a91.57,91.57,0,0,1,15,6.23L173.11,69a8,8,0,0,0,2.64,5.1,74.11,74.11,0,0,1,6.14,6.14,8,8,0,0,0,5.1,2.64l22.58,2.51a91.32,91.32,0,0,1,6.23,15l-14.19,17.74A8,8,0,0,0,199.87,123.66Z',
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
      className={`inline-flex items-center justify-center h-7 w-7 shrink-0 border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
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

// Loading placeholder block — pulses via Tailwind's built-in animate-pulse.
// Hard corners, no border-radius, consistent with the rest of the system.
export function Skeleton({ className = '' }) {
  return <div className={`bg-card-hover animate-pulse ${className}`} />;
}

// Placeholder shaped like a fully-configured DealCard (name, secondary line,
// divider, footer stats) so the loading -> loaded swap doesn't shift layout.
export function DealCardSkeleton() {
  return (
    <div className="panel-card p-3">
      <Skeleton className="h-[13px] w-3/5" />
      <Skeleton className="h-[12px] w-2/5 mt-2" />
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-hairline">
        <Skeleton className="h-[12px] w-14" />
        <Skeleton className="h-[12px] w-10" />
      </div>
    </div>
  );
}
