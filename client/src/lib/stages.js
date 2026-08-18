// ---------------------------------------------------------------------------
// Client mirror of the stage framework (see server/src/stages.js).
// Keep labels/codes in sync with the backend if they ever change.
// ---------------------------------------------------------------------------
import { todayInput } from './dates.js';

export const STAGES = [
  { code: 'P1', label: 'Target', group: 'prospecting' },
  { code: 'P2', label: 'Intent Flagged', group: 'prospecting' },
  { code: 'S1', label: 'Outreach Sent', group: 'sales' },
  { code: 'S2', label: 'Client Replied', group: 'sales' },
  { code: 'S3', label: 'Meeting Booked', group: 'sales' },
  { code: 'S4', label: 'Meetings Finished', group: 'sales' },
  { code: 'WON', label: 'Closed - Won', group: 'terminal' },
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

// The sales cycle split across two pages: active outreach (S1-S3, Kanban)
// and completed meetings (S4, table). See OutreachView/MeetingsView. Kept
// as S1-S3 (not the full funnel) since this also drives "pre-meeting"
// semantics elsewhere — the Convert-to-meeting picker and the Outreach
// header's active-deal count — that shouldn't shift just because the board
// now renders more columns.
export const OUTREACH_STAGES = ['S1', 'S2', 'S3'];

// Every stage shown as a column on the Outreach Kanban board, in display
// order — the full sales funnel including both terminal outcomes. Also
// drives the ordering on the Stage Weights admin page.
export const FUNNEL_STAGES = ['S1', 'S2', 'S3', 'S4', 'WON', 'LOST'];

// Linear forward path (excludes LOST, a branch rather than a forward step).
// WON is the true terminal "won" stage, reached via nextStageCode('S4').
export const FORWARD_PATH = [...PROSPECTING_STAGES, ...SALES_STAGES, 'WON'];

// Next stage code on the forward path, or null at the end / for LOST.
export function nextStageCode(code) {
  const idx = FORWARD_PATH.indexOf(code);
  if (idx === -1 || idx === FORWARD_PATH.length - 1) return null;
  return FORWARD_PATH[idx + 1];
}

// 'Dev' is only added in dev builds so the local-dev bypass account
// (dev@panel.local) resolves to a real owner — notes, mentions, and owner
// dropdowns all work when testing locally — without polluting the owner
// list real users pick from in production.
export const OWNERS = import.meta.env.DEV
  ? ['Tom', 'Raven', 'Andrew', 'Kevin', 'Dev']
  : ['Tom', 'Raven', 'Andrew', 'Kevin'];

// Resolve a signed-in user's email to an OWNERS name, e.g.
// tom@panelforcreators.com -> 'Tom' (matched on the local part,
// case-insensitively). Returns null if there's no match (e.g. the
// local-dev-only bypass account) — callers should fall back gracefully.
export function ownerFromEmail(email) {
  if (!email) return null;
  const local = email.split('@')[0]?.toLowerCase();
  return OWNERS.find((o) => o.toLowerCase() === local) ?? null;
}
export const SOURCES = ['Outbound', 'Inbound', 'Referral'];
export const CHANNELS = ['Email', 'LinkedIn', 'Slack', 'Mixed'];

// Company lifecycle status (manual, separate from the deal pipeline).
export const COMPANY_STATUSES = ['Researching', 'Contacted', 'Active', 'Passed'];
export const TOUCH_TYPES = ['Email', 'LinkedIn', 'Slack', 'Call'];
export const TOUCH_OUTCOMES = ['No Response', 'Responded', 'Booked', 'Completed', 'Other'];

// Stakeholder roles on a deal (client-validated only, no DB check constraint,
// same convention as current_stage/touch_type).
export const STAKEHOLDER_ROLES = ['Champion', 'Economic Buyer', 'Blocker', 'Influencer', 'Other'];

// How a finished meeting went (client-validated only, same convention as
// STAKEHOLDER_ROLES/TOUCH_OUTCOMES — no DB check constraint).
export const MEETING_OUTCOMES = ['Went Well', 'Needs Follow-up', 'Not a Fit', 'No Show'];

// A task is overdue once it's still open and its due date has passed.
// Never stored — always computed at read/render time.
export function isTaskOverdue(task) {
  if (!task || task.status !== 'open' || !task.due_date) return false;
  return new Date(task.due_date) < new Date(todayInput());
}

// ---------------------------------------------------------------------------
// Snooze: a deal parked until a future date (see 0048_deal_snooze).
// deals.snoozed_until is the only stored signal — "still snoozed?" and "snooze
// ended but not yet cleared?" are derived here at render time and never
// stored, the same convention as isTaskOverdue above and days_in_stage.
// ---------------------------------------------------------------------------

// null (never snoozed / cleared) | 'active' (wake date still ahead) |
// 'ended' (wake date reached, deal is back on the board, not yet cleared).
export function snoozeStatus(deal) {
  const until = deal?.snoozed_until;
  if (!until) return null;
  // Both sides are canonical "YYYY-MM-DD" (PostgREST serializes a `date`
  // column as that string), so a plain lexicographic compare is chronological
  // — and unlike isTaskOverdue's Date compare it has no timezone failure mode
  // at all, which is the safer pattern for date-only columns. A deal wakes ON
  // its snoozed_until date, not the day after.
  return until > todayInput() ? 'active' : 'ended';
}

// Snoozed deals are hidden from the Outreach board by default and are ALWAYS
// excluded from the weighted pipeline total, even while the "Show snoozed"
// toggle has them on screen.
export const isDealSnoozed = (deal) => snoozeStatus(deal) === 'active';

// ---------------------------------------------------------------------------
// Ad Tracker: per-client creator-ad pipeline (see ad_items/ad_item_stage_history).
// Small, purpose-built stage list — deliberately not the generic lanes/tasks
// engine tried in the (removed) Activation Surface.
// ---------------------------------------------------------------------------
export const AD_STAGES = [
  { code: 'submitted', label: 'Submitted' },
  { code: 'sent_to_brand', label: 'Sent to Brand' },
  { code: 'brand_approved', label: 'Brand Approved' },
  { code: 'live', label: 'Live', group: 'terminal' },
  { code: 'rejected', label: 'Rejected', group: 'terminal' },
];
export const AD_STAGE_LABELS = Object.fromEntries(AD_STAGES.map((s) => [s.code, s.label]));
export const AD_FORWARD_PATH = ['submitted', 'sent_to_brand', 'brand_approved', 'live'];

export function nextAdStageCode(code) {
  const idx = AD_FORWARD_PATH.indexOf(code);
  if (idx === -1 || idx === AD_FORWARD_PATH.length - 1) return null;
  return AD_FORWARD_PATH[idx + 1];
}

export const PLATFORMS = ['TikTok', 'Instagram', 'YouTube', 'Other'];

// SLA clock starts when an item first hits 'brand_approved' (ad_item_summaries
// .approved_at) and runs for AD_SLA_DAYS. Not applicable once the item is
// terminal (live/rejected) or hasn't been approved yet.
export const AD_SLA_DAYS = 14;

// { daysLeft, overdue } computed at render time only — never stored, same
// convention as isTaskOverdue/daysInStage.
export function adSlaStatus(item) {
  if (!item?.approved_at || item.current_stage === 'live' || item.current_stage === 'rejected') {
    return null;
  }
  const due = new Date(item.approved_at).getTime() + AD_SLA_DAYS * 24 * 60 * 60 * 1000;
  const daysLeft = Math.ceil((due - Date.now()) / (24 * 60 * 60 * 1000));
  return { daysLeft, overdue: daysLeft < 0 };
}

// Color bucket for the SLA badge: green with days to spare, yellow inside 3
// days, red once overdue.
export function adSlaColor(status) {
  if (!status) return 'text-text-disabled';
  if (status.overdue) return 'text-red-400';
  if (status.daysLeft <= 3) return 'text-yellow-400';
  return 'text-signal';
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
