// ---------------------------------------------------------------------------
// Pre-call qualifier: is this brand in hyper-growth, efficient scale, mixed,
// or too early for Panel? Inputs come from lead_qualifier (manual) and fall
// back to the company's Apollo record. Pure functions.
// ---------------------------------------------------------------------------

export const FUNDING_OPTIONS = [
  ['bootstrapped', 'Bootstrapped'],
  ['seed', 'Pre-seed or Seed'],
  ['seriesa', 'Series A'],
  ['seriesb', 'Series B'],
  ['seriesc', 'Series C'],
  ['late', 'Series D+ / late stage'],
  ['public', 'Public'],
];
export const EMPLOYEE_OPTIONS = [
  ['micro', 'Under 50'],
  ['small', '50 to 200'],
  ['mid', '200 to 1,000'],
  ['large', '1,000 to 5,000'],
  ['enterprise', 'Over 5,000'],
];
export const VERTICAL_OPTIONS = [
  ['neobank', 'Neobank / banking app'],
  ['bnpl', 'BNPL / payments'],
  ['investing', 'Investing / wealth'],
  ['credit', 'Credit building / repair'],
  ['cashadvance', 'Cash advance'],
  ['insurance', 'Insurance'],
  ['lending', 'Personal lending'],
  ['sportsbook', 'Sports betting / DFS'],
  ['prediction', 'Prediction markets'],
  ['legal', 'Legal services'],
  ['other', 'Other'],
];
export const AD_SPEND_OPTIONS = [
  ['low', 'Under $100K / mo'],
  ['mid', '$100K to $500K / mo'],
  ['high', '$500K to $2M / mo'],
  ['whale', 'Over $2M / mo'],
];

// Verticals where a converted user is worth a lot, so CPAs can run high.
export const HIGH_LTV_VERTICALS = ['neobank', 'lending', 'sportsbook', 'legal', 'cashadvance', 'prediction'];

const label = (opts, key) => opts.find(([k]) => k === key)?.[1] ?? null;

// ---- Reading Apollo's organization record ---------------------------------
function fundingFromApollo(stage) {
  const s = String(stage ?? '').toLowerCase();
  if (!s) return null;
  if (s.includes('seed') || s.includes('angel')) return 'seed';
  if (s.includes('series a')) return 'seriesa';
  if (s.includes('series b')) return 'seriesb';
  if (s.includes('series c')) return 'seriesc';
  if (/series [d-z]/.test(s) || s.includes('private equity') || s.includes('late')) return 'late';
  if (s.includes('ipo') || s.includes('public')) return 'public';
  return null;
}

function employeesBand(n) {
  const v = Number(n);
  if (!v) return null;
  if (v < 50) return 'micro';
  if (v <= 200) return 'small';
  if (v <= 1000) return 'mid';
  if (v <= 5000) return 'large';
  return 'enterprise';
}

const VERTICAL_WORDS = [
  ['cashadvance', /cash advance|earned wage|paycheck advance/],
  ['neobank', /neobank|bank|banking|fintech|debit|checking/],
  ['bnpl', /bnpl|buy now|payment/],
  ['investing', /invest|wealth|brokerage|trading|stock|crypto/],
  ['credit', /credit (build|repair|score)|credit/],
  ['insurance', /insur/],
  ['lending', /lend|loan/],
  ['sportsbook', /sports ?book|betting|fantasy|dfs|gambl|casino/],
  ['prediction', /prediction market/],
  ['legal', /legal|law firm|attorney|lawyer/],
];
function verticalFrom(...texts) {
  const t = texts.filter(Boolean).join(' ').toLowerCase();
  if (!t) return null;
  return VERTICAL_WORDS.find(([, re]) => re.test(t))?.[0] ?? 'other';
}

// The effective inputs: manual values win, Apollo fills the rest. Each field
// reports where it came from so the UI can mark auto-filled ones.
export function qualifierInputs(lead, manual) {
  const org = lead?.apollo_raw?.organization ?? lead?.apollo_raw ?? lead?.apollo_lite ?? {};
  const pick = (key, auto) =>
    manual?.[key] ? { value: manual[key], source: 'manual' } : auto ? { value: auto, source: 'apollo' } : { value: null, source: null };
  const publicCo = org.publicly_traded_symbol ? 'public' : null;
  return {
    funding_stage: pick('funding_stage', publicCo ?? fundingFromApollo(org.latest_funding_stage)),
    funding_date: pick('funding_date', org.latest_funding_round_date ? String(org.latest_funding_round_date).slice(0, 10) : null),
    employees: pick('employees', employeesBand(org.estimated_num_employees ?? lead?.headcount?.match?.(/\d+/)?.[0])),
    vertical_key: pick('vertical_key', verticalFrom(lead?.vertical_name, org.industry, lead?.industry)),
    ad_spend: pick('ad_spend', null),
  };
}

