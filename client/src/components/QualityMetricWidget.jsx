import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Eyebrow, IconButton } from './ui.jsx';
import QualityMetricModal from './QualityMetricModal.jsx';
import QualityLineChart from './QualityLineChart.jsx';

const PAST_MONTHS = 2; // + current month = 3 points; no future points (no "goal" concept for quality)

// First-of-month date string (YYYY-MM-DD), `offset` months from the current one.
function monthKey(offset = 0) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function monthShortLabel(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short' });
}

// null (not 0%) whenever billed_event_count is missing/zero — never a
// divide-by-zero, never a misleading 0%.
function qualityPct(row) {
  if (!row || row.billed_event_count == null || row.billed_event_count <= 0) return null;
  return Math.round(((row.event_count ?? 0) / row.billed_event_count) * 100);
}

// Averages a vertical's pct values per month — partial averaging: a member
// missing a given month is simply excluded from that month's average, not
// treated as 0 (same "gap, not zero" semantics as a single client's own
// missing month).
function avgPctByMonth(rows) {
  const byMonth = new Map();
  rows.forEach((r) => {
    const pct = qualityPct(r);
    if (pct == null) return;
    if (!byMonth.has(r.month)) byMonth.set(r.month, []);
    byMonth.get(r.month).push(pct);
  });
  const result = new Map();
  byMonth.forEach((vals, month) => result.set(month, Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)));
  return result;
}

// Fetches this client's vertical's quality data (every member, including
// this client — ONE shared average per vertical, same number on every
// member's page) for the benchmark line — null if there's nobody in the
// vertical with quality tracking configured, so callers can skip the second
// series entirely.
async function fetchVerticalAvgRows(lead) {
  const members = await api.listVerticalMemberIds(lead.vertical_id);
  const withEvent = members.filter((p) => p.everflow_quality_event_name);
  if (withEvent.length === 0) return null;
  const rows = await api.listQualityActualsForLeads(withEvent.map((p) => p.id));
  // Only rows matching each member's CURRENT event name — a member's event
  // name can change over time, and old rows under a stale name are kept as
  // history rather than overwritten, so they'd otherwise silently pollute
  // the average.
  const eventByLead = new Map(withEvent.map((p) => [p.id, p.everflow_quality_event_name]));
  return rows.filter((r) => r.event_name === eventByLead.get(r.lead_id));
}

// Compact month-over-month "quality percentage" trend for the client page's
// right sidebar: event_count / billed_event_count * 100 for the last 2
// months + the current month, as a line chart (see QualityLineChart.jsx —
// deliberately NOT a 0-100% scale, so month-to-month variation is legible),
// alongside a second benchmark line averaging the same metric across this
// client's whole vertical (including this client — one shared average per
// vertical, so the number is the same on every member's page).
// billed_event_count is the advertiser's base ("N/A"/untagged) conversion volume for that
// month — the same bucket that generates the revenue client_spend_actuals
// tracks — captured for free alongside the named quality event in the same
// Everflow call (see supabase/functions/_shared/everflow.ts). Read-only:
// populated by the same everflow-sync calls SpendGoalWidget's "Sync from
// Everflow" button already triggers; no separate sync action here.
export default function QualityMetricWidget({ lead }) {
  const [actuals, setActuals] = useState(null);
  const [avgRows, setAvgRows] = useState(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!lead.everflow_quality_event_name) {
      setActuals(null);
      setAvgRows(null);
      return;
    }
    api.listQualityActuals(lead.id).then(setActuals).catch(() => setActuals([]));
    fetchVerticalAvgRows(lead)
      .then(setAvgRows)
      .catch(() => setAvgRows(null));
  }, [lead.id, lead.everflow_quality_event_name, lead.vertical_id]);

  if (!lead.everflow_advertiser_id) return null;

  if (!lead.everflow_quality_event_name) {
    return (
      <div className="px-5 py-4 border-t border-hairline">
        <Eyebrow>Quality</Eyebrow>
        <div className="mt-2 text-text-disabled text-[12px]">
          Set a quality event name above (e.g. "Payroll") to track it here.
        </div>
      </div>
    );
  }

  const loading = actuals === null;
  // Only rows matching the CURRENTLY configured event name — if it was ever
  // renamed, older rows under the previous name stay in the table as
  // history (see migration 0037's unique-key rationale) but must not bleed
  // into "this month's" number under the new label.
  const actualByMonth = new Map(
    (actuals ?? [])
      .filter((a) => a.event_name === lead.everflow_quality_event_name)
      .map((a) => [a.month, a]),
  );
  const avgByMonth = avgRows ? avgPctByMonth(avgRows) : null;
  const months = Array.from({ length: PAST_MONTHS + 1 }, (_, i) => monthKey(i - PAST_MONTHS));
  const points = months.map((month, i) => {
    const row = actualByMonth.get(month) ?? null;
    return {
      label: monthShortLabel(month),
      isCurrent: i === PAST_MONTHS,
      pct: qualityPct(row),
      eventCount: row?.event_count ?? null,
    };
  });
  const avgPoints = avgByMonth
    ? months.map((month, i) => ({
        label: monthShortLabel(month),
        isCurrent: i === PAST_MONTHS,
        pct: avgByMonth.get(month) ?? null,
      }))
    : undefined;

  return (
    <div className="px-5 py-4 border-t border-hairline">
      <div className="flex items-center justify-between">
        <Eyebrow>Quality — {lead.everflow_quality_event_name}</Eyebrow>
        <IconButton
          icon="expand"
          title="Open full breakdown"
          aria-label="Open full breakdown"
          onClick={() => setExpanded(true)}
        />
      </div>
      {!loading && (
        <div className="mt-2">
          <QualityLineChart
            points={points}
            avgPoints={avgPoints}
            legend={{ selfLabel: lead.company_name, avgLabel: `${lead.vertical_name ?? 'Unsorted'} avg` }}
          />
        </div>
      )}
      {expanded && (
        <QualityMetricModal
          lead={lead}
          onClose={() => {
            setExpanded(false);
            api.listQualityActuals(lead.id).then(setActuals).catch(() => {});
          }}
        />
      )}
    </div>
  );
}
