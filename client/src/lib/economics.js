// ---------------------------------------------------------------------------
// Creator UA economics: the math the sales playbook runs on. Pure functions;
// the thresholds are defaults that Settings → Economics can override
// (app_settings key 'economics').
// ---------------------------------------------------------------------------

export const ECONOMICS_DEFAULTS = {
  ua_fee_pct: 30, // Panel's UA fee as a share of what the brand pays
  commission_pct: 8, // a rep's commission, as a share of Panel's profit
  show_commission: false, // show commission projections next to profit
  bid_floor: 10, // the least a creator will run an offer for, $ per event
  dead_below: 10, // eCPM under this is the dead zone
  goated_above: 20, // eCPM over this is goated
  low_ctr_pct: 0.5, // clicks per 100 views below this reads as a fit problem
  low_cvr_pct: 5, // signups per 100 clicks below this reads as an offer problem
};

export const withDefaults = (s) => ({ ...ECONOMICS_DEFAULTS, ...(s ?? {}) });

const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));

// eCPM: what a creator earns per 1,000 views = conversions per 1K × payout.
export function ecpmOf(convPer1k, cpa) {
  const c = num(convPer1k);
  const p = num(cpa);
  return c == null || p == null ? null : c * p;
}

export const ZONE_META = {
  dead: { label: 'Dead zone', short: 'Dead', tone: 'text-red-400 border-red-500/40' },
  sweet: { label: 'Sweet spot', short: 'Sweet', tone: 'text-signal border-signal/50' },
  goated: { label: 'Goated', short: 'Goated', tone: 'bg-signal text-space border-signal' },
};

export function zoneFor(ecpm, settings) {
  if (ecpm == null) return null;
  const s = withDefaults(settings);
  if (ecpm < s.dead_below) return 'dead';
  if (ecpm <= s.goated_above) return 'sweet';
  return 'goated';
}

// A profitable bid sits between what a creator will run for and the brand's
// own CAC (every dollar above CAC loses money on the customer).
export function bidRange(brandCac, settings) {
  const s = withDefaults(settings);
  const cac = num(brandCac);
  return { floor: s.bid_floor, ceiling: cac == null ? null : Math.max(0, cac - 0.01) };
}

// Reverse-engineer a fair top-of-funnel payout: a converted user is worth V to
// the brand and X% of payable-event users reach that point, so each payable
// event is worth V × X to them. Never below what creators will run for.
export function fairPayout(userValue, reachRatePct, settings) {
  const v = num(userValue);
  const r = num(reachRatePct);
  if (v == null || r == null) return null;
  const s = withDefaults(settings);
  const raw = (v * r) / 100;
  return { raw, payout: Math.max(raw, s.bid_floor), floored: raw < s.bid_floor };
}

// Everything the Economics card shows, from one deal_economics row.
export function dealEconomics(row, settings) {
  const ecpm = ecpmOf(row?.conv_per_1k, row?.cpa);
  const zone = zoneFor(ecpm, settings);
  const range = bidRange(row?.brand_cac, settings);
  const cpa = num(row?.cpa);
  const bidStatus =
    cpa == null ? null
      : cpa < range.floor ? 'below_floor'
        : range.ceiling != null && cpa > range.ceiling ? 'above_cac'
          : 'ok';
  return { ecpm, zone, range, bidStatus, fair: fairPayout(row?.user_value, row?.reach_rate, settings) };
}

// ---- H. Money: brand spend -> Panel profit -> rep commission --------------
export function profitOf(spend, settings) {
  const s = withDefaults(settings);
  const v = num(spend) ?? 0;
  const profit = (v * s.ua_fee_pct) / 100;
  return { spend: v, profit, commission: (profit * s.commission_pct) / 100 };
}

// ---- A (clients). What the Everflow month says about a live program -------
// m: { revenue, payout, clicks, conversions } for one month; views optional.
export function diagnoseProgram(m, views, settings) {
  const s = withDefaults(settings);
  const clicks = num(m?.clicks);
  const conv = num(m?.conversions);
  const payout = num(m?.payout);
  const v = num(views);
  const cvr = clicks ? (conv ?? 0) / clicks * 100 : null;
  const ctr = v && clicks != null ? (clicks / v) * 100 : null;
  const payoutPerConv = conv ? (payout ?? 0) / conv : null;
  const ecpm = v && payout != null ? (payout / v) * 1000 : null;
  const epc = clicks ? ((payout ?? 0) / clicks) * 1000 : null; // creator $ per 1,000 clicks
  const zone = zoneFor(ecpm, s);

  let verdict = null;
  if (clicks == null || conv == null) verdict = null;
  else if (ctr != null && ctr < s.low_ctr_pct && cvr >= s.low_cvr_pct) verdict = 'narrow';
  else if (ctr != null && ctr < s.low_ctr_pct) verdict = 'fit';
  else if (cvr < s.low_cvr_pct) verdict = 'offer';
  else if (zone === 'dead') verdict = 'payout';
  else if (zone) verdict = 'scale';
  else verdict = 'needs_views';
  return { clicks, conversions: conv, cvr, ctr, payoutPerConv, ecpm, epc, zone, verdict };
}

