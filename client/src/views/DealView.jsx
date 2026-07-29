import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useDeals } from '../state/DealsContext.jsx';
import { STAGE_LABELS } from '../lib/stages.js';
import { Button, Eyebrow } from '../components/ui.jsx';
import DealOverviewFields from '../components/deal/DealOverviewFields.jsx';
import StageActions from '../components/deal/StageActions.jsx';
import StakeholdersSection from '../components/deal/StakeholdersSection.jsx';
import TasksSection from '../components/deal/TasksSection.jsx';
import NotesSection from '../components/deal/NotesSection.jsx';
import AttachmentsSection from '../components/deal/AttachmentsSection.jsx';
import ActivityTimeline from '../components/deal/ActivityTimeline.jsx';

// Full deal record — the canonical page for a deal, reached at /deals/:dealId
// (a real route, not a slide-over). Modeled on ClientView.jsx's full-page
// pattern: look the deal up from the shared DealsContext list for a
// not-found fallback, then fetch the full record for header/overview data.
// The slide-out (DealDetailPanel) remains the fast triage view; this page is
// reachable from it via "Open full record".
export default function DealView() {
  const { dealId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { deals, loading: dealsLoading, refresh } = useDeals();
  const id = Number(dealId);

  const [deal, setDeal] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showDelete, setShowDelete] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.getDeal(id);
      setDeal(data);
      setNotFound(false);
    } catch (e) {
      setNotFound(true);
    }
  }, [id]);

  useEffect(() => {
    setDeal(null);
    setNotFound(false);
    setShowDelete(false);
    if (Number.isFinite(id)) load();
    else setNotFound(true);
  }, [id, load]);

  // Re-fetch this deal AND the shared board list after any mutation.
  async function after(fn) {
    setBusy(true);
    try {
      await fn();
      await load();
      await refresh();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  const patch = (partial) => after(() => api.updateDeal(id, partial));

  async function deleteDeal() {
    setBusy(true);
    try {
      await api.deleteDeal(id);
      await refresh();
      backToBoard();
    } catch (e) {
      alert(e.message);
      setBusy(false);
    }
  }

  // Preserve whatever board filter/scroll state — and which of the two
  // boards — we arrived with, passed via location.state when navigating in
  // from a board. Falls back to a stage-appropriate board for a cold/direct/
  // shared link (S4 deals live on Meetings, everything else on Outreach).
  function backToBoard() {
    const search = location.state?.boardSearch;
    const base = location.state?.boardBase ?? (deal?.current_stage === 'S4' ? '/meetings' : '/outreach');
    navigate(search ? `${base}?${search}` : base);
  }

  if (notFound) {
    return (
      <div>
        <div className="flex items-center justify-between px-6 h-16 border-b border-hairline">
          <Eyebrow>Deal not found</Eyebrow>
          <Button variant="ghost" onClick={backToBoard}>← Back to board</Button>
        </div>
        <div className="px-6 py-10 text-text-disabled text-[13px]">
          This deal no longer exists.
        </div>
      </div>
    );
  }

  if (!deal || dealsLoading) {
    return <div className="px-6 py-10 text-text-secondary text-[13px]">Loading…</div>;
  }

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="border-b border-hairline shrink-0">
        <div className="px-6 pt-4">
          <Button variant="ghost" onClick={backToBoard}>← Back to board</Button>
        </div>

        <div className="px-6 pb-4 pt-2">
          <div className="flex items-center gap-2 mb-1">
            <Eyebrow>
              {deal.current_stage} · {STAGE_LABELS[deal.current_stage]}
            </Eyebrow>
          </div>
          <div className="text-text-primary text-[24px] font-medium truncate">{deal.company_name}</div>
          {/* Company name/vertical are edited from the company profile now
              (leads is the single source of truth, see 0039), not here. */}
          <button
            type="button"
            onClick={() => navigate(`/${deal.is_client ? 'clients' : 'leads'}/${deal.lead_id}`)}
            className="text-signal hover:underline text-[13px] mt-1"
          >
            View Company →
          </button>
        </div>
      </div>

      {/* Body: two independently-scrolling columns — main deal info on the
          left, Tasks + Activity pinned in a sidebar on the right so they
          stay visible while the left column scrolls through Notes/Attachments.
          The left "zone" is flex-1 with NO max-width, so it always consumes
          100% of whatever space remains after the fixed-width sidebar — that
          means there's never leftover row-level space to redistribute, so the
          sidebar's right edge stays flush with the true right edge of the
          content area at any viewport width (rather than the old
          justify-center approach, which centered the pair as one unit and
          left a gap after the sidebar on wide screens). The divider
          (border-r) lives on this outer zone, not on the capped content
          below, so it always touches the sidebar's left edge regardless of
          width. The actual text/form content still needs a readable cap, so
          it's nested in an inner w-full max-w-[720px] div, centered within
          the zone via the zone's own flex justify-center. */}
      <div className="flex-1 min-h-0 flex items-start pl-6">
        <div className="flex-1 min-w-0 h-full overflow-y-auto py-6 pr-6 border-r border-hairline flex justify-center">
          <div className="w-full max-w-[720px] space-y-8">
            <section>
              <Eyebrow className="mb-3">Overview</Eyebrow>
              <DealOverviewFields deal={deal} patch={patch} />
            </section>

            <StakeholdersSection dealId={id} />

            <NotesSection dealId={id} />

            <AttachmentsSection dealId={id} />

            {/* Danger zone — delete deal */}
            <section className="border-t border-hairline pt-4">
              {showDelete ? (
                <div className="border border-red-500/30 p-3 space-y-2 max-w-md">
                  <div className="text-text-secondary text-[12px]">
                    Permanently delete <span className="text-text-primary">{deal.company_name}</span>'s deal and
                    its full history? This cannot be undone.
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" onClick={() => setShowDelete(false)}>Cancel</Button>
                    <Button variant="danger" disabled={busy} onClick={deleteDeal}>Delete Deal</Button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setShowDelete(true)}
                  className="text-text-muted hover:text-red-400 text-[12px] transition-colors"
                >
                  Delete this deal
                </button>
              )}
            </section>
          </div>
        </div>

        <div className="w-[420px] shrink-0 h-full overflow-y-auto space-y-8 py-6">
          <section className="px-6">
            <Eyebrow className="mb-3">Stage Actions</Eyebrow>
            <StageActions key={deal.id} deal={deal} busy={busy} after={after} />
          </section>

          <div className="border-t border-hairline pt-4 px-6">
            <TasksSection dealId={id} />
          </div>

          <div className="border-t border-hairline pt-4 px-6">
            <ActivityTimeline dealId={id} />
          </div>
        </div>
      </div>
    </div>
  );
}
