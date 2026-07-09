// ---------------------------------------------------------------------------
// Default scoring rubric + structural metadata.
// Ported from the former Express server (server/src/scoringDefaults.js).
//
// The DB (scoring_config) stores only point values; the structural flags
// (has_notes / has_text / has_date / recency_months) are NOT user-editable and
// live here, keyed by signal_key, merged onto rows at load via enrichConfig().
//
// `options` shape by input_type:
//   select  / toggle  -> [{ value, label, points }]
//   number  (revenue) -> [{ min, max, points }]   (ranges; no match = 0)
//   derived (contacts)-> [{ min, points }]         (>= min contacts = points)
//   text              -> null (informational, never scores)
// ---------------------------------------------------------------------------

// Category display order on the board / config page.
export const CATEGORY_ORDER = [
  'Trackability & Tech Stack',
  'Performance Marketing Maturity',
  'Paid Media Activity',
  'Company Growth Signals',
  'Relationship & Access',
  'Intelligence Quality',
];

// Helper for the common Yes / No / Unknown toggle.
const toggle = (yesPoints) => [
  { value: 'Yes', label: 'Yes', points: yesPoints },
  { value: 'No', label: 'No', points: 0 },
  { value: 'Unknown', label: 'Unknown', points: 0 },
];

export const DEFAULT_SCORING_CONFIG = [
  // --- Trackability & Tech Stack (25) ---
  {
    signal_key: 'mmp',
    label: 'MMP',
    category: 'Trackability & Tech Stack',
    input_type: 'select',
    max_points: 20,
    options: [
      { value: 'everflow', label: 'Everflow', points: 20 },
      { value: 'appsflyer', label: 'AppsFlyer', points: 14 },
      { value: 'impact', label: 'Impact', points: 14 },
      { value: 'branch', label: 'Branch', points: 10 },
      { value: 'other', label: 'Other', points: 6 },
      { value: 'unknown', label: 'Unknown', points: 0 },
    ],
  },
  {
    signal_key: 'payable_event_clarity',
    label: 'Payable Event Clarity',
    category: 'Trackability & Tech Stack',
    input_type: 'select',
    max_points: 5,
    options: [
      { value: 'clear', label: 'Clear', points: 5 },
      { value: 'murky', label: 'Murky', points: 2 },
      { value: 'unknown', label: 'Unknown', points: 0 },
    ],
  },
  {
    signal_key: 'payable_event_label',
    label: 'Payable Event',
    category: 'Trackability & Tech Stack',
    input_type: 'text',
    max_points: 0,
    options: null,
  },

  // --- Performance Marketing Maturity (25) ---
  {
    signal_key: 'affiliate_department',
    label: 'Affiliate Department Exists',
    category: 'Performance Marketing Maturity',
    input_type: 'toggle',
    max_points: 10,
    options: toggle(10),
  },
  {
    signal_key: 'creator_campaigns',
    label: 'Has Run Creator / Influencer Campaigns',
    category: 'Performance Marketing Maturity',
    input_type: 'toggle',
    max_points: 8,
    options: toggle(8),
    has_notes: true,
  },
  {
    signal_key: 'tracked_performance',
    label: 'Has Run Tracked Performance Campaigns',
    category: 'Performance Marketing Maturity',
    input_type: 'toggle',
    max_points: 7,
    options: toggle(7),
    has_notes: true,
  },

  // --- Paid Media Activity (15) ---
  {
    signal_key: 'meta_ads',
    label: 'Running Meta Ads',
    category: 'Paid Media Activity',
    input_type: 'toggle',
    max_points: 6,
    options: toggle(6),
    has_notes: true,
  },
  {
    signal_key: 'youtube_integrations',
    label: 'Running YouTube Influencer Integrations',
    category: 'Paid Media Activity',
    input_type: 'toggle',
    max_points: 5,
    options: toggle(5),
    has_notes: true,
  },
  {
    signal_key: 'paid_social_activity',
    label: 'General Paid Social Activity',
    category: 'Paid Media Activity',
    input_type: 'select',
    max_points: 4,
    options: [
      { value: 'high', label: 'High', points: 4 },
      { value: 'medium', label: 'Medium', points: 2 },
      { value: 'low', label: 'Low', points: 1 },
      { value: 'none', label: 'None', points: 0 },
    ],
  },

  // --- Company Growth Signals (20) ---
  {
    signal_key: 'revenue',
    label: 'Revenue',
    category: 'Company Growth Signals',
    input_type: 'number',
    max_points: 8,
    // Revenue ranges (USD). No matching range => 0 (outside ICP).
    options: [
      { min: 10000000, max: 150000000, points: 8 }, // $10M–$150M sweet spot
      { min: 1000000, max: 9999999, points: 4 }, // $1M–$9.9M partial
      { min: 150000001, max: 500000000, points: 4 }, // $150M–$500M partial
    ],
  },
  {
    signal_key: 'recent_funding',
    label: 'Recent Funding Round',
    category: 'Company Growth Signals',
    input_type: 'toggle',
    max_points: 6,
    options: toggle(6),
    // Scores only when "Yes" AND the funding date is within this many months.
    has_date: true,
    recency_months: 18,
  },
  {
    signal_key: 'hiring_growth',
    label: 'Hiring for Performance / Growth / Creator Roles',
    category: 'Company Growth Signals',
    input_type: 'toggle',
    max_points: 6,
    options: toggle(6),
    has_notes: true,
  },

  // --- Relationship & Access (10) ---
  {
    signal_key: 'warm_contact',
    label: 'Warm Contact Exists',
    category: 'Relationship & Access',
    input_type: 'toggle',
    max_points: 5,
    options: toggle(5),
  },
  {
    signal_key: 'decision_maker',
    label: 'Decision Maker Identified',
    category: 'Relationship & Access',
    input_type: 'toggle',
    max_points: 3,
    options: toggle(3),
    has_text: true, // name captured in notes
  },
  {
    signal_key: 'prior_engagement',
    label: 'Prior Panel Engagement',
    category: 'Relationship & Access',
    input_type: 'toggle',
    max_points: 2,
    options: toggle(2),
    has_notes: true,
  },

  // --- Intelligence Quality (5) ---
  {
    signal_key: 'key_contacts',
    label: 'Key Contacts Added',
    category: 'Intelligence Quality',
    input_type: 'derived', // computed from lead_contacts count, not entered
    max_points: 5,
    options: [
      { min: 2, points: 5 },
      { min: 1, points: 2 },
      { min: 0, points: 0 },
    ],
  },
];

// Structural metadata that is NOT user-editable and therefore lives in code
// rather than the scoring_config table: which signals carry a notes field, a
// text field, or a date with a recency window. Keyed by signal_key.
export const STRUCTURAL_META = Object.fromEntries(
  DEFAULT_SCORING_CONFIG.map((c) => [
    c.signal_key,
    {
      has_notes: !!c.has_notes,
      has_text: !!c.has_text,
      has_date: !!c.has_date,
      ...(c.recency_months != null ? { recency_months: c.recency_months } : {}),
    },
  ]),
);

// Merge structural flags onto a scoring_config row (or rows) read from the DB.
// Use this everywhere config is loaded so scoring + UI see the full shape.
export function enrichConfig(row) {
  return { ...row, ...(STRUCTURAL_META[row.signal_key] ?? {}) };
}
export function enrichConfigs(rows) {
  return rows.map(enrichConfig);
}
