// ---------------------------------------------------------------------------
// Buyer tiers: who to reach at a brand, read from the contact's job title.
// A contact's buyer_tier column (0053) overrides the title-based guess.
// ---------------------------------------------------------------------------

export const TIERS = {
  primary: { label: 'Primary target', short: 'Primary', note: 'Best return on outreach: operators who own acquisition budget.' },
  decision: { label: 'Decision maker', short: 'Decision', note: 'Final budget authority. Multi-thread in once you have a champion.' },
  champion: { label: 'Champion', short: 'Champion', note: 'Less authority, but gets you in the door and argues for you inside.' },
  skip: { label: 'Skip', short: 'Skip', note: 'Wrong function or no authority. Research only.' },
};
export const TIER_ORDER = ['primary', 'decision', 'champion', 'skip'];

const FUNCTION = /growth|acquisition|performance|affiliate|partnership|creator|influencer|user acquisition|\bua\b|paid|demand gen/;
const DECISION_TITLE = /\b(chief|cmo|ceo|coo|cro|cgo|founder|co-founder|president|owner|vp|vice president|svp|evp|gm|general manager)\b/;
const LEAD_TITLE = /\b(head|director|senior manager|sr\.? manager|lead)\b/;
const JUNIOR_TITLE = /\b(manager|specialist|associate|coordinator|analyst|strategist)\b/;
const SKIP_FUNCTION = /engineer|developer|recruit|talent|finance|accounting|legal|counsel|hr\b|people ops|customer (support|success)|design|product manager|sales development|intern/;

// Title -> tier. Growth/affiliate/performance operators with seniority are the
// primary targets; C-suite and VPs decide; junior growth roles champion.
export function tierFromTitle(title) {
  const t = String(title ?? '').toLowerCase();
  if (!t.trim()) return null;
  if (SKIP_FUNCTION.test(t) && !FUNCTION.test(t)) return 'skip';
  if (DECISION_TITLE.test(t)) return 'decision';
  const fn = FUNCTION.test(t) || /marketing/.test(t);
  if (LEAD_TITLE.test(t) && fn) return 'primary';
  if (JUNIOR_TITLE.test(t) && fn) return 'champion';
  if (LEAD_TITLE.test(t)) return 'champion';
  return 'skip';
}

export function tierOf(contact) {
  return contact?.buyer_tier || tierFromTitle(contact?.title);
}

// Multi-threaded = someone who can champion it (primary or champion) AND
// someone who can sign (decision maker). A primary target at a small company
// is often the decision maker too, so primary alone counts as covered-but-thin.
export function threadStatus(contacts) {
  const tiers = (contacts ?? []).map(tierOf);
  const hasChampion = tiers.includes('primary') || tiers.includes('champion');
  const hasDecision = tiers.includes('decision');
  if (hasChampion && hasDecision) return { key: 'multi', label: 'Multi-threaded', note: 'A champion and a decision maker.' };
  if (hasChampion) return { key: 'no_decision', label: 'No decision maker yet', note: 'Add a VP, C-level or founder to thread up.' };
  if (hasDecision) return { key: 'no_champion', label: 'No champion yet', note: 'Add a growth or affiliate operator to work the deal from inside.' };
  return { key: 'none', label: 'Not threaded', note: 'No primary target, champion or decision maker on file.' };
}