export const VERDICTS = {
  scale: { label: 'Scale it', note: 'People click, they convert, and the pay is good. Find more creators like the ones running it.' },
  payout: { label: 'Payout problem', note: 'The funnel works but creators earn too little per view. Negotiate a higher payout per event.' },
  fit: { label: 'Fit problem', note: 'Few viewers click. Change the creator pairing or fix the creative; a higher payout will not save it.' },
  offer: { label: 'Offer problem', note: 'People click but don’t sign up. The brand’s landing page or onboarding is losing them.' },
  narrow: { label: 'Narrow but golden', note: 'Few click, but almost all convert. Keep it, and look for audiences like this one.' },
  needs_views: { label: 'Add views', note: 'Enter last month’s views to read click-through and eCPM.' },
};

// ---- G. Program lifecycle ---------------------------------------------------
export const PHASES = [
  { key: 'setup', label: 'Setup', days: [1, 30], goal: 'Integrations live, brief approved, first creators sourced.' },
  { key: 'faith', label: 'Faith', days: [31, 60], goal: 'First content live and first conversions: read which creators convert.' },
  { key: 'proof', label: 'Proof', days: [61, 90], goal: 'Scale what works, cut what doesn’t, open the first budget conversation.' },
  { key: 'inflection', label: 'Inflection', days: [91, 120], goal: 'The gate: budget expands or gets capped.' },
  { key: 'mature', label: 'Mature', days: [121, Infinity], goal: 'Steady spend, a stable creator core, profitable CPA. Lock a longer commitment.' },
];

export function phaseFor(liveDate, today = new Date()) {
  if (!liveDate) return null;
  const [y, m, d] = String(liveDate).slice(0, 10).split('-').map(Number);
  const day = Math.floor((today - new Date(y, m - 1, d)) / 86_400_000) + 1;
  if (day < 1) return null;
  const phase = PHASES.find((p) => day >= p.days[0] && day <= p.days[1]);
  return { ...phase, day };
}

// Month-over-month spend: expanding / holding / cutting (±10% band).
export function budgetTrend(prev, last) {
  const a = num(prev);
  const b = num(last);
  if (a == null || b == null || a === 0) return null;
  const change = (b - a) / a;
  return { change, trend: change > 0.1 ? 'expanding' : change < -0.1 ? 'cutting' : 'holding' };
}

// The program health read: churn / risk / healthy, from real inputs.
// tracking: true | false | null; trend: expanding | holding | cutting | null;
// creators: { now, before } active creator counts (before optional).
export function diagnoseHealth({ phase, tracking, trend, creators }) {
  const late = ['proof', 'inflection', 'mature'].includes(phase);
  const creatorsFalling = creators?.before != null && creators.now < creators.before;
  if (trend === 'cutting' || (creatorsFalling && tracking === false)) {
    return {
      tier: 'churn',
      label: 'Likely to churn',
      note: trend === 'cutting'
        ? 'Budget is being cut. Raise it with the team, but protect your pipeline rather than pouring the week into it.'
        : 'Creators are dropping off on top of broken tracking. There is no stable base to grow from.',
    };
  }
  if (tracking === false || trend === 'holding' || creatorsFalling) {
    let note = 'Intervene now while it’s still saveable.';
    if (tracking === false) {
      note = late
        ? 'Tracking still isn’t stable this late. Escalate and offer to wire directly into their stack.'
        : 'Chase the integration daily and offer help connecting their tracking. Tech delay is the top setup killer.';
    } else if (trend === 'holding') {
      note = 'Spend is flat: they aren’t convinced yet. Bring more data before asking for budget again.';
    } else if (creatorsFalling) {
      note = 'Fewer creators are running it. Check with the creator team whether the eCPM still clears.';
    }
    return { tier: 'risk', label: 'At risk', note };
  }
  if (tracking == null && trend == null) {
    return { tier: 'unknown', label: 'Not enough data', note: 'Confirm tracking and sync Everflow to read health.' };
  }
  return {
    tier: 'healthy',
    label: 'Healthy',
    note: phase === 'mature'
      ? 'Mature and steady. Lock a longer commitment, pitch a second program, and ask for a case study.'
      : 'On track. Keep pushing this phase’s milestone.',
  };
}
