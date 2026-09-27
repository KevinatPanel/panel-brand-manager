// A program's health read (lib/economics.js diagnoseHealth) as a labeled chip.
export const HEALTH_TONE = {
  churn: 'text-red-400 border-red-500/40',
  risk: 'text-text-primary border-text-muted',
  healthy: 'text-signal border-signal/50',
  unknown: 'text-text-muted border-hairline',
};

export function HealthChip({ health }) {
  if (!health) return null;
  return (
    <span title={health.note} className={`inline-block border px-1.5 py-0.5 eyebrow whitespace-nowrap ${HEALTH_TONE[health.tier]}`}>
      {health.label}
    </span>
  );
}
