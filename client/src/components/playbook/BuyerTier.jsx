import { TIERS, TIER_ORDER, threadStatus, tierFromTitle, tierOf } from '../../lib/buyerTiers.js';

const TONE = {
  primary: 'text-signal border-signal/50',
  decision: 'bg-signal text-space border-signal',
  champion: 'text-text-primary border-hairline',
  skip: 'text-text-muted border-hairline',
};

// A contact's buyer tier as a chip; the tooltip says whether it was guessed
// from the title or set by hand.
export function TierChip({ contact, className = '' }) {
  const tier = tierOf(contact);
  if (!tier) return null;
  const auto = !contact?.buyer_tier;
  return (
    <span
      title={`${TIERS[tier].note}${auto ? ' (from the job title)' : ' (set by hand)'}`}
      className={`inline-block border px-1.5 py-0.5 eyebrow whitespace-nowrap ${TONE[tier]} ${className}`}
    >
      {TIERS[tier].short}
    </span>
  );
}

// Override select: blank = follow the title.
export function TierSelect({ contact, onChange, disabled }) {
  const guess = tierFromTitle(contact?.title);
  return (
    <select
      value={contact?.buyer_tier ?? ''}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value || null)}
      className="bg-transparent border border-hairline text-text-secondary text-[12px] px-2 py-1.5 w-full"
    >
      <option value="">Tier: from title{guess ? ` (${TIERS[guess].short})` : ''}</option>
      {TIER_ORDER.map((t) => (
        <option key={t} value={t}>{TIERS[t].label}</option>
      ))}
    </select>
  );
}

const THREAD_TONE = { multi: 'text-signal', no_decision: 'text-text-secondary', no_champion: 'text-text-secondary', none: 'text-text-muted' };

// Company-level: is the deal multi-threaded (a champion and a decision maker)?
export function ThreadStatus({ contacts }) {
  const s = threadStatus(contacts);
  return (
    <span title={s.note} className={`eyebrow ${THREAD_TONE[s.key]}`}>
      {s.key === 'multi' ? '● ' : '○ '}
      {s.label}
    </span>
  );
}
