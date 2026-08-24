import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useDeals } from '../state/DealsContext.jsx';
import {
  OUTREACH_STAGES,
  FUNNEL_STAGES,
  STAGE_LABELS,
  formatCurrency,
  isConvertedClient,
  isDealSnoozed,
} from '../lib/stages.js';
import { api } from '../lib/api.js';
import KanbanBoard from '../components/KanbanBoard.jsx';
import ViewHeader from '../components/ViewHeader.jsx';
import Toolbar from '../components/Toolbar.jsx';
import AddDealModal from '../components/AddDealModal.jsx';
import CardFieldsMenu from '../components/CardFieldsMenu.jsx';
import SnoozedDrawer, { DRAWER_HEADER, drawerBody } from '../components/SnoozedDrawer.jsx';
import OutreachSettingsDialog from '../components/settings/OutreachSettingsDialog.jsx';
import { DEFAULT_CARD_FIELDS } from '../components/DealCard.jsx';
import { Button, Input, Select, IconButton } from '../components/ui.jsx';

const CARD_FIELDS_KEY = 'deal-card-fields';
// Chrome above the board: ViewHeader + Toolbar. The board sizes itself with
// calc(100vh - topOffset), so the snoozed drawer's height has to be added here
// or the drawer renders below the fold.
const BOARD_CHROME = '7rem';
const DRAWER_KEY = 'snoozed-drawer-open';

