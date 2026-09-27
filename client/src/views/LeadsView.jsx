import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLeads } from '../state/LeadsContext.jsx';
import { api } from '../lib/api.js';
import { playbook } from '../lib/playbookApi.js';
import ViewHeader from '../components/ViewHeader.jsx';
import { Button } from '../components/ui.jsx';
import LeadGroup from '../components/LeadGroup.jsx';
import CompaniesNav from '../components/CompaniesNav.jsx';
import AddLeadModal from '../components/AddLeadModal.jsx';
import EnrichAllButton from '../components/EnrichAllButton.jsx';
import FindDuplicatesModal from '../components/FindDuplicatesModal.jsx';
import { sortByRules, sortWithClaude } from '../lib/autoSort.js';

// Auto-sort runs on its own once per app session; the nav button reruns it.
let autoSortStarted = false;

// Lead Intelligence Board — vertical groups of scored, ranked lead cards.
// LeadsProvider is mounted app-wide (see App.jsx) so leads are searchable
// globally; opening one navigates to its full-page company view.
export default function LeadsView() {
  const { leads, verticals, loading, error, refresh, openLead } = useLeads();
  // Pre-call qualifier labels (lib/qualifier.js): manual inputs + the latest
  // Ad Library check per company, both 0053. Empty until that's applied.
  const [qualifierData, setQualifierData] = useState({ manual: {}, adChecks: {} });
  useEffect(() => {
    Promise.all([playbook.listQualifiers(), playbook.latestAdChecks()])
      .then(([rows, adChecks]) => setQualifierData({ manual: Object.fromEntries(rows.map((r) => [r.lead_id, r])), adChecks }))
      .catch(() => {});
  }, [leads]);
  const [adding, setAdding] = useState(false);
  const [findingDupes, setFindingDupes] = useState(false);
  // Per-group open overrides (id -> bool). When a group has no override it falls
  // back to its default: open if it has leads, collapsed if empty (matching the
  // original board behaviour).
  const [openOverrides, setOpenOverrides] = useState(() => new Map());
  const navigate = useNavigate();

  // Group leads by vertical. Verticals with leads first, then empty ones.
  const leadsByVertical = new Map();
  for (const l of leads) {
    const key = l.vertical_id ?? 'none';
    if (!leadsByVertical.has(key)) leadsByVertical.set(key, []);
    leadsByVertical.get(key).push(l);
  }

  // verticals arrive ordered by their manual `position` (see api.listVerticals),
  // so we keep that order for both the nav and the board.
  const groups = verticals.map((v) => ({
    id: v.id,
    name: v.name,
    leads: leadsByVertical.get(v.id) ?? [],
  }));

  // Any leads with no vertical get an "Unsorted" group at the end.
  const orphaned = leadsByVertical.get('none') ?? [];
  if (orphaned.length) groups.push({ id: 'none', name: 'Unsorted', leads: orphaned });

  const isOpen = (g) => openOverrides.get(g.id) ?? g.leads.length > 0;

  const toggleGroup = (g) =>
    setOpenOverrides((prev) => {
      const next = new Map(prev);
      next.set(g.id, !isOpen(g));
      return next;
    });

  // Open the target section and smooth-scroll the board to it. The section
  // header always exists in the DOM (expanding only adds cards below it), so we
  // can scroll immediately without waiting for the open state to re-render.
  const jumpToVertical = (id) => {
    setOpenOverrides((prev) => {
      const next = new Map(prev);
      next.set(id, true);
      return next;
    });
    document.getElementById(`vert-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const selectCompany = (leadId, groupId) => {
    jumpToVertical(groupId);
    openLead(leadId);
  };

  // Auto-sort: keyword rules, then Claude, into the existing verticals.
  const [sortStatus, setSortStatus] = useState(null); // { running, text, tone }
  const runAutoSort = useCallback(
    async ({ recheck = false } = {}) => {
      setSortStatus({ running: true, text: 'Sorting by keywords…' });
      try {
        const rules = await sortByRules(verticals);
        if (rules.placed) await refresh();
        let claude = { placed: 0, created: [], skipped: 0 };
        if (rules.left > 0 || recheck) {
          setSortStatus({ running: true, text: `${rules.placed} sorted by keywords. Claude is sorting the rest…` });
          claude = await sortWithClaude({
            recheck,
            onProgress: async (p) => {
              setSortStatus({ running: true, text: `${rules.placed + p.placed} sorted so far. Claude is still going…` });
              await refresh();
            },
          });
        }
        const placed = rules.placed + claude.placed;
        const parts = [placed ? `${placed} companies sorted` : 'Nothing new to sort'];
        if (claude.created.length) parts.push(`new: ${claude.created.join(', ')}`);
        if (claude.skipped) parts.push(`${claude.skipped} Claude couldn't identify stay in Unsorted`);
        let tone = 'ok';
        if (claude.unavailable) {
          tone = 'warn';
          parts.push(
            claude.unavailable === 'not deployed'
              ? 'Claude sorting turns on once the classify-verticals function is deployed'
              : `Claude sorting failed: ${claude.unavailable}`,
          );
        }
        setSortStatus({ running: false, text: parts.join(' · '), tone });
        await refresh();
      } catch (e) {
        setSortStatus({ running: false, text: e.message, tone: 'error' });
      }
    },
    [verticals, refresh],
  );
  const hasUnsorted = leads.some((l) => l.vertical_id == null);
  useEffect(() => {
    if (loading || autoSortStarted || !verticals.length || !hasUnsorted) return;
    autoSortStarted = true;
    runAutoSort();
  }, [loading, verticals, hasUnsorted, runAutoSort]);

  // Drag a company card onto a vertical in the side nav to re-categorize it.
  // verticalId is null when dropped on "Unsorted" (un-categorize).
  const moveLeadToVertical = useCallback(
    async (leadId, verticalId) => {
      const lead = leads.find((l) => String(l.id) === String(leadId));
      if (!lead || lead.vertical_id === verticalId) return;
      try {
        await api.updateLead(lead.id, { vertical_id: verticalId });
        await refresh();
      } catch (e) {
        alert(e.message);
      }
    },
    [leads, refresh],
  );

  // Create a new (empty) vertical from the side nav's inline name field. It then
  // appears in the list as a normal drop target to drag companies into.
  const createVertical = useCallback(
    async (name) => {
      const n = name?.trim();
      if (!n) return;
      try {
        await api.createVertical(n);
        await refresh();
      } catch (e) {
        alert(e.message);
      }
    },
    [refresh],
  );

  // Rename a vertical from the side nav's inline edit field.
  const renameVertical = useCallback(
    async (id, name) => {
      const n = name?.trim();
      if (!n) return;
      try {
        await api.updateVertical(id, { name: n });
        await refresh();
      } catch (e) {
        alert(e.message);
      }
    },
    [refresh],
  );

  // Delete a vertical; its companies fall back to "Unsorted" (FK SET NULL).
  const deleteVertical = useCallback(
    async (id) => {
      try {
        await api.deleteVertical(id);
        await refresh();
      } catch (e) {
        alert(e.message);
      }
    },
    [refresh],
  );

  // Drag a vertical onto another to reorder. Insert the dragged vertical before
  // the target; dropping on "Unsorted"/unknown moves it to the end.
  const reorderVertical = useCallback(
    async (draggedId, targetId) => {
      const ids = verticals.map((v) => String(v.id));
      const from = ids.indexOf(String(draggedId));
      if (from === -1) return;
      const original = ids.join();
      ids.splice(from, 1);
      const t = ids.indexOf(String(targetId));
      ids.splice(t === -1 ? ids.length : t, 0, String(draggedId));
      if (ids.join() === original) return; // no change
      try {
        await api.reorderVerticals(ids.map(Number));
        await refresh();
      } catch (e) {
        alert(e.message);
      }
    },
    [verticals, refresh],
  );

  return (
    <div>
      {/* Top bar spans the full content width, above both the nav and the list. */}
      <div className="sticky top-0 z-20 bg-space">
        <ViewHeader title="Companies" subtitle={`${leads.length} companies`}>
          <EnrichAllButton mode="companies" onDone={refresh} />
          <Button variant="secondary" onClick={() => setFindingDupes(true)}>
            Find Duplicates
          </Button>
          <Button variant="secondary" onClick={() => navigate('/scoring-config')}>
            Scoring Config
          </Button>
          <Button variant="primary" onClick={() => setAdding(true)}>+ Add Company</Button>
        </ViewHeader>
      </div>

      <div className="flex">
        <CompaniesNav
          groups={groups}
          onJumpVertical={jumpToVertical}
          onSelectCompany={selectCompany}
          onDropLead={moveLeadToVertical}
          onCreateVertical={createVertical}
          onRenameVertical={renameVertical}
          onDeleteVertical={deleteVertical}
          onReorderVertical={reorderVertical}
          sortStatus={sortStatus}
          onAutoSort={() => runAutoSort({ recheck: true })}
        />

        <div className="flex-1 min-w-0">
          {loading ? (
            <div className="px-6 py-10 text-text-secondary text-[13px]">Loading…</div>
          ) : error ? (
            <div className="px-6 py-10 text-red-400 text-[13px]">{error}</div>
          ) : (
            <div className="py-6">
              {groups.map((g) => (
                <LeadGroup
                  key={g.id}
                  id={g.id}
                  name={g.name}
                  leads={g.leads}
                  open={isOpen(g)}
                  onToggle={() => toggleGroup(g)}
                  onCardClick={openLead}
                  qualifierData={qualifierData}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {adding && (
        <AddLeadModal verticals={verticals} onClose={() => setAdding(false)} onCreated={refresh} />
      )}

      {findingDupes && (
        <FindDuplicatesModal onClose={() => setFindingDupes(false)} onMerged={refresh} />
      )}
    </div>
  );
}
