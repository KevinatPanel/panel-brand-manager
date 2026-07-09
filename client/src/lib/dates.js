// ---------------------------------------------------------------------------
// Date helpers shared across views.
// ---------------------------------------------------------------------------

// Human-readable date (e.g. "Jun 9, 2026").
export const fmtDate = (iso) =>
  iso
    ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '—';

// ISO timestamp -> "YYYY-MM-DD" in local time, for <input type="date"> values.
export function toDateInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

// Today's date as a "YYYY-MM-DD" string (local).
export const todayInput = () => toDateInput(new Date().toISOString());

const DAY_MS = 24 * 60 * 60 * 1000;

export const nowIso = () => new Date().toISOString();

// Convert a date input into an ISO timestamp. A date-only string (YYYY-MM-DD,
// from <input type="date">) is anchored at local noon so it renders as the
// intended calendar day regardless of timezone. Falsy/invalid input -> now.
// (Ported from the former server helpers — preserves the backdating behavior.)
export function normalizeDateInput(value) {
  if (!value) return nowIso();
  const s = String(value).trim();
  const candidate = /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T12:00:00` : s;
  const d = new Date(candidate);
  return Number.isNaN(d.getTime()) ? nowIso() : d.toISOString();
}

// Whole (floored) days between two ISO datetimes; b defaults to now.
export function daysBetween(aIso, bIso = nowIso()) {
  const a = new Date(aIso).getTime();
  const b = new Date(bIso).getTime();
  return Math.max(0, Math.floor((b - a) / DAY_MS));
}