// Outreach Board: the whole sales funnel, S1 through both terminal outcomes
// (WON/LOST), each column collapsible and independently hideable. Meetings
// (S4) also gets its own enhanced view on the Meetings page — this board
// still shows S4 deals so the full funnel is visible in one place.
export default function OutreachView() {
  const { deals, loading, error, openDeal, refresh } = useDeals();
  const [adding, setAdding] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [weights, setWeights] = useState({});

  // Which optional fields show on a deal card — persisted per-browser, same
  // convention as the kanban columns' collapse state.
  const [cardFields, setCardFields] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(CARD_FIELDS_KEY));
      return saved ? { ...DEFAULT_CARD_FIELDS, ...saved } : DEFAULT_CARD_FIELDS;
    } catch {
      return DEFAULT_CARD_FIELDS;
    }
  });
  function updateCardFields(next) {
    setCardFields(next);
    localStorage.setItem(CARD_FIELDS_KEY, JSON.stringify(next));
  }

  function refreshWeights() {
    api
      .listStageWeights()
      .then((rows) => {
        setWeights(Object.fromEntries(rows.map((r) => [r.stage_code, Number(r.weight)])));
      })
      .catch(() => {}); // stage_weights unreachable (e.g. migration not yet applied) — totals just read as $0
  }
  useEffect(refreshWeights, []);

  // Search + filter state lives in the URL (?q=&owner=&channel=), not
  // component state — the board is a real route that a full deal page
  // navigation away and back will unmount/remount, and this codebase's own
  // convention (see DealsContext) is that anything that should survive that
  // belongs in the URL.
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get('q') ?? '';
  const owner = searchParams.get('owner') ?? '';
  const channel = searchParams.get('channel') ?? '';
  // A visibility toggle, not a filter — see the note on filtersActive below.
  const showSnoozed = searchParams.get('snoozed') === '1';

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
  const setShowSnoozed = (v) => updateParams({ snoozed: v ? '1' : '' });

  // Distinct owners/channels present in the data, for the filter dropdowns.
  const owners = useMemo(
    () => [...new Set(deals.map((d) => d.owner).filter(Boolean))].sort(),
    [deals],
  );
  const channels = useMemo(
    () => [...new Set(deals.map((d) => d.channel).filter(Boolean))].sort(),
    [deals],
  );

  // Deliberately excludes `snoozed`: revealing parked deals isn't narrowing
  // the board, so it shouldn't flip the subtitle to "N of M match" or light up
  // the Clear button.
  const filtersActive = query.trim() || owner || channel;

  // Apply search + filters once; the result feeds every column below.
  // Converted deals leave the board for good — unlike snooze there's no toggle
  // to bring them back, because the company now lives under Clients and its
  // won deal is still one click away from there.
  const onBoard = useMemo(() => deals.filter((d) => !isConvertedClient(d)), [deals]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return onBoard.filter((d) => {
      if (q) {
        const hay = `${d.company_name ?? ''} ${d.owner ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (owner && d.owner !== owner) return false;
      if (channel && d.channel !== channel) return false;
      return true;
    });
  }, [onBoard, query, owner, channel]);

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

  // Snooze splits `filtered` two ways, and the two lists are deliberately NOT
  // the same:
  //   visible — what the board renders. Snoozed deals are hidden unless the
  //             "Show snoozed" toggle is on.
  //   live    — what every dollar figure counts. Snoozed deals are ALWAYS
  //             excluded here, even while the toggle has them on screen, so
  //             the weighted total stays the true value of the pipeline that
  //             can actually be worked right now — which is the whole point of
  //             the feature. Don't collapse these back into one list.
  const snoozed = useMemo(() => filtered.filter(isDealSnoozed), [filtered]);
  const snoozedCount = snoozed.length;
  const visible = useMemo(
    () => (showSnoozed ? filtered : filtered.filter((d) => !isDealSnoozed(d))),
    [filtered, showSnoozed],
  );
  const live = useMemo(() => filtered.filter((d) => !isDealSnoozed(d)), [filtered]);

  const weightedValue = (deal) => (deal.deal_size ?? 0) * (weights[deal.current_stage] ?? 0);

  // One column per funnel stage (S1-S4, WON, LOST) — every column is
  // collapsible now, not just LOST; WON/LOST start collapsed since they're
  // terminal outcomes, S1-S4 start expanded since they're the active funnel.
  const columns = FUNNEL_STAGES.map((code) => ({
    code,
    label: STAGE_LABELS[code],
    deals: visible.filter((d) => d.current_stage === code),
    collapsible: true,
    defaultOpen: code !== 'WON' && code !== 'LOST',
    // From `live`, never from the rendered cards — the column total must not
    // move when "Show snoozed" is toggled.
    weightedTotal: live
      .filter((d) => d.current_stage === code)
      .reduce((sum, d) => sum + weightedValue(d), 0),
  }));

  const weightedGrandTotal = live
    .filter((d) => FUNNEL_STAGES.includes(d.current_stage))
    .reduce((sum, d) => sum + weightedValue(d), 0);

  const activeCount = live.filter((d) => OUTREACH_STAGES.includes(d.current_stage)).length;
  const totalActive = onBoard.filter(
    (d) => OUTREACH_STAGES.includes(d.current_stage) && !isDealSnoozed(d),
  ).length;
  const subtitle = [
    filtersActive ? `${activeCount} of ${totalActive} deals match` : `${activeCount} deals in pipeline`,
    snoozedCount ? `${snoozedCount} snoozed` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  // Owned here, not in the drawer: the board's height is a calc() that has to
  // shrink by exactly the drawer's height, so both read one flag. Persisted
  // per-browser, same convention as the kanban columns' collapse state.
  const [drawerOpen, setDrawerOpen] = useState(() => localStorage.getItem(DRAWER_KEY) === '1');
  function toggleDrawer() {
    setDrawerOpen((o) => {
      localStorage.setItem(DRAWER_KEY, o ? '0' : '1');
      return !o;
    });
  }
  const boardOffset = snoozedCount
    ? `calc(${BOARD_CHROME} + ${DRAWER_HEADER}${drawerOpen ? ` + ${drawerBody(snoozedCount)}` : ''})`
    : BOARD_CHROME;

  const clearFilters = () => {
    setQuery('');
    setOwner('');
    setChannel('');
  };

  return (
    <div>
      <ViewHeader title="Pipeline" subtitle={subtitle}>
        <div className="text-right mr-2">
          <div className="eyebrow text-text-muted">Weighted Pipeline</div>
          <div className="font-mono text-text-primary text-[13px]">{formatCurrency(weightedGrandTotal)}</div>
        </div>
        <IconButton
          icon="gear"
          title="Pipeline Settings"
          aria-label="Pipeline Settings"
          onClick={() => setSettingsOpen(true)}
        />
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
            {filtersActive && <Button variant="ghost" onClick={clearFilters}>Clear</Button>}
            {/* Hides itself when there's nothing parked, so the toolbar stays
                clean in the common case. */}
            {(snoozedCount > 0 || showSnoozed) && (
              <button
                type="button"
                aria-pressed={showSnoozed}
                onClick={() => setShowSnoozed(!showSnoozed)}
                className={`px-3 py-2 text-[13px] border transition-colors ${
                  showSnoozed
                    ? 'border-signal/50 text-signal'
                    : 'border-hairline text-text-muted hover:text-text-primary hover:bg-card-hover'
                }`}
              >
                Show snoozed{snoozedCount ? ` (${snoozedCount})` : ''}
              </button>
            )}
            <CardFieldsMenu fields={cardFields} onChange={updateCardFields} />
          </>
        }
      />

      {error ? (
        <div className="px-6 py-10 text-red-400 text-[13px]">{error}</div>
      ) : (
        <KanbanBoard
          columns={columns}
          cardFields={cardFields}
          onCardClick={openDeal}
          onMoveCard={handleMoveCard}
          topOffset={boardOffset}
          scrollKey={searchParams.toString()}
          loading={loading}
        />
      )}

      {snoozedCount > 0 && (
        <SnoozedDrawer
          deals={snoozed}
          onOpenDeal={openDeal}
          onRefresh={refresh}
          open={drawerOpen}
          onToggle={toggleDrawer}
        />
      )}

      {adding && <AddDealModal onClose={() => setAdding(false)} onCreated={refresh} />}
      {settingsOpen && (
        <OutreachSettingsDialog
          onClose={() => {
            setSettingsOpen(false);
            refreshWeights();
          }}
        />
      )}
    </div>
  );
}
