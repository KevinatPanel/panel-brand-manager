import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useDeals } from '../state/DealsContext.jsx';
import { STAGE_LABELS, formatCurrency } from '../lib/stages.js';
import { fmtDate } from '../lib/dates.js';
import ViewHeader from '../components/ViewHeader.jsx';
import Toolbar from '../components/Toolbar.jsx';
import AddDealModal from '../components/AddDealModal.jsx';
import { Button, Input, Select, ChannelTag } from '../components/ui.jsx';

const GRID_COLS = '1.4fr 1fr 1.3fr 0.9fr 1.1fr 0.9fr 1fr';

const COLUMNS = [
  { key: 'company_name', label: 'Brand' },
  { key: 'owner', label: 'Owner' },
  { key: 'primary_stakeholder_name', label: 'Primary Contact' },
  { key: 'channel', label: 'Channel' },
  { key: 'current_stage_entered_at', label: 'Meeting Completed' },
  { key: 'days_in_stage', label: 'Days Since' },
  { key: 'pilot_spend', label: 'Pilot Spend' },
];

// Meetings table: deals that have reached S4 (Meeting Completed) — the sales
// cycle's terminal/won stage, see lib/stages.js. Deals arrive here from the
// Outreach board via the "Move to S4" action in DealDetailPanel, not by
// dragging. A collapsible Lost section mirrors the Outreach board's Lost
// column, for deals lost after their meeting.
export default function MeetingsView() {
  const { deals, loading, error, openDeal, refresh } = useDeals();
  const [adding, setAdding] = useState(false);
  const [lostOpen, setLostOpen] = useState(false);
  const [sort, setSort] = useState({ key: 'current_stage_entered_at', dir: 'desc' });

  // Search + filter state lives in the URL (?q=&owner=&channel=), same
  // convention as OutreachView.
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get('q') ?? '';
  const owner = searchParams.get('owner') ?? '';
  const channel = searchParams.get('channel') ?? '';

  function updateParams(patch) {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setSearchParams(next, { replace: true });
  }
  const setQuery = (v) => updateParams({ q: v });
  const setOwner = (v) => updateParams({ owner: v });
  const setChannel = (v) => updateParams({ channel: v });

  const owners = useMemo(
    () => [...new Set(deals.map((d) => d.owner).filter(Boolean))].sort(),
    [deals],
  );
  const channels = useMemo(
    () => [...new Set(deals.map((d) => d.channel).filter(Boolean))].sort(),
    [deals],
  );

  const filtersActive = query.trim() || owner || channel;

  const matchesFilters = (d) => {
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      const hay = `${d.company_name ?? ''} ${d.owner ?? ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (owner && d.owner !== owner) return false;
    if (channel && d.channel !== channel) return false;
    return true;
  };

  const meetings = useMemo(
    () => deals.filter((d) => d.current_stage === 'S4' && matchesFilters(d)),
    [deals, query, owner, channel],
  );
  const lost = useMemo(
    () => deals.filter((d) => d.current_stage === 'LOST' && matchesFilters(d)),
    [deals, query, owner, channel],
  );

  // Clicking a header sorts by that column ascending; clicking the active
  // header again flips direction.
  const toggleSort = (key) =>
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));

  const sorted = useMemo(() => {
    const { key, dir } = sort;
    const mul = dir === 'asc' ? 1 : -1;
    return [...meetings].sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'string') return av.localeCompare(bv) * mul;
      return (av - bv) * mul;
    });
  }, [meetings, sort]);

  const subtitle = filtersActive
    ? `${meetings.length} of ${deals.filter((d) => d.current_stage === 'S4').length} deals match`
    : `${meetings.length} meetings completed`;

  const clearFilters = () => {
    setQuery('');
    setOwner('');
    setChannel('');
  };

  return (
    <div>
      <ViewHeader title="Meetings" subtitle={subtitle}>
        <Button variant="primary" onClick={() => setAdding(true)}>+ Add Deal</Button>
      </ViewHeader>

      <Toolbar
        left={
          <>
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search brand or owner…"
              className="w-56"
            />
            <Select value={owner} onChange={(e) => setOwner(e.target.value)} className="w-36">
              <option value="">All owners</option>
              {owners.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </Select>
            <Select value={channel} onChange={(e) => setChannel(e.target.value)} className="w-36">
              <option value="">All channels</option>
              {channels.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </Select>
          </>
        }
        right={filtersActive && <Button variant="ghost" onClick={clearFilters}>Clear</Button>}
      />

      {loading ? (
        <div className="px-6 py-10 text-text-secondary text-[13px]">Loading…</div>
      ) : error ? (
        <div className="px-6 py-10 text-red-400 text-[13px]">{error}</div>
      ) : (
        <div className="py-2">
          <div className="grid gap-4 px-6 py-2 border-b border-hairline" style={{ gridTemplateColumns: GRID_COLS }}>
            {COLUMNS.map((col) => (
              <button
                key={col.key}
                onClick={() => toggleSort(col.key)}
                className="eyebrow text-text-muted text-left hover:text-text-secondary transition-colors"
              >
                {col.label}
                {sort.key === col.key && (sort.dir === 'asc' ? ' ↑' : ' ↓')}
              </button>
            ))}
          </div>

          {sorted.length === 0 ? (
            <div className="px-6 py-10 text-text-disabled text-[13px]">No meetings completed yet.</div>
          ) : (
            sorted.map((d) => <DealRow key={d.id} deal={d} onClick={() => openDeal(d.id)} />)
          )}

          {/* Collapsible Lost section — the list-page equivalent of the
              Outreach board's collapsible LOST column. */}
          <div className="mt-6 border-t border-hairline">
            <button
              onClick={() => setLostOpen((o) => !o)}
              className="flex items-center gap-2 px-6 py-3 text-text-secondary hover:text-text-primary text-[13px] transition-colors"
            >
              <span>{lostOpen ? '▾' : '▸'}</span>
              <span>{STAGE_LABELS.LOST} · {lost.length}</span>
            </button>
            {lostOpen && (
              lost.length === 0 ? (
                <div className="px-6 pb-6 text-text-disabled text-[13px]">No lost deals.</div>
              ) : (
                <div className="pb-2">
                  {lost.map((d) => (
                    <DealRow key={d.id} deal={d} onClick={() => openDeal(d.id)} />
                  ))}
                </div>
              )
            )}
          </div>
        </div>
      )}

      {adding && <AddDealModal onClose={() => setAdding(false)} onCreated={refresh} />}
    </div>
  );
}

function DealRow({ deal, onClick }) {
  return (
    <div
      onClick={onClick}
      className="grid gap-4 px-6 py-3 border-b border-hairline items-center cursor-pointer hover:bg-card-hover transition-colors"
      style={{ gridTemplateColumns: GRID_COLS }}
    >
      <div className="text-text-primary text-[13px] truncate">{deal.company_name}</div>
      <div className="text-text-secondary text-[13px] truncate">{deal.owner ?? '—'}</div>
      <div className="text-text-secondary text-[13px] truncate">{deal.primary_stakeholder_name ?? '—'}</div>
      <div><ChannelTag channel={deal.channel} /></div>
      <div className="text-text-secondary text-[13px]">{fmtDate(deal.current_stage_entered_at)}</div>
      <div className="font-mono text-text-secondary text-[13px]">{deal.days_in_stage}d</div>
      <div className="font-mono text-text-secondary text-[13px]">{formatCurrency(deal.pilot_spend)}</div>
    </div>
  );
}
