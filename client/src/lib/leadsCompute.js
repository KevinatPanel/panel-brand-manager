// ---------------------------------------------------------------------------
// Lead summary/presentation helpers — ported from the former server
// (routes/leads.js). Build the card-summary shape the board + panel expect.
// ---------------------------------------------------------------------------
import { signalPoints, signalCompletion } from './leadScoring.js';

function parseOptions(options) {
  if (options == null) return null;
  if (typeof options !== 'string') return options; // jsonb arrives parsed
  try {
    return JSON.parse(options);
  } catch {
    return null;
  }
}

// Short currency for chips/cards: 45000000 -> "$45M".
function shortMoney(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return String(n);
  if (v >= 1e9) return `$${+(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${+(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${+(v / 1e3).toFixed(0)}K`;
  return `$${v}`;
}

// Human label for a stored signal value (used in chips).
function displayValue(cfg, value) {
  if (value == null || String(value).trim() === '') return null;
  if (cfg.input_type === 'number') return shortMoney(value);
  if (cfg.input_type === 'text') return value;
  if (cfg.has_date) return 'Yes'; // recent_funding stores a date when "Yes"
  const opts = parseOptions(cfg.options);
  const hit = Array.isArray(opts) ? opts.find((o) => o.value === value) : null;
  return hit ? hit.label : value;
}

// Top N filled, scoreable signals as chips, highest points first.
export function topSignals(configs, signalMap, n = 3) {
  const chips = [];
  for (const cfg of configs) {
    if (cfg.input_type === 'derived') continue;
    const raw = signalMap[cfg.signal_key];
    const value = raw?.value;
    const disp = displayValue(cfg, value);
    if (disp == null) continue;
    chips.push({
      signal_key: cfg.signal_key,
      label: cfg.label,
      display: disp,
      points: signalPoints(cfg, value, { contactCount: 0 }),
      max_points: cfg.max_points,
    });
  }
  chips.sort((a, b) => b.points - a.points || b.max_points - a.max_points);
  return chips.slice(0, n);
}

// Build the card summary for one lead row.
//   lead: row with vertical_name joined; configs: enriched scoring rows;
//   signalMap: { key: { value, notes } }; contactCount: number
export function buildLeadSummary(lead, configs, signalMap, contactCount) {
  return {
    id: lead.id,
    company_name: lead.company_name,
    website: lead.website,
    vertical_id: lead.vertical_id,
    vertical_name: lead.vertical_name ?? null,
    score: lead.score,
    score_updated_at: lead.score_updated_at,
    in_pipeline: !!lead.in_pipeline,
    is_client: !!lead.is_client,
    deal_id: lead.deal_id,
    completion: signalCompletion(configs, signalMap, contactCount),
    contact_count: contactCount,
    top_signals: topSignals(configs, signalMap),
    created_at: lead.created_at,
    updated_at: lead.updated_at,
  };
}
