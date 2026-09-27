import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ViewHeader from '../components/ViewHeader.jsx';
import { Button, Eyebrow, IconButton } from '../components/ui.jsx';
import { useLeads } from '../state/LeadsContext.jsx';
import { useDeals } from '../state/DealsContext.jsx';
import { useEconomics } from '../lib/useEconomics.js';
import { PHASES } from '../lib/economics.js';
import { loadPrograms, marketplace } from '../lib/programs.js';
import { fmtDateOnly } from '../lib/dates.js';
import { money, wholeMoney, ZoneChip } from '../components/playbook/Zone.jsx';
import { HealthChip } from '../components/playbook/HealthChip.jsx';

const TREND = { expanding: '↑', holding: '→', cutting: '↓' };

function Stat({ value, label }) {
  return (
    <div className="border-l border-hairline pl-3">
      <div className="font-mono text-text-primary text-[20px] leading-tight">{value}</div>
      <div className="eyebrow text-text-muted mt-1">{label}</div>
    </div>
  );
}

// G + H. Won brands on the five-phase lifecycle (Setup, Faith, Proof,
// Inflection, Mature) by days since going live, each with a health read from
// tracking, budget trend and creators, and its spend in Panel-profit terms.
function Lifecycle({ rows, settings, onOpen }) {
  const columns = [
    { key: 'none', label: 'Not live yet', goal: 'Signed, but no live date or Everflow revenue yet.' },
    ...PHASES.map((p) => ({ key: p.key, label: p.label, goal: p.goal, days: p.days })),
  ];
  const attention = rows.filter((r) => r.health.tier === 'churn' || r.health.tier === 'risk');
  return (
    <>
      {attention.length > 0 && (
        <section className="px-6 py-5 border-b border-hairline">
          <Eyebrow className="mb-3">Needs attention</Eyebrow>
          <ul className="divide-y divide-hairline">
            {attention.map((r) => (
              <li key={r.lead.id} className="py-2 flex items-baseline gap-3 text-[13px]">
                <button onClick={() => onOpen(r)} className="text-text-primary hover:text-signal w-40 shrink-0 truncate text-left">
                  {r.lead.company_name}
                </button>
                <HealthChip health={r.health} />
                <span className="text-text-secondary">{r.health.note}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="grid gap-3 px-6 py-5 overflow-x-auto" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(200px, 1fr))` }}>
        {columns.map((col) => {
          const inCol = rows.filter((r) => (r.phase?.key ?? 'none') === col.key);
          return (
            <div key={col.key} className="min-w-0">
              <div className="mb-2">
                <div className="flex items-baseline justify-between">
                  <Eyebrow>{col.label}</Eyebrow>
                  <span className="font-mono text-text-muted text-[12px]">{inCol.length}</span>
                </div>
                <div className="text-text-disabled text-[11px]">
                  {col.days ? `Days ${col.days[0]}${col.days[1] === Infinity ? '+' : `–${col.days[1]}`}` : ' '}
                </div>
                <p className="text-text-muted text-[11px] mt-1 leading-snug">{col.goal}</p>
              </div>
              <div className="space-y-2">
                {inCol.map((r) => (
                  <button key={r.lead.id} onClick={() => onOpen(r)} className="panel-card w-full text-left p-3 block">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-text-primary text-[13px] font-semibold truncate">{r.lead.company_name}</span>
                      {r.phase && <span className="font-mono text-text-muted text-[11px] shrink-0">day {r.phase.day}</span>}
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1"><HealthChip health={r.health} /></div>
                    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[12px]">
                      <dt className="text-text-muted">Spend</dt>
                      <dd className="font-mono text-text-secondary text-right">
                        {r.spend != null ? wholeMoney(r.spend) : '—'}
                        {r.trend && <span className="ml-1" title={`${Math.round(r.trend.change * 100)}% vs the month before`}>{TREND[r.trend.trend]}</span>}
                      </dd>
                      <dt className="text-text-muted">Panel profit</dt>
                      <dd className="font-mono text-text-secondary text-right">{r.spend != null ? wholeMoney(r.profit.profit) : '—'}</dd>
                      {settings.show_commission && (
                        <>
                          <dt className="text-text-muted">Commission</dt>
                          <dd className="font-mono text-text-secondary text-right">{r.spend != null ? wholeMoney(r.profit.commission) : '—'}</dd>
                        </>
                      )}
                      <dt className="text-text-muted">Creators</dt>
                      <dd className="font-mono text-text-secondary text-right">{r.creators ?? '—'}</dd>
                      <dt className="text-text-muted">Tracking</dt>
                      <dd className="text-text-secondary text-right">{r.tracking === true ? 'Live' : r.tracking === false ? 'Not live' : '—'}</dd>
                    </dl>
                    {r.liveDate && (
                      <div className="mt-2 text-text-disabled text-[11px]">
                        Live {fmtDateOnly(r.liveDate)}{r.liveSource === 'everflow' ? ' (first revenue month)' : ''}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// J. Brands in the same vertical bid against each other for creator traffic:
// their bids side by side with each one's share of the month's traffic.
function Marketplace({ rows, onOpen }) {
  const [monthPick, setMonthPick] = useState('last');
  const verticals = useMemo(() => marketplace(rows, monthPick), [rows, monthPick]);
  return (
    <div className="px-6 py-5 space-y-8">
      <div className="flex items-center gap-2">
        <Button variant={monthPick === 'last' ? 'primary' : 'secondary'} onClick={() => setMonthPick('last')}>Last month</Button>
        <Button variant={monthPick === 'current' ? 'primary' : 'secondary'} onClick={() => setMonthPick('current')}>This month so far</Button>
        <p className="text-text-muted text-[12px] ml-2 max-w-2xl">
          Brands in a vertical compete for the same creators. The highest bid pulls most of the traffic; a brand only
          wins more by meeting or beating the field. Bids come from each deal’s economics.
        </p>
      </div>
      {verticals.map((v) => (
        <section key={v.vertical}>
          <div className="flex items-baseline justify-between mb-2">
            <Eyebrow>{v.vertical}</Eyebrow>
            <span className="text-text-muted text-[12px]">
              Share of {v.basis}{v.topBid != null ? ` · top bid ${money(v.topBid)}` : ''}
            </span>
          </div>
          <table className="w-full text-[13px] table-fixed">
            <thead>
              <tr className="border-b border-hairline">
                {[['Brand', '22%'], ['Bid', '10%'], ['eCPM zone', '13%'], [`Share of ${v.basis}`, '35%'], ['To win more', '20%']].map(([h, w]) => (
                  <th key={h} style={{ width: w }} className="py-2 pr-4 text-left font-normal eyebrow text-text-muted">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {v.brands.map((b, i) => (
                <tr key={b.lead.id} className="border-b border-hairline">
                  <td className="py-2 pr-4">
                    <button onClick={() => onOpen(b)} className="text-text-primary hover:text-signal font-medium">{b.lead.company_name}</button>
                  </td>
                  <td className="py-2 pr-4 font-mono text-text-secondary">{money(b.bid)}</td>
                  <td className="py-2 pr-4">{b.zone ? <ZoneChip zone={b.zone} /> : <span className="text-text-disabled">—</span>}</td>
                  <td className="py-2 pr-4">
                    <div className="flex items-center gap-2" title={`${Math.round(b.share * 100)}% · ${b.traffic.toLocaleString()} ${v.basis}`}>
                      <div className="flex-1 h-3">
                        <div className={i === 0 && b.share > 0 ? 'bg-signal h-full' : 'bg-text-muted h-full'} style={{ width: `${Math.max(b.share * 100, b.share ? 2 : 0)}%` }} />
                      </div>
                      <span className="font-mono text-text-primary w-12 text-right">{Math.round(b.share * 100)}%</span>
                    </div>
                  </td>
                  <td className="py-2 text-text-secondary">
                    {b.gapToTop == null ? '—' : b.gapToTop <= 0 ? 'Top bid' : `Meet ${money(v.topBid)} (+${money(b.gapToTop)})`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      {verticals.length === 0 && <div className="text-text-disabled text-[13px]">No clients yet.</div>}
    </div>
  );
}

export default function ProgramsView() {
  const { leads } = useLeads();
  const { deals } = useDeals();
  const settings = useEconomics();
  const navigate = useNavigate();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('lifecycle');
  const [refreshing, setRefreshing] = useState(false);

  const clients = useMemo(() => leads.filter((l) => l.is_client), [leads]);
  const load = useCallback(async () => {
    try {
      setRows(await loadPrograms(clients, deals, settings));
      setError(null);
    } catch (e) {
      setError(e.message);
      setRows((r) => r ?? []);
    }
  }, [clients, deals, settings]);
  useEffect(() => {
    load();
  }, [load]);

  const open = (r) => navigate(`/clients/${r.lead.id}`);
  const totals = (rows ?? []).reduce(
    (t, r) => ({ spend: t.spend + (r.spend ?? 0), profit: t.profit + r.profit.profit, commission: t.commission + r.profit.commission }),
    { spend: 0, profit: 0, commission: 0 },
  );

  return (
    <div>
      <ViewHeader title="Programs" subtitle="Won brands after signing: lifecycle, health and the vertical marketplace">
        <IconButton
          icon="sync"
          disabled={refreshing}
          title="Refresh"
          aria-label="Refresh programs"
          onClick={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
        />
      </ViewHeader>
      {error && <div className="px-6 pt-4 text-red-400 text-[13px]">{error}</div>}
      {rows == null ? (
        <div className="px-6 py-10 text-text-secondary text-[13px]">Loading…</div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 px-6 py-5 border-b border-hairline">
            <Stat value={rows.length} label="Clients" />
            <Stat value={wholeMoney(totals.spend)} label="Monthly spend" />
            <Stat value={wholeMoney(totals.profit)} label={`Panel profit (${settings.ua_fee_pct}% fee)`} />
            {settings.show_commission && <Stat value={wholeMoney(totals.commission)} label={`Commission (${settings.commission_pct}%)`} />}
            <Stat value={rows.filter((r) => r.health.tier === 'risk').length} label="At risk" />
            <Stat value={rows.filter((r) => r.health.tier === 'churn').length} label="Likely to churn" />
          </div>
          <div className="flex gap-1 px-6 pt-4 border-b border-hairline">
            {[['lifecycle', 'Lifecycle'], ['marketplace', 'Marketplace']].map(([k, l]) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={`relative px-3 pb-3 text-[13px] transition-colors ${tab === k ? 'text-text-primary' : 'text-text-secondary hover:text-text-primary'}`}
              >
                {l}
                {tab === k && <span className="absolute left-0 right-0 bottom-0 h-[2px] bg-signal" />}
              </button>
            ))}
          </div>
          {tab === 'lifecycle' ? <Lifecycle rows={rows} settings={settings} onOpen={open} /> : <Marketplace rows={rows} onOpen={open} />}
        </>
      )}
    </div>
  );
}
