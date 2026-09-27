import { useCallback, useEffect, useMemo, useState } from 'react';
import ViewHeader from '../components/ViewHeader.jsx';
import Toolbar from '../components/Toolbar.jsx';
import { Button, Eyebrow, IconButton, Input } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { fmtDateOnly } from '../lib/dates.js';
import { useDeals } from '../state/DealsContext.jsx';
import { brandStats } from '../lib/callStats.js';
import {
  BarChart,
  BuyInMoments,
  ChartSection,
  ProfileMatrix,
  ThemeHeatmap,
} from '../components/calls/CallCharts.jsx';

// Calls: every uploaded meeting transcript as one row of data — who was on the
// call, how long, what the brand pushed on, where they bought in, the payout
// they named, and the action items. The numbers come from call_insights (0049),
// which the analyze-transcript Edge Function fills in from each transcript.
// Nothing here is a recommendation; it's what was said on the call.

// A pending run that hasn't finished in this long died in the background —
// show it as stalled so it can be retried instead of spinning forever.
const STALE_MS = 10 * 60 * 1000;

const RESULT_LABELS = { yes: 'Yes', follow_up: 'Follow-up', no: 'No', unclear: 'Unclear' };
const RESULT_FILTERS = [
  { key: '', label: 'All' },
  { key: 'yes', label: 'Yes' },
  { key: 'follow_up', label: 'Follow-up' },
  { key: 'no', label: 'No' },
];

const CALL_COLUMNS = [
  { key: 'date', label: 'Date' },
  { key: 'brand', label: 'Brand' },
  { key: 'brand_side', label: 'Brand side' },
  { key: 'panel_side', label: 'Panel side' },
  { key: 'minutes', label: 'Min' },
  { key: 'questions_count', label: 'Qs' },
  { key: 'outcome', label: 'Outcome' },
  { key: 'result', label: 'Result' },
];

const BRAND_COLUMNS = [
  { key: 'brand', label: 'Brand' },
  { key: 'vertical', label: 'Vertical' },
  { key: 'firstEmail', label: 'First email' },
  { key: 'firstCall', label: 'First call' },
  { key: 'callCount', label: 'Calls' },
  { key: 'minutes', label: 'Minutes' },
  { key: 'questions', label: 'Questions' },
  { key: 'yesDate', label: 'Yes' },
  { key: 'wonDate', label: 'Won' },
  { key: 'emailToCall', label: 'Email to call' },
  { key: 'callToYes', label: 'Call to yes' },
  { key: 'yesToWon', label: 'Yes to won' },
  { key: 'latestResult', label: 'Latest result' },
  { key: 'payout', label: 'Payout' },
];

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'log', label: 'Call log' },
  { key: 'brands', label: 'Brands' },
];

// Where a transcript's analysis stands: none | pending | stalled | error | done.
function stateOf(insight) {
  if (!insight) return 'none';
  if (insight.status === 'pending') {
    const t = insight.requested_at ? new Date(insight.requested_at).getTime() : 0;
    return Date.now() - t > STALE_MS ? 'stalled' : 'pending';
  }
  return insight.status === 'error' ? 'error' : 'done';
}

function sortRows(rows, { key, dir }) {
  const mul = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === 'string') return av.localeCompare(bv) * mul;
    return (av - bv) * mul;
  });
}

function useSort(initial) {
  const [sort, setSort] = useState(initial);
  const toggle = (key) =>
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  return [sort, toggle];
}

function SortHeader({ columns, sort, onSort }) {
  return (
    <tr className="border-b border-hairline">
      {columns.map((col) => (
        <th key={col.key} className="px-3 py-2 text-left font-normal whitespace-nowrap">
          <button
            onClick={() => onSort(col.key)}
            className="eyebrow text-text-muted hover:text-text-secondary transition-colors"
          >
            {col.label}
            {sort.key === col.key && (sort.dir === 'asc' ? ' ↑' : ' ↓')}
          </button>
        </th>
      ))}
    </tr>
  );
}