function monthsSince(date, today = new Date()) {
  if (!date) return NaN;
  const [y, m] = String(date).split('-').map(Number);
  return (today.getFullYear() - y) * 12 + (today.getMonth() + 1 - m);
}

// The classification, with the reasons that drove it. adCheck (the latest
// Meta Ad Library check) adds a warmth signal without changing the mode.
export function classifyBrand(inputs, today = new Date(), adCheck = null) {
  const funding = inputs.funding_stage.value;
  const months = monthsSince(inputs.funding_date.value, today);
  const employees = inputs.employees.value;
  const vertical = inputs.vertical_key.value;
  const spend = inputs.ad_spend.value;
  const filled = [funding, !Number.isNaN(months), employees, vertical, spend].filter(Boolean).length;
  if (!funding && filled < 2) return null;

  const hasM = !Number.isNaN(months);
  const recent = !hasM || months <= 18;
  const bigSpend = spend === 'whale' || spend === 'high';
  const reasons = [];
  const highLtv = HIGH_LTV_VERTICALS.includes(vertical);
  if (highLtv) reasons.push(`${label(VERTICAL_OPTIONS, vertical)} users are high value, so CPAs can run high`);

  const paying = adCheck && ((adCheck.active_ads ?? 0) > 0 || (adCheck.creators ?? []).length > 0);
  if (paying) reasons.push('Already paying creators (Ad Library)');

  if (funding === 'seed' && !bigSpend) {
    reasons.unshift('Seed stage without big spend usually can’t ramp from a $10K pilot to $100K in 4 to 5 months');
    return { mode: 'early', label: 'Too early', highLtv, paying, reasons, filled };
  }

  let score = 0;
  if (['seriesb', 'seriesc'].includes(funding) && recent) { score += 3; reasons.push(`Recent ${label(FUNDING_OPTIONS, funding)}`); }
  else if (funding === 'seriesa' && recent) { score += 2; reasons.push('Recent Series A'); }
  else if (funding === 'seed' && bigSpend) { score += 2; reasons.push('Seed, but already spending big'); }
  else if (funding === 'late' && hasM && months <= 12) { score += 1; reasons.push('Late stage with a raise in the last year'); }
  else if (funding === 'public') { score -= 2; reasons.push('Public company: efficiency over growth'); }
  else if (funding === 'bootstrapped') { score -= 1; reasons.push('Bootstrapped: spends carefully'); }

  if (hasM && months > 36) { score -= 2; reasons.push(`Last raise ${months} months ago`); }
  else if (hasM && months > 24) { score -= 1; reasons.push(`Last raise ${months} months ago`); }

  if (employees === 'micro' || employees === 'small') { score += 1; reasons.push('Small team, moves fast'); }
  else if (employees === 'large' || employees === 'enterprise') { score -= 1; reasons.push('Large company, slower decisions'); }

  if (spend === 'whale') { score += 1; reasons.push('Over $2M a month in paid media'); }
  else if (spend === 'low') { score -= 1; reasons.push('Under $100K a month in paid media'); }

  if (score >= 3) return { mode: 'hyper', label: 'Hyper-growth', highLtv, paying, reasons, filled, score };
  if (score <= -1) return { mode: 'efficient', label: 'Efficient scale', highLtv, paying, reasons, filled, score };
  return { mode: 'unclear', label: 'Mixed signals', highLtv, paying, reasons, filled, score };
}

// Generic framing per mode; the playbook's own wording (with client names)
// loads from playbook_entries kind 'qualifier' when it has been seeded.
export const MODE_GUIDE = {
  hyper: 'Lead with speed and scale: how fast the network ramps from a pilot to real volume.',
  efficient: 'Lead with efficiency and attribution: tracked conversions, CPA that holds, profitable growth.',
  unclear: 'Qualify harder on the call: ask whether they are optimizing for growth or for efficiency right now.',
  early: 'Keep it light and note the fit for later. Revisit after their next raise.',
};
