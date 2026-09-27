import { ZONE_META } from '../../lib/economics.js';
import { formatCurrency } from '../../lib/stages.js';

export const money = (v, digits = 2) =>
  v == null || Number.isNaN(v)
    ? '—'
    : `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

export const wholeMoney = (v) => (v == null ? '—' : formatCurrency(Math.round(v)));

// The eCPM zone as a labeled chip: color plus the word, never color alone.
export function ZoneChip({ zone, className = '' }) {
  if (!zone) return null;
  const meta = ZONE_META[zone];
  return (
    <span className={`inline-block border px-1.5 py-0.5 eyebrow whitespace-nowrap ${meta.tone} ${className}`}>
      {meta.label}
    </span>
  );
}

// A 0 to 40 eCPM track split at the dead and goated thresholds, with a
// marker at this deal's eCPM.
export function ZoneMeter({ ecpm, settings }) {
  const cap = 40;
  const dead = (settings.dead_below / cap) * 100;
  const goated = (settings.goated_above / cap) * 100;
  const pos = ecpm == null ? null : Math.min(ecpm, cap) / cap * 100;
  return (
    <div>
      <div className="relative h-2.5 flex">
        <div className="bg-red-500/25" style={{ width: `${dead}%` }} />
        <div className="bg-signal/25 border-l-2 border-space" style={{ width: `${goated - dead}%` }} />
        <div className="bg-signal/60 border-l-2 border-space flex-1" />
        {pos != null && (
          <div
            className="absolute -top-1 w-1 h-[18px] bg-text-primary"
            style={{ left: `calc(${pos}% - 2px)` }}
            title={`eCPM ${money(ecpm)}`}
          />
        )}
      </div>
      <div className="relative h-4 font-mono text-text-muted text-[10px] mt-1">
        <span className="absolute left-0">$0</span>
        <span className="absolute -translate-x-1/2" style={{ left: `${dead}%` }}>${settings.dead_below}</span>
        <span className="absolute -translate-x-1/2" style={{ left: `${goated}%` }}>${settings.goated_above}</span>
        <span className="absolute right-0">$40+</span>
      </div>
    </div>
  );
}
