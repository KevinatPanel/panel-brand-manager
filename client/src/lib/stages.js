// ---------------------------------------------------------------------------
// Client mirror of the stage framework (see server/src/stages.js).
// Keep labels/codes in sync with the backend if they ever change.
// ---------------------------------------------------------------------------

export const STAGES = [
  { code: 'P1', label: 'Target', group: 'prospecting' },
  { code: 'P2', label: 'Intent Flagged', group: 'prospecting' },
  { code: 'S1', label: 'Outreach Sent', group: 'sales' },
  { code: 'S2', label: 'Conversation Open', group: 'sales' },
  { code: 'S3', label: 'Meeting Booked', group: 'sales' },
  { code: 'S4', label: 'Meeting Completed', group: 'sales' },
  { code: 'LOST', label: 'Closed Lost', group: 'terminal' },
];

// Retired stage codes (S5–S7, A1–A5). No longer part of the active pipeline
// (the activation phase was removed), but old stage_history rows and any deal
// still sitting in one of these stages need their labels resolvable so
// historical timelines render instead of going blank.
export const LEGACY_STAGE_LABELS = {
  S5: 'Pitched',
  S6: 'Pilot Agreed',
  S7: 'MSA Signed',
  A1: 'Kickoff',
  A2: 'Assets Pending',
  A3: 'Recruiting Live',
  A4: 'First Post Live',
  A5: 'First Conversion',
};

export const STAGE_LABELS = {
  ...LEGACY_STAGE_LABELS,
  ...Object.fromEntries(STAGES.map((s) => [s.code, s.label])),
};

// Stage code lists per board.
export const SALES_STAGES = ['S1', 'S2', 'S3', 'S4'];
export const PROSPECTING_STAGES = ['P1', 'P2'];

// Linear forward path (excludes LOST). S4 is the terminal stage — a deal is
// won once it reaches S4.
export const FORWARD_PATH = [...PROSPECTING_STAGES, ...SALES_STAGES];

// Next stage code on the forward path, or null at the end / for LOST.
export function nextStageCode(code) {
  const idx = FORWARD_PATH.indexOf(code);
  if (idx === -1 || idx === FORWARD_PATH.length - 1) return null;
  return FORWARD_PATH[idx + 1];
}

export const OWNERS = ['Tom', 'Raven', 'Andrew', 'Kevin'];
export const SOURCES = ['Outbound', 'Inbound', 'Referral'];
export const CHANNELS = ['Email', 'LinkedIn', 'Slack', 'Mixed'];

// Company lifecycle status (manual, separate from the deal pipeline).
export const COMPANY_STATUSES = ['Researching', 'Contacted', 'Active', 'Passed'];
export const TOUCH_TYPES = ['Email', 'LinkedIn', 'Slack', 'Call'];
export const TOUCH_OUTCOMES = ['No Response', 'Responded', 'Booked', 'Completed', 'Other'];

// Color bucket for "days in stage": green 0–7, yellow 8–14, red 15+.
export function daysInStageColor(days) {
  if (days <= 7) return 'text-signal';
  if (days <= 14) return 'text-yellow-400';
  return 'text-red-400';
}

// A deal is "stale" once it has sat in its current stage longer than this many
// days — surfaced as a red flag on the Kanban card. Terminal (LOST) deals never
// flag. Tune the threshold here.
export const STALE_STAGE_DAYS = 10;

export function isStaleInStage(deal) {
  if (!deal || deal.current_stage === 'LOST') return false;
  return (deal.days_in_stage ?? 0) > STALE_STAGE_DAYS;
}

// Format an integer dollar amount as currency (no cents).
export function formatCurrency(amount) {
  if (amount == null) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount);
}
