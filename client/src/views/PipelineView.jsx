import { useMemo, useState } from 'react';
import { useDeals } from '../state/DealsContext.jsx';
import { SALES_STAGES, STAGE_LABELS, isStaleInStage } from '../lib/stages.js';
import { api } from '../lib/api.js';
import KanbanBoard from '../components/KanbanBoard.jsx';
import ViewHeader from '../components/ViewHeader.jsx';
import Toolbar from '../components/Toolbar.jsx';
import AddDealModal from '../components/AddDealModal.jsx';
import { Button, Input, Select } from '../components/ui.jsx';

// Pipeline Board (default view): the active sales cycle S1–S7 plus a collapsed
// LOST column.
export default function PipelineView() {
  const { deals, loading, error, openDeal, refresh } = useDeals();
  const [adding, setAdding] = useState(false);

  // Search + filter state. These narrow the cards shown in every stage column
  // at once so the board stays scannable with a large brand list.
  const [query, setQuery] = useState('');
  const [owner, setOwner] = useState('');
  const [channel, setChannel] = useState('');
  const [staleOnly, setStaleOnly] = useState(false);

  // Distinct owners/channels present in the data, for the filter dropdowns.
  const owners = useMemo(
    () => [...new Set(deals.map((d) => d.owner).filter(Boolean))].sort(),
    [deals],
  );
  const channels = useMemo(
    () => [...new Set(deals.map((d) => d.channel).filter(Boolean))].sort(),
    [deals],
  );

  const filtersActive = query.trim() || owner || channel || staleOnly;

  // Apply search + filters once; the result feeds every column below.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return deals.filter((d) => {
      if (q) {
        const hay = `${d.brand_name ?? ''} ${d.owner ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (owner && d.owner !== owner) return false;
      if (channel && d.channel !== channel) return false;
      if (staleOnly && !isStaleInStage(d)) return false;
      return true;
    });
  }, [deals, query, owner, channel, staleOnly]);

  // Move a dragged card to a new stage. Dropping onto LOST prompts for the
  // required reason and uses markLost(); other stages use setStage().
  const handleMoveCard = async (dealId, toStage) => {
    const deal = deals.find((d) => String(d.id) === String(dealId));
    if (!deal || deal.current_stage === toStage) return;
    try {
      if (toStage === 'LOST') {
        const reason = window.prompt('Reason for marking lost?');
        if (!reason || !reason.trim()) return;
        await api.markLost(dealId, reason.trim());
      } else {
        await api.setStage(dealId, toStage);
      }
      refresh();
    } catch (e) {
      alert(e.message);
    }
  };

  // Build one column per sales stage, plus the collapsible LOST column.
  const columns = SALES_STAGES.map((code) => ({
    code,
    label: STAGE_LABELS[code],
    deals: filtered.filter((d) => d.current_stage === code),
  }));
  columns.push({
    code: 'LOST',
    label: STAGE_LABELS.LOST,
    deals: filtered.filter((d) => d.current_stage === 'LOST'),
    collapsible: true,
  });

  const activeCount = filtered.filter((d) => SALES_STAGES.includes(d.current_stage)).length;
  const subtitle = filtersActive
    ? `${activeCount} of ${deals.filter((d) => SALES_STAGES.includes(d.current_stage)).length} deals match`
    : `${activeCount} deals in the sales cycle`;

  const clearFilters = () => {
    setQuery('');
    setOwner('');
    setChannel('');
    setStaleOnly(false);
  };

  return (
    <div>
      <ViewHeader title="Pipeline" subtitle={subtitle}>
        <Button variant="primary" onClick={() => setAdding(true)}>+ Add Deal</Button>
      </ViewHeader>

      {/* Search + filter toolbar. Narrows every stage column at once.
          px-2 aligns the input groups with the cards in the first/last columns. */}
      <Toolbar
        padding="px-2"
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
        right={
          <>
            <button
              onClick={() => setStaleOnly((v) => !v)}
              className={`px-3 py-2 text-[13px] whitespace-nowrap border transition-colors ${
                staleOnly
                  ? 'border-red-500/40 text-red-400 bg-red-500/10'
                  : 'border-hairline text-text-secondary hover:bg-card-hover'
              }`}
            >
              Stale only
            </button>
            {filtersActive && (
              <Button variant="ghost" onClick={clearFilters}>Clear</Button>
            )}
          </>
        }
      />

      {loading ? (
        <div className="px-6 py-10 text-text-secondary text-[13px]">Loading…</div>
      ) : error ? (
        <div className="px-6 py-10 text-red-400 text-[13px]">{error}</div>
      ) : (
        <KanbanBoard columns={columns} onCardClick={openDeal} onMoveCard={handleMoveCard} topOffset="7rem" />
      )}

      {adding && <AddDealModal onClose={() => setAdding(false)} onCreated={refresh} />}
    </div>
  );
}
