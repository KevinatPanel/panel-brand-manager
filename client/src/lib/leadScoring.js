// ---------------------------------------------------------------------------
// Lead scoring — pure functions. Signal values + scoring config in, score out.
// Ported verbatim from the former Express server (server/src/leadScoring.js)
// so scoring now runs client-side against Supabase data.
//
//   score = (sum of points earned) / (sum of max_points) * 100, rounded.
//
// Denominator uses max_points from the (possibly user-edited) config, so the
// score stays a meaningful 0–100 even after the rubric is retuned.
// ---------------------------------------------------------------------------

const MONTH_MS = (365.25 / 12) * 24 * 60 * 60 * 1000;

// Safely parse an options column that may be a JSON string, array, or null.
// (Supabase returns jsonb already-parsed, but tolerate strings too.)
function parseOptions(options) {
  if (options == null) return null;
  if (typeof options !== 'string') return options;
  try {
    return JSON.parse(options);
  } catch {
    return null;
  }
}

// Points earned for a single signal given its config row and stored value.
// ctx: { contactCount, nowMs } for derived/date-sensitive signals.
export function signalPoints(config, value, ctx = {}) {
  const opts = parseOptions(config.options);
  const { contactCount = 0, nowMs = Date.now() } = ctx;
  const cap = (n) => Math.min(Number(n) || 0, config.max_points);

  switch (config.input_type) {
    case 'text':
      return 0; // informational only

    case 'derived': {
      // key_contacts: highest threshold whose min <= contactCount.
      const tiers = Array.isArray(opts) ? [...opts].sort((a, b) => b.min - a.min) : [];
      const tier = tiers.find((t) => contactCount >= t.min);
      return tier ? cap(tier.points) : 0;
    }

    case 'number': {
      // revenue: first range that contains the value.
      const ranges = Array.isArray(opts) ? opts : [];
      const n = Number(value);
      if (!Number.isFinite(n)) return 0;
      const range = ranges.find((r) => n >= r.min && n <= r.max);
      return range ? cap(range.points) : 0;
    }

    case 'select':
    case 'toggle': {
      if (!Array.isArray(opts)) return 0;

      // recent_funding: a date stored as the value means "Yes"; it scores only
      // when within the configured recency window. "No"/"Unknown"/"Yes" w/o a
      // date score 0.
      if (config.has_date) {
        const yes = opts.find((o) => o.value === 'Yes');
        const t = Date.parse(value);
        if (Number.isNaN(t)) return 0;
        const months = (nowMs - t) / MONTH_MS;
        const within = months <= (config.recency_months ?? 18) && months >= -1;
        return within && yes ? cap(yes.points) : 0;
      }

      const hit = opts.find((o) => o.value === value);
      return hit ? cap(hit.points) : 0;
    }

    default:
      return 0;
  }
}

// Compute the full score for a lead.
//   configs       : array of scoring_config rows (with structural flags merged)
//   signalMap     : { signal_key: { value, notes } }  (or { signal_key: value })
//   contactCount  : number of lead_contacts
// Returns { score, earned, maxTotal, breakdown: { key: points } }.
export function calculateScore(configs, signalMap, contactCount = 0, nowMs = Date.now()) {
  let earned = 0;
  let maxTotal = 0;
  const breakdown = {};

  for (const cfg of configs) {
    maxTotal += Number(cfg.max_points) || 0;
    const raw = signalMap?.[cfg.signal_key];
    const value = raw && typeof raw === 'object' ? raw.value : raw;
    const pts = signalPoints(cfg, value, { contactCount, nowMs });
    breakdown[cfg.signal_key] = pts;
    earned += pts;
  }

  const score = maxTotal > 0 ? Math.round((earned / maxTotal) * 100) : 0;
  return { score, earned, maxTotal, breakdown };
}

// Signal completion = fraction of *scoreable* signals that have a value.
// key_contacts (derived) counts as filled when there is >= 1 contact; text and
// other entered signals count when a non-empty value exists.
export function signalCompletion(configs, signalMap, contactCount = 0) {
  let filled = 0;
  let total = 0;
  for (const cfg of configs) {
    total += 1;
    if (cfg.input_type === 'derived') {
      if (contactCount > 0) filled += 1;
      continue;
    }
    const raw = signalMap?.[cfg.signal_key];
    const value = raw && typeof raw === 'object' ? raw.value : raw;
    if (value != null && String(value).trim() !== '') filled += 1;
  }
  return total > 0 ? filled / total : 0;
}
