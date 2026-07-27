import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { relativeTime } from '../lib/leads.js';
import { Modal } from './Overlay.jsx';
import { IconButton } from './ui.jsx';
import QualityLineChart from './QualityLineChart.jsx';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// First-of-month date string (YYYY-MM-DD) for the current month.
function currentMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

// YYYY-MM-01 for a given calendar year + 1-indexed month.
function yearMonthKey(year, month) {
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

// null (not 0%) whenever billed_event_count is missing/zero — never a
// divide-by-zero, never a misleading 0%. Mirrors QualityMetricWidget.jsx's
// qualityPct — kept duplicated (small, data-only helper) rather than shared.
function qualityPct(row) {
  if (!row || row.billed_event_count == null || row.billed_event_count <= 0) return null;
  return Math.round(((row.event_count ?? 0) / row.billed_event_count) * 100);
}

// Averages a vertical's pct values per month — partial averaging: a member
// missing a given month is simply excluded from that month's average, not
// treated as 0. Mirrors QualityMetricWidget.jsx's avgPctByMonth.
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
// this client — ONE shared average per vertical) for the benchmark line —
// null if there's nobody in the vertical with quality tracking configured.
// Mirrors QualityMetricWidget.jsx's fetchVerticalAvgRows.
async function fetchVerticalAvgRows(lead) {
  const members = await api.listVerticalMemberIds(lead.vertical_id);
  const withEvent = members.filter((p) => p.everflow_quality_event_name);
  if (withEvent.length === 0) return null;
  const rows = await api.listQualityActualsForLeads(withEvent.map((p) => p.id));
  const eventByLead = new Map(withEvent.map((p) => [p.id, p.everflow_quality_event_name]));
  return rows.filter((r) => r.event_name === eventByLead.get(r.lead_id));
}

// Expanded Quality breakdown: full month history (as far back as the client
// has synced quality actuals) plus the rest of the current year, as a line
// chart (see QualityLineChart.jsx) — the full-history counterpart to the
// compact QualityMetricWidget, mirroring SpendGoalModal.jsx's structure
// minus goal-editing (there's no client_quality_goals table; this is
// display-only, same as the widget). Also shows the vertical-average
// benchmark line (see QualityMetricWidget.jsx for the shared-average/match-
// current-event-name rationale). The chart's Y-domain rescales
// independently per selected year, to whatever that year's own combined
// min/max is.
export default function QualityMetricModal({ lead, onClose }) {
  const [actuals, setActuals] = useState(null);
  const [avgRows, setAvgRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const [selectedYear, setSelectedYear] = useState(() => new Date().getFullYear());

  const load = () => {
    api
      .listQualityActuals(lead.id)
      .then(setActuals)
      .catch(() => setActuals([]));
  };

  useEffect(load, [lead.id]);
  useEffect(() => {
    fetchVerticalAvgRows(lead)
      .then(setAvgRows)
      .catch(() => setAvgRows(null));
  }, [lead.id, lead.vertical_id]);

  async function after(fn) {
    setBusy(true);
    try {
      await fn();
      load();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  const loading = actuals === null;
  const canSync = !!lead.everflow_advertiser_id;
  const mostRecentSync = loading
    ? null
    : actuals.reduce((max, a) => (a.synced_at && (!max || a.synced_at > max) ? a.synced_at : max), null);

  const currentMonth = currentMonthKey();
  const nowYear = new Date().getFullYear();

  // Every year that has an actual, plus the current year always — most
  // recent first, same derivation SpendGoalModal.jsx uses for spend.
  const years = loading
    ? [nowYear]
    : [...new Set([nowYear, ...actuals.map((a) => Number(a.month.slice(0, 4)))])].sort((a, b) => b - a);

  // Full calendar year for whichever year is selected, Jan through Dec —
  // months with no actual just render as gaps in the line, same fallback as
  // the compact widget.
  const months = Array.from({ length: 12 }, (_, i) => yearMonthKey(selectedYear, i + 1));
  // Only rows matching the CURRENTLY configured event name — see
  // QualityMetricWidget.jsx's identical filter for the rationale (an older
  // event name's rows stay in the table as history, not overwritten, but
  // must not bleed into the current label's numbers).
  const actualByMonth = new Map(
    (actuals ?? [])
      .filter((a) => a.event_name === lead.everflow_quality_event_name)
      .map((a) => [a.month, a]),
  );
  const avgByMonth = avgRows ? avgPctByMonth(avgRows) : null;
  const points = months.map((month, i) => {
    const row = actualByMonth.get(month) ?? null;
    return {
      label: MONTH_NAMES[i],
      isCurrent: month === currentMonth,
      pct: qualityPct(row),
      eventCount: row?.event_count ?? null,
    };
  });
  const avgPoints = avgByMonth
    ? months.map((month, i) => ({
        label: MONTH_NAMES[i],
        isCurrent: month === currentMonth,
        pct: avgByMonth.get(month) ?? null,
      }))
    : undefined;

  return (
    <Modal title={`Quality — ${lead.everflow_quality_event_name}`} onClose={onClose} width="max-w-2xl">
      <div className="flex items-center justify-between mb-4">
        <div className="text-text-secondary text-[13px]">{lead.company_name}</div>
        <div className="flex items-center gap-2">
          {mostRecentSync && (
            <span className="text-text-disabled text-[11px]">synced {relativeTime(mostRecentSync)}</span>
          )}
          <IconButton
            icon="sync"
            disabled={busy || !canSync}
            title={canSync ? 'Pull all historical revenue + quality events from Everflow' : 'Add an Everflow Advertiser ID first'}
            aria-label="Sync from Everflow"
            onClick={() => after(() => api.syncSpendActuals(lead.id))}
          />
        </div>
      </div>

      {!loading && (
        <div className="flex items-center gap-1.5 mb-4">
          {years.map((y) => (
            <button
              key={y}
              onClick={() => setSelectedYear(y)}
              className={`px-2.5 py-1 font-mono font-medium text-[12px] border transition-colors ${
                y === selectedYear
                  ? 'border-signal/50 text-signal'
                  : 'border-hairline text-text-muted hover:text-text-primary hover:bg-card-hover'
              }`}
            >
              {y}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="text-text-secondary text-[13px]">Loading…</div>
      ) : (
        <QualityLineChart
          points={points}
          avgPoints={avgPoints}
          legend={{ selfLabel: lead.company_name, avgLabel: `${lead.vertical_name ?? 'Unsorted'} avg` }}
          width={600}
          height={220}
        />
      )}
    </Modal>
  );
}