function ResultPill({ result }) {
  if (!result) return <span className="text-text-disabled">—</span>;
  const styles = {
    yes: 'bg-signal text-space border-signal',
    follow_up: 'border-hairline text-text-primary',
    no: 'border-hairline text-text-muted',
    unclear: 'border-hairline text-text-disabled',
  }[result];
  return (
    <span className={`inline-block px-1.5 py-0.5 border font-mono text-[11px] whitespace-nowrap ${styles}`}>
      {RESULT_LABELS[result] ?? result}
    </span>
  );
}

function Stat({ value, label }) {
  return (
    <div className="border-l border-hairline pl-3">
      <div className="font-mono text-text-primary text-[20px] leading-tight">{value}</div>
      <div className="eyebrow text-text-muted mt-1">{label}</div>
    </div>
  );
}

function DetailList({ label, items }) {
  if (!items?.length) return null;
  return (
    <div>
      <Eyebrow className="mb-1.5">{label}</Eyebrow>
      <ul className="space-y-1">
        {items.map((item, i) => (
          <li key={i} className="relative pl-4 text-text-secondary text-[13px]">
            <span className="absolute left-0 top-[7px] w-1.5 h-1.5 bg-text-muted" />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

// The expanded half of a call row: everything Claude pulled from the transcript.
function CallDetail({ row, onAnalyze, onOpenFile }) {
  const ins = row.insight;
  const facts = [
    ['Payout', ins?.payout],
    ['Cap', ins?.budget_cap],
    ['Pays on', ins?.payable_event],
    ['Next step', ins?.next_step],
    ['Sign-off', (ins?.decision_layers ?? []).join(', ')],
  ].filter(([, v]) => v);

  return (
    <div className="px-3 pt-2 pb-5 grid gap-5 lg:grid-cols-2">
      <div className="space-y-4">
        {ins?.summary && <p className="text-text-primary text-[13px] max-w-prose">{ins.summary}</p>}
        {facts.length > 0 && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
            {facts.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="eyebrow text-text-muted pt-0.5">{k}</dt>
                <dd className="text-text-secondary">{v}</dd>
              </div>
            ))}
          </dl>
        )}
        <DetailList
          label="Action items"
          items={(ins?.action_items ?? []).map(
            (a) => `${a.owner ? `${a.owner}: ` : ''}${a.task}${a.due ? ` (${a.due})` : ''}`,
          )}
        />
      </div>
      <div className="space-y-4">
        {ins?.buy_in_quote && (
          <div>
            <Eyebrow className="mb-1.5">Where they bought in{ins.buy_in_at ? ` · ${ins.buy_in_at}` : ''}</Eyebrow>
            <p className="text-text-primary text-[15px] italic max-w-prose">“{ins.buy_in_quote}”</p>
            {ins.buy_in_before && (
              <p className="text-text-muted text-[12px] mt-1.5 max-w-prose">Right before: {ins.buy_in_before}</p>
            )}
          </div>
        )}
        <DetailList label="What they pushed on" items={ins?.objections} />
        <div className="flex items-center gap-3 pt-1">
          {row.source === 'tactiq' ? (
            ins?.source_url && (
              <a
                href={ins.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-text-secondary hover:text-signal text-[12px] truncate"
              >
                Open in Tactiq · {row.filename}
              </a>
            )
          ) : (
            <>
              <button onClick={() => onOpenFile(row)} className="text-text-secondary hover:text-signal text-[12px] truncate">
                {row.filename}
              </button>
              <Button variant="ghost" onClick={() => onAnalyze(row.id)}>Re-analyze</Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function CallsView() {
  const { deals, openDeal } = useDeals();
  const [rows, setRows] = useState(null);
  const [setupPending, setSetupPending] = useState(false);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [query, setQuery] = useState('');
  const [resultFilter, setResultFilter] = useState('');
  const [expanded, setExpanded] = useState(null);
  const [tab, setTab] = useState('overview');
  const [callSort, toggleCallSort] = useSort({ key: 'date', dir: 'desc' });
  const [brandSort, toggleBrandSort] = useSort({ key: 'firstCall', dir: 'desc' });

  const load = useCallback(async () => {
    try {
      const res = await api.listCalls();
      setRows(res.calls);
      setSetupPending(res.setupPending);
      setError(null);
    } catch (e) {
      setError(e.message);
      setRows((cur) => cur ?? []); // don't leave the page stuck on "Loading…"
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const brandOf = useMemo(() => {
    const m = new Map(deals.map((d) => [d.id, d.company_name]));
    return (dealId) => m.get(dealId) ?? 'Unknown brand';
  }, [deals]);

  // Flatten each transcript + its insight into one sortable call row.
  const calls = useMemo(
    () =>
      (rows ?? []).map((r) => {
        const ins = r.insight;
        return {
          ...r,
          state: stateOf(ins),
          date: ins?.call_date ?? r.created_at?.slice(0, 10) ?? null,
          brand: brandOf(r.deal_id),
          brand_side: ins?.brand_side ?? null,
          panel_side: ins?.panel_side ?? null,
          minutes: ins?.minutes ?? null,
          questions_count: ins?.questions_count ?? null,
          outcome: ins?.outcome ?? null,
          result: ins?.result ?? null,
        };
      }),
    [rows, brandOf],
  );

  // While anything is being read, check back every few seconds.
  const anyPending = calls.some((c) => c.state === 'pending');
  useEffect(() => {
    if (!anyPending) return undefined;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [anyPending, load]);

  const analyze = useCallback(
    async (attachmentId) => {
      try {
        await api.analyzeTranscript(attachmentId);
      } catch (e) {
        setError(e.message);
      }
      await load();
    },
    [load],
  );

  const toAnalyze = calls.filter(
    (c) => c.id != null && (c.state === 'none' || c.state === 'error' || c.state === 'stalled'),
  );
  async function analyzeAll() {
    setStarting(true);
    try {
      for (const c of toAnalyze) {
        await api.analyzeTranscript(c.id).catch(() => {});
      }
      await load();
    } finally {
      setStarting(false);
    }
  }

  async function openFile(row) {
    try {
      const url = await api.getAttachmentDownloadUrl(row);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      setError(e.message);
    }
  }

  const q = query.trim().toLowerCase();
  const filtered = calls.filter((c) => {
    if (resultFilter && c.result !== resultFilter) return false;
    if (!q) return true;
    const ins = c.insight ?? {};
    const hay = [
      c.brand, c.brand_side, c.panel_side, c.outcome, c.filename, c.date,
      ins.summary, ins.payout, ins.payable_event, ...(ins.objections ?? []),
    ].join(' ').toLowerCase();
    return hay.includes(q);
  });
  const sortedCalls = sortRows(filtered, callSort);

  // Per-brand numbers for the charts and the Brands tab. The first-email and
  // won dates come from touch_log / stage_history, fetched for the brands on
  // analyzed calls.
  const doneDealIds = useMemo(
    () => [...new Set(calls.filter((c) => c.state === 'done').map((c) => c.deal_id))].sort(),
    [calls],
  );
  const [timeline, setTimeline] = useState({ firstEmail: {}, won: {} });
  const dealKey = doneDealIds.join(',');
  useEffect(() => {
    let live = true;
    api
      .callTimelineContext(doneDealIds)
      .then((ctx) => live && setTimeline(ctx))
      .catch(() => {});
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealKey]);
  const brands = useMemo(() => brandStats(calls, deals, timeline), [calls, deals, timeline]);
  const sortedBrands = sortRows(brands, brandSort);

  const done = calls.filter((c) => c.state === 'done');
  const actionItems = done
    .flatMap((c) => (c.insight?.action_items ?? []).map((a) => ({ ...a, call: c })))
    .sort((a, b) => (b.call.date ?? '').localeCompare(a.call.date ?? ''));

  const loading = rows == null;

  return (
    <div>
      <ViewHeader title="Calls" subtitle="Every brand call, straight from the meeting transcripts">
        {toAnalyze.length > 0 && !setupPending && (
          <Button variant="primary" disabled={starting} onClick={analyzeAll}>
            {starting ? 'Starting…' : `Analyze ${toAnalyze.length} transcript${toAnalyze.length === 1 ? '' : 's'}`}
          </Button>
        )}
        <IconButton
          icon="sync"
          disabled={refreshing}
          title={refreshing ? 'Refreshing…' : 'Refresh'}
          aria-label="Refresh calls"
          onClick={refresh}
        />
      </ViewHeader>

      {error && <div className="px-6 pt-4 text-red-400 text-[13px]">{error}</div>}
      {setupPending && (
        <div className="mx-6 mt-4 px-4 py-3 border border-hairline text-text-secondary text-[13px] max-w-3xl">
          Call data isn’t switched on yet: the database update for this page (migrations 0049 to
          0051) still needs to be applied in Supabase. Your transcripts are listed in the call log
          and will be read once it’s done.
        </div>
      )}

      {loading ? (
        <div className="px-6 py-10 text-text-secondary text-[13px]">Loading…</div>
      ) : calls.length === 0 ? (
        <div className="px-6 py-10 text-text-secondary text-[13px] max-w-xl">
          No calls yet. Brand calls recorded in Tactiq are added here automatically each weekday
          evening, and a transcript uploaded from a deal on the Meetings page shows up a minute or
          two after upload.
        </div>
      ) : (
        <>
          <div className="flex gap-1 px-6 pt-4 border-b border-hairline">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`relative px-3 pb-3 text-[13px] transition-colors ${
                  tab === t.key ? 'text-text-primary' : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                {t.label}
                {tab === t.key && <span className="absolute left-0 right-0 bottom-0 h-[2px] bg-signal" />}
              </button>
            ))}
          </div>

          {tab === 'overview' && (
            <Overview
              brands={brands}
              done={done}
              actionItems={actionItems}
              openDeal={openDeal}
            />
          )}

          {tab === 'log' && (
            <>
              <Toolbar
                left={
                  <>
                    <Input
                      type="search"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Filter calls…"
                      className="w-56"
                    />
                    {RESULT_FILTERS.map((f) => (
                      <Button
                        key={f.key}
                        variant={resultFilter === f.key ? 'primary' : 'secondary'}
                        className="whitespace-nowrap"
                        onClick={() => setResultFilter(f.key)}
                      >
                        {f.label}
                      </Button>
                    ))}
                  </>
                }
                right={<span className="font-mono text-text-muted text-[12px]">{filtered.length} of {calls.length} calls</span>}
              />

              <section className="px-3 py-2 overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <SortHeader columns={CALL_COLUMNS} sort={callSort} onSort={toggleCallSort} />
                  </thead>
                  <tbody>
                    {sortedCalls.map((c) => {
                      const open = expanded === c.key;
                      return (
                        <CallRows
                          key={c.key}
                          call={c}
                          open={open}
                          onToggle={() => setExpanded(open ? null : c.key)}
                          onAnalyze={analyze}
                          onOpenFile={openFile}
                          onOpenDeal={openDeal}
                          canAnalyze={!setupPending}
                        />
                      );
                    })}
                  </tbody>
                </table>
                {sortedCalls.length === 0 && (
                  <div className="px-3 py-8 text-text-disabled text-[13px]">No calls match.</div>
                )}
              </section>
            </>
          )}

          {tab === 'brands' && (
            <section className="px-3 pt-4 pb-10 overflow-x-auto">
              <p className="px-3 mb-3 text-text-muted text-[12px] max-w-3xl">
                First email is the earliest Email touch on the deal. Yes is the first call where the
                brand agreed to a pilot or test. Won is when the deal moved to Won. Day counts fill in
                as those dates exist.
              </p>
              {brands.length === 0 ? (
                <div className="px-3 py-8 text-text-disabled text-[13px]">No analyzed calls yet.</div>
              ) : (
                <table className="w-full text-[13px]">
                  <thead>
                    <SortHeader columns={BRAND_COLUMNS} sort={brandSort} onSort={toggleBrandSort} />
                  </thead>
                  <tbody>
                    {sortedBrands.map((b) => (
                      <tr key={b.deal_id} className="border-b border-hairline hover:bg-card-hover">
                        <td className="px-3 py-2 whitespace-nowrap">
                          <button onClick={() => openDeal(b.deal_id)} className="text-text-primary hover:text-signal font-medium">
                            {b.brand}
                          </button>
                        </td>
                        <td className="px-3 py-2 text-text-secondary whitespace-nowrap">{b.vertical ?? '—'}</td>
                        <td className="px-3 py-2 font-mono text-text-secondary whitespace-nowrap">{fmtDateOnly(b.firstEmail)}</td>
                        <td className="px-3 py-2 font-mono text-text-secondary whitespace-nowrap">{fmtDateOnly(b.firstCall)}</td>
                        <td className="px-3 py-2 font-mono text-text-secondary">{b.callCount}</td>
                        <td className="px-3 py-2 font-mono text-text-secondary">{b.minutes}</td>
                        <td className="px-3 py-2 font-mono text-text-secondary">{b.questions}</td>
                        <td className="px-3 py-2 font-mono text-text-secondary whitespace-nowrap">{fmtDateOnly(b.yesDate)}</td>
                        <td className="px-3 py-2 font-mono text-text-secondary whitespace-nowrap">{fmtDateOnly(b.wonDate)}</td>
                        <td className="px-3 py-2 font-mono text-text-secondary">{fmtDays(b.emailToCall)}</td>
                        <td className="px-3 py-2 font-mono text-text-secondary">{fmtDays(b.callToYes)}</td>
                        <td className="px-3 py-2 font-mono text-text-secondary">
                          {b.yesToWon != null ? fmtDays(b.yesToWon) : b.yesOpenDays != null ? `${b.yesOpenDays}+` : '—'}
                        </td>
                        <td className="px-3 py-2"><ResultPill result={b.latestResult} /></td>
                        <td className="px-3 py-2 text-text-secondary">{b.payout ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}

const fmtDays = (n) => (n == null ? '—' : `${n}`);

// The Overview tab: headline numbers, open action items, then the charts.
function Overview({ brands, done, actionItems, openDeal }) {
  const said = brands.filter((b) => b.yesDate);
  const fastest = [...brands].filter((b) => b.emailToCall != null).sort((a, b) => a.emailToCall - b.emailToCall)[0];
  const minOf = (rows) => Math.min(...rows.map((r) => r.value));

  // Calls it took to get a yes; brands that haven't said yes show striped at
  // the calls they've had so far.
  const toYes = [
    ...said.map((b) => ({
      key: b.deal_id, label: b.brand, value: b.callsToYes, display: `${b.callsToYes}`,
      tip: `${b.brand}: yes on call ${b.callsToYes}, ${fmtDateOnly(b.yesDate)}`,
    })),
    ...brands.filter((b) => !b.yesDate).map((b) => ({
      key: b.deal_id, label: b.brand, value: b.callCount, display: 'no', open: true,
      tip: `${b.brand}: no yes yet after ${b.callCount} call${b.callCount === 1 ? '' : 's'}`,
    })),
  ].sort((a, b) => (a.open === b.open ? a.value - b.value : a.open ? 1 : -1));
  const toYesMin = said.length ? Math.min(...said.map((b) => b.callsToYes)) : null;
  toYes.forEach((r) => { r.emphasis = !r.open && r.value === toYesMin; });

  const emailToCall = brands
    .filter((b) => b.emailToCall != null && b.emailToCall >= 0)
    .map((b) => ({
      key: b.deal_id, label: b.brand, value: b.emailToCall, display: `${b.emailToCall}`,
      tip: `${b.brand}: first email ${fmtDateOnly(b.firstEmail)}, first call ${fmtDateOnly(b.firstCall)}`,
    }))
    .sort((a, b) => a.value - b.value);
  if (emailToCall.length) {
    const m = minOf(emailToCall);
    emailToCall.forEach((r) => { r.emphasis = r.value === m; });
  }

  const yesToWon = said
    .map((b) =>
      b.wonDate
        ? { key: b.deal_id, label: b.brand, value: b.yesToWon, display: `${b.yesToWon}`,
            tip: `${b.brand}: yes ${fmtDateOnly(b.yesDate)}, won ${fmtDateOnly(b.wonDate)}` }
        : { key: b.deal_id, label: b.brand, value: b.yesOpenDays, display: `${b.yesOpenDays}+`, open: true,
            tip: `${b.brand}: yes ${fmtDateOnly(b.yesDate)}, not won yet` },
    )
    .sort((a, b) => a.value - b.value);
  const wonRows = yesToWon.filter((r) => !r.open);
  if (wonRows.length) {
    const m = minOf(wonRows);
    wonRows.forEach((r) => { r.emphasis = r.value === m; });
  }

  const minuteOfYes = said
    .filter((b) => b.yesMinute != null)
    .map((b) => ({
      key: b.deal_id, label: b.brand, value: b.yesMinute, display: b.yesStamp,
      tip: `${b.brand}: bought in at ${b.yesStamp} on call ${b.callsToYes}`,
    }))
    .sort((a, b) => a.value - b.value);

  const questions = brands
    .filter((b) => b.decidingQuestions != null)
    .map((b) => ({
      key: b.deal_id, label: b.brand, value: b.decidingQuestions, display: `${b.decidingQuestions}`,
      tip: `${b.brand}: ${b.decidingQuestions} questions on the ${b.decidingIsYes ? 'call where they said yes' : 'latest call'}`,
    }))
    .sort((a, b) => b.value - a.value);

  // Layers: named sign-offs; a brand that could sign alone counts as zero.
  const layers = brands
    .map((b) => {
      const n = b.decisionLayers.length;
      if (!n && b.profile.can_sign_alone !== true) return null;
      return {
        key: b.deal_id, label: b.brand, value: n, display: `${n}`, emphasis: n === 0,
        tip: n ? `${b.brand}: ${b.decisionLayers.join(', ')}` : `${b.brand}: could sign alone`,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.value - b.value);

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 px-6 py-5 border-b border-hairline">
        <Stat value={brands.length} label="Brands on calls" />
        <Stat value={done.length} label="Calls analyzed" />
        <Stat value={done.reduce((n, c) => n + (c.minutes ?? 0), 0)} label="Minutes on calls" />
        <Stat value={said.length} label="Brands that said yes" />
        <Stat
          value={fastest ? `${fastest.emailToCall} day${fastest.emailToCall === 1 ? '' : 's'}` : '—'}
          label={fastest ? `Fastest email to call (${fastest.brand})` : 'Fastest email to call'}
        />
        <Stat value={actionItems.length} label="Action items" />
      </div>

      {actionItems.length > 0 && (
        <section className="px-6 py-5 border-b border-hairline">
          <Eyebrow className="mb-3">Action items</Eyebrow>
          <ul className="max-h-64 overflow-y-auto divide-y divide-hairline">
            {actionItems.map((a, i) => (
              <li key={i} className="flex items-baseline gap-3 py-1.5 text-[13px]">
                <span className="font-mono text-text-muted text-[12px] w-24 shrink-0">{fmtDateOnly(a.call.date)}</span>
                <button
                  onClick={() => openDeal(a.call.deal_id)}
                  className="text-text-primary hover:text-signal w-32 shrink-0 truncate text-left"
                >
                  {a.call.brand}
                </button>
                <span className="text-text-secondary min-w-0">
                  {a.owner && <span className="text-text-primary">{a.owner}: </span>}
                  {a.task}
                  {a.due && <span className="text-text-muted"> ({a.due})</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ChartSection eyebrow="Shapes in the numbers" title="Where the time goes">
        <div className="grid gap-10 md:grid-cols-2 xl:grid-cols-3">
          <BarChart
            title="Calls it took to get a yes"
            rows={toYes}
            caption="Striped bars haven't said yes yet; the length is the calls so far."
          />
          <BarChart
            title="Days from first email to first call"
            rows={emailToCall}
            empty="Needs Email touches on the deal to measure."
          />
          <BarChart
            title="Days from yes to won"
            rows={yesToWon}
            caption="Striped bars aren't won yet; the number is days since the yes."
            empty="No brand has said yes yet."
          />
          <BarChart
            title="Minute of the yes"
            rows={minuteOfYes}
            caption="On the call where they said yes."
            empty="No timestamped buy-in yet."
          />
          <BarChart
            title="Questions on the deciding call"
            rows={questions}
            caption="The call where they said yes, or the latest call if they haven't."
          />
          <BarChart
            title="Decision layers between the call and a signature"
            rows={layers}
            caption="Legal, a manager, a founder, an agency, IT: counted from what the brand said on the call."
            empty="No sign-off layers recorded yet."
          />
        </div>
      </ChartSection>

      <ChartSection eyebrow="What they pushed on" title="Pushback by theme">
        <p className="text-text-muted text-[12px] -mt-3 mb-4">
          How many times each brand raised each kind of concern. Pick a theme to read what it sounded like.
        </p>
        <ThemeHeatmap brands={brands} />
      </ChartSection>

      <ChartSection eyebrow="Buyer profile" title="What each brand had, next to how it turned out">
        <p className="text-text-muted text-[12px] -mt-3 mb-4">
          Filled from the calls. A dot means the call didn’t establish it, not a no. Green marks the
          answer that makes a deal easier.
        </p>
        <ProfileMatrix brands={brands} ResultPill={ResultPill} />
      </ChartSection>

      <ChartSection eyebrow="Where they bought in" title="The moment, on the recording">
        <BuyInMoments brands={brands} />
      </ChartSection>
    </>
  );
}

// One call: the summary row, plus its detail row when expanded. Rows that
// aren't analyzed yet show where the analysis stands instead of data.
function CallRows({ call, open, onToggle, onAnalyze, onOpenFile, onOpenDeal, canAnalyze }) {
  const c = call;
  const status = {
    none: { text: 'Not analyzed yet', action: 'Analyze' },
    pending: { text: 'Reading transcript…' },
    stalled: { text: 'Analysis stalled', action: 'Retry' },
    error: { text: c.insight?.error || 'Analysis failed', action: 'Retry' },
  }[c.state];

  return (
    <>
      <tr
        onClick={c.state === 'done' ? onToggle : undefined}
        className={`border-b border-hairline align-top ${c.state === 'done' ? 'cursor-pointer hover:bg-card-hover' : ''} ${open ? 'bg-card-hover' : ''}`}
      >
        <td className="px-3 py-2 font-mono text-text-secondary whitespace-nowrap">{fmtDateOnly(c.date)}</td>
        <td className="px-3 py-2 whitespace-nowrap">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenDeal(c.deal_id);
            }}
            className="text-text-primary hover:text-signal font-medium"
          >
            {c.brand}
          </button>
        </td>
        {status ? (
          <td colSpan={6} className="px-3 py-2 text-text-muted">
            <span className={c.state === 'error' ? 'text-red-400' : ''}>{status.text}</span>
            <span className="text-text-disabled"> · {c.filename}</span>
            {status.action && canAnalyze && c.id != null && (
              <Button
                variant="ghost"
                className="ml-2 !py-0"
                onClick={(e) => {
                  e.stopPropagation();
                  onAnalyze(c.id);
                }}
              >
                {status.action}
              </Button>
            )}
          </td>
        ) : (
          <>
            <td className="px-3 py-2 text-text-secondary">{c.brand_side ?? '—'}</td>
            <td className="px-3 py-2 text-text-secondary whitespace-nowrap">{c.panel_side ?? '—'}</td>
            <td className="px-3 py-2 font-mono text-text-secondary">{c.minutes ?? '—'}</td>
            <td className="px-3 py-2 font-mono text-text-secondary">{c.questions_count ?? '—'}</td>
            <td className="px-3 py-2 text-text-secondary min-w-[16rem]">{c.outcome ?? '—'}</td>
            <td className="px-3 py-2"><ResultPill result={c.result} /></td>
          </>
        )}
      </tr>
      {open && c.state === 'done' && (
        <tr className="border-b border-hairline bg-card-hover">
          <td colSpan={8}>
            <CallDetail row={c} onAnalyze={onAnalyze} onOpenFile={onOpenFile} />
          </td>
        </tr>
      )}
    </>
  );
}
