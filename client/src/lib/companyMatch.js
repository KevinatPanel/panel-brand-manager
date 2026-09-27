// ---------------------------------------------------------------------------
// Match an email domain to a company already in the CRM, so the Review Queue
// can file mail by itself (lib/queueAutoSort.js). Mirrored server-side in
// supabase/functions/_shared/companyMatch.ts for the Gmail poller; keep the
// two in step.
//
// A domain matches a company when:
//   - it is the company's domain or website domain, or
//   - its name part is the company's name (chris@udemy.com -> Udemy,
//     help@mail.paysend.com -> Paysend, hi@getdave.com -> Dave), or
//   - its name part starts with a company name of 5+ letters
//     (paysendgroup.com -> Paysend, udemyforbusiness.com -> Udemy).
// Only an unambiguous match counts: two companies fitting equally is a guess,
// and guesses stay in the queue for a person.
// ---------------------------------------------------------------------------

const TWO_PART_TLDS = new Set(['co.uk', 'com.au', 'co.nz', 'co.in', 'com.br', 'co.za', 'com.mx', 'co.jp', 'org.uk']);
const NAME_PREFIXES = ['get', 'try', 'join', 'use', 'go', 'hello', 'my', 'the', 'with', 'meet'];
const NAME_SUFFIXES = ['app', 'hq', 'inc', 'io', 'official', 'team', 'usa', 'us', 'group', 'mail', 'email'];
const COMPANY_WORDS = /\b(inc|llc|l\.l\.c|ltd|limited|corp|corporation|co|company|technologies|technology|labs|holdings|group|app|hq|the)\b\.?/g;

export function normalizeDomain(raw) {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/^www\./, '')
    .split(/[/?#:]/)[0];
}

// "mail.udemy.com" -> "udemy"; "shop.brand.co.uk" -> "brand".
export function domainKey(domain) {
  const labels = normalizeDomain(domain).split('.').filter(Boolean);
  if (labels.length < 2) return labels[0] ?? '';
  const lastTwo = labels.slice(-2).join('.');
  const cut = TWO_PART_TLDS.has(lastTwo) && labels.length > 2 ? 2 : 1;
  return labels[labels.length - 1 - cut].replace(/[^a-z0-9]/g, '');
}

// "Udemy, Inc." -> "udemy"; "The Farmer's Dog" -> "farmersdog".
export function nameKey(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(COMPANY_WORDS, ' ')
    .replace(/[^a-z0-9]/g, '');
}

// The ways a domain's name part might spell a company name.
function keyVariants(key) {
  const out = new Set([key]);
  for (const p of NAME_PREFIXES) if (key.startsWith(p) && key.length - p.length >= 3) out.add(key.slice(p.length));
  for (const v of [...out]) {
    for (const s of NAME_SUFFIXES) if (v.endsWith(s) && v.length - s.length >= 3) out.add(v.slice(0, -s.length));
  }
  return out;
}

// Build once per list of companies: [{ id, company_name, domain, website, ... }].
export function buildCompanyIndex(leads) {
  const byDomain = new Map();
  const byName = new Map();
  const names = [];
  for (const l of leads) {
    for (const d of [l.domain, l.website]) {
      const n = normalizeDomain(d);
      if (n && n.includes('.') && !byDomain.has(n)) byDomain.set(n, l);
    }
    const k = nameKey(l.company_name);
    if (k.length >= 3) {
      byName.set(k, [...(byName.get(k) ?? []), l]);
      names.push([k, l]);
    }
  }
  return { byDomain, byName, names };
}

// The company an email domain belongs to, with how it matched, or null.
export function matchCompany(index, domain) {
  const d = normalizeDomain(domain);
  if (!d) return null;
  // Exact domain, including a subdomain of a company's domain (mail.udemy.com).
  const labels = d.split('.');
  for (let i = 0; i < labels.length - 1; i++) {
    const hit = index.byDomain.get(labels.slice(i).join('.'));
    if (hit) return { lead: hit, how: 'domain' };
  }
  const key = domainKey(d);
  if (key.length < 3) return null;
  // Name part equals a company name.
  const exact = new Map();
  for (const v of keyVariants(key)) for (const l of index.byName.get(v) ?? []) exact.set(l.id, l);
  if (exact.size === 1) return { lead: [...exact.values()][0], how: 'name' };
  if (exact.size > 1) return null;
  // Name part starts with a longer company name.
  const contained = index.names.filter(([k]) => k.length >= 5 && key.startsWith(k));
  const ids = new Set(contained.map(([, l]) => l.id));
  if (ids.size === 1) return { lead: contained[0][1], how: 'name' };
  return null;
}

// Addresses no person reads: bounces, no-reply and ticket systems. Mirrors
// ROLE_ADDRESS_LOCALPARTS in supabase/functions/_shared/match.ts.
const ROLE_LOCALPARTS = new Set([
  'noreply', 'no-reply', 'donotreply', 'do-not-reply', 'do_not_reply',
  'mailer-daemon', 'mailerdaemon', 'postmaster', 'bounce', 'bounces', 'mailer',
  'notifications', 'notification', 'notify', 'alerts', 'alert',
  'receipts', 'receipt', 'billing', 'invoice', 'invoices', 'payments', 'payment',
  'updates', 'news', 'newsletter', 'newsletters', 'digest',
  'unsubscribe', 'automated', 'system', 'daemon',
  'support', 'help', 'helpdesk', 'customercare',
  'security', 'abuse',
]);
export function isAutomatedAddress(email) {
  const local = String(email ?? '').split('@')[0].toLowerCase().split('+')[0];
  if (ROLE_LOCALPARTS.has(local)) return true;
  return ['noreply', 'no-reply', 'donotreply', 'do-not-reply', 'bounce', 'mailer-daemon', 'mailerdaemon'].some((p) =>
    local.startsWith(p),
  );
}
