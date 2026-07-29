import { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api.js';
import { useDeals } from '../state/DealsContext.jsx';
import { useLeads } from '../state/LeadsContext.jsx';
import { STAGE_LABELS } from '../lib/stages.js';
import { SlideOver } from './Overlay.jsx';
import { Field, Button, Eyebrow, IconButton } from './ui.jsx';
import ContactSelect from './ContactSelect.jsx';
import DealOverviewFields from './deal/DealOverviewFields.jsx';
import StageActions from './deal/StageActions.jsx';
import TouchLog from './deal/TouchLog.jsx';
import CompanyIntel from './company/CompanyIntel.jsx';
import { fmtDate, toDateInput } from '../lib/dates.js';
import { gmail } from '../lib/gmail.js';
import { useNavigate, useLocation } from 'react-router-dom';

// Slide-in panel showing one deal in full, with inline editing, stage
// transitions (auto-logged server-side), lost handling, and the touch log.
export default function DealDetailPanel() {
  const { selectedId, closeDeal, refresh } = useDeals();
  const { config, verticals, refresh: refreshLeads } = useLeads();
  const navigate = useNavigate();
  const location = useLocation();
  const [deal, setDeal] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showDelete, setShowDelete] = useState(false);

  const load = useCallback(async () => {
    if (selectedId == null) return;
    try {
      const data = await api.getDeal(selectedId);
      setDeal(data);
    } catch (e) {
      // Bad/deleted deal id in the URL (e.g. a stale or nonexistent deep
      // link) — bounce back to the board instead of hanging on "Loading…".
      closeDeal();
    }
  }, [selectedId, closeDeal]);

  useEffect(() => {
    setDeal(null);
    setShowDelete(false);
    load();
  }, [selectedId, load]);

  if (selectedId == null) return null;

  // Re-fetch this deal AND the shared list after any mutation.
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

  const patch = (partial) => after(() => api.updateDeal(deal.id, partial));

  // Delete the deal entirely, then close the panel and refresh the board.
  async function deleteDeal() {
    if (!deal?.id) return;
    setBusy(true);
    try {
      await api.deleteDeal(deal.id);
      closeDeal();
      await refresh();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SlideOver onClose={closeDeal}>
      {!deal ? (
        <div className="p-6 text-text-secondary text-[13px]">Loading…</div>
      ) : (
        <div className="flex flex-col min-h-full">
          {/* Header */}
          <div className="flex items-start justify-between px-5 pt-5 pb-4 border-b border-hairline">
            <div className="min-w-0">
              <Eyebrow className="mb-1">
                {deal.current_stage} · {STAGE_LABELS[deal.current_stage]}
              </Eyebrow>
              <div className="text-text-primary text-[18px] font-medium truncate">
                {deal.company_name}
              </div>
              {/* Company name/vertical live on the leads row (single source of
                  truth, see 0039) — edit them via the Company Intel section
                  below, or the full company profile (View Company →). */}
              <button
                type="button"
                onClick={() => navigate(`/${deal.is_client ? 'clients' : 'leads'}/${deal.lead_id}`)}
                className="text-signal hover:underline text-[12px] mt-0.5"
              >
                View Company →
              </button>
            </div>
            <div className="flex items-center gap-1.5 ml-3 shrink-0">
              <IconButton
                icon="expand"
                title="Open full record"
                aria-label="Open full record"
                onClick={() =>
                  navigate(`/deals/${deal.id}`, {
                    state: {
                      boardSearch: location.search.replace(/^\?/, ''),
                      boardBase: location.pathname.startsWith('/meetings') ? '/meetings' : '/outreach',
                    },
                  })
                }
              />
              <button onClick={closeDeal} className="text-text-muted hover:text-text-primary text-[13px]">
                ✕
              </button>
            </div>
          </div>

          {/* Stage actions */}
          <div className="px-5 py-4 border-b border-hairline">
            <StageActions key={deal.id} deal={deal} busy={busy} after={after} />
          </div>

          {/* Editable fields */}
          <div className="px-5 py-4 border-b border-hairline space-y-3">
            <DealOverviewFields deal={deal} patch={patch} />
            <Field label="Point of Contact">
              <ContactSelect
                value={deal.contact_id ?? ''}
                disabled={busy}
                onChange={(e) => patch({ contact_id: e.target.value })}
              />
            </Field>
          </div>

          {/* Company Intel — score/enrichment/signals/firmographics, the same
              info as the company profile, collapsed by default since this
              panel is a fast triage view (see comment above). */}
          <CompanyIntel
            leadId={deal.lead_id}
            config={config}
            verticals={verticals}
            onCompanyChanged={() => {
              load();
              refreshLeads();
            }}
          />

          {/* Stage history timeline — entry dates are editable so historical
              accounts can be backfilled with their true timeline. */}
          <div className="px-5 py-4 border-b border-hairline">
            <div className="flex items-center justify-between mb-3">
              <Eyebrow>Stage History</Eyebrow>
              <span className="eyebrow text-text-disabled">dates editable</span>
            </div>
            <div className="space-y-2">
              {deal.stage_history.map((h) => (
                <div key={h.id} className="flex items-center justify-between text-[12px] gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono text-text-secondary w-7 shrink-0">{h.stage}</span>
                    <span className="text-text-secondary truncate">{STAGE_LABELS[h.stage]}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <input
                      type="date"
                      value={toDateInput(h.entered_at)}
                      onChange={(e) =>
                        e.target.value && after(() => api.updateStageDate(deal.id, h.id, e.target.value))
                      }
                      disabled={busy}
                      style={{ colorScheme: 'dark' }}
                      className="bg-transparent border border-hairline px-1.5 py-0.5 font-mono text-text-secondary text-[12px] outline-none focus:border-signal/60"
                    />
                    <span className="font-mono text-text-muted w-9 text-right">
                      {h.days_in_stage}d{h.ongoing ? '·' : ''}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Meetings synced from Google Calendar (hidden when none). */}
          <Meetings dealId={deal.id} />

          {/* Touch log */}
          <TouchLog deal={deal} onChanged={() => after(async () => {})} />

          {/* Danger zone — delete deal */}
          <div className="px-5 py-4 border-t border-hairline mt-auto">
            {showDelete ? (
              <div className="border border-red-500/30 p-3 space-y-2">
                <div className="text-text-secondary text-[12px]">
                  Permanently delete <span className="text-text-primary">{deal.company_name}</span>'s deal and its
                  full history? This cannot be undone.
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setShowDelete(false)}>Cancel</Button>
                  <Button variant="danger" disabled={busy} onClick={deleteDeal}>
                    Delete Deal
                  </Button>
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
          </div>
        </div>
      )}
    </SlideOver>
  );
}

// Meetings synced from Google Calendar for this deal. Self-fetching; renders
// nothing when there are none (keeps the panel clean for most deals).
function Meetings({ dealId }) {
  const [meetings, setMeetings] = useState(null);

  useEffect(() => {
    let alive = true;
    gmail
      .listDealMeetings(dealId)
      .then((m) => alive && setMeetings(m))
      .catch(() => alive && setMeetings([]));
    return () => {
      alive = false;
    };
  }, [dealId]);

  if (!meetings || meetings.length === 0) return null;

  return (
    <div className="px-5 py-4 border-b border-hairline">
      <Eyebrow className="mb-3">Meetings</Eyebrow>
      <div className="space-y-2">
        {meetings.map((m) => (
          <div key={m.id} className="flex items-center justify-between text-[12px] gap-2">
            <span className="text-text-primary truncate">{m.title || 'Meeting'}</span>
            <span className="text-text-muted shrink-0">{m.starts_at ? fmtDate(m.starts_at) : ''}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

