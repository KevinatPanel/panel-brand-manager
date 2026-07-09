import { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api.js';
import { useDeals } from '../state/DealsContext.jsx';
import {
  STAGE_LABELS,
  OWNERS,
  SOURCES,
  CHANNELS,
  TOUCH_TYPES,
  TOUCH_OUTCOMES,
  nextStageCode,
  formatCurrency,
} from '../lib/stages.js';
import { SlideOver } from './Overlay.jsx';
import { Field, Input, Select, Button, Eyebrow } from './ui.jsx';
import ContactSelect from './ContactSelect.jsx';
import { fmtDate, toDateInput, todayInput } from '../lib/dates.js';
import { gmail } from '../lib/gmail.js';

// Slide-in panel showing one deal in full, with inline editing, stage
// transitions (auto-logged server-side), lost handling, and the touch log.
export default function DealDetailPanel() {
  const { selectedId, closeDeal, refresh } = useDeals();
  const [deal, setDeal] = useState(null);
  const [verticals, setVerticals] = useState([]);
  const [busy, setBusy] = useState(false);
  const [showLost, setShowLost] = useState(false);
  const [lostReason, setLostReason] = useState('');
  const [showDelete, setShowDelete] = useState(false);

  useEffect(() => {
    api.listVerticals().then(setVerticals).catch(() => {});
  }, []);

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
    setShowLost(false);
    setLostReason('');
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
      setBusy(false);
    }
  }

  const next = deal ? nextStageCode(deal.current_stage) : null;
  const isLost = deal?.current_stage === 'LOST';

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
              <input
                value={deal.brand_name}
                onChange={(e) => setDeal({ ...deal, brand_name: e.target.value })}
                onBlur={(e) => patch({ brand_name: e.target.value })}
                className="bg-transparent text-text-primary text-[18px] font-medium outline-none w-full"
              />
            </div>
            <button onClick={closeDeal} className="text-text-muted hover:text-text-primary text-[13px] ml-3">
              ✕
            </button>
          </div>

          {/* Stage actions */}
          <div className="px-5 py-4 border-b border-hairline space-y-3">
            <div className="flex items-center gap-2">
              {next && !isLost ? (
                <Button variant="primary" disabled={busy} onClick={() => after(() => api.advanceDeal(deal.id))}>
                  Move to {next} · {STAGE_LABELS[next]}
                </Button>
              ) : (
                <span className="text-text-secondary text-[12px]">
                  {isLost ? 'Closed Lost — terminal' : 'Closed Won — S4 reached'}
                </span>
              )}
              {!isLost && (
                <Button variant="danger" disabled={busy} onClick={() => setShowLost((s) => !s)}>
                  Mark as Lost
                </Button>
              )}
            </div>

            {/* Lost reason prompt */}
            {showLost && (
              <div className="border border-red-500/30 p-3 space-y-2">
                <Eyebrow className="text-red-400">Lost reason (required)</Eyebrow>
                <Input
                  value={lostReason}
                  onChange={(e) => setLostReason(e.target.value)}
                  placeholder="e.g. Budget frozen, chose competitor…"
                  autoFocus
                />
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setShowLost(false)}>Cancel</Button>
                  <Button
                    variant="danger"
                    disabled={busy || !lostReason.trim()}
                    onClick={() =>
                      after(() => api.markLost(deal.id, lostReason)).then(() => setShowLost(false))
                    }
                  >
                    Confirm Lost
                  </Button>
                </div>
              </div>
            )}

            {isLost && deal.closed_lost_reason && (
              <div className="text-[12px] text-text-secondary">
                <span className="text-text-muted">Reason: </span>
                {deal.closed_lost_reason}
              </div>
            )}
          </div>

          {/* Editable fields */}
          <div className="px-5 py-4 border-b border-hairline grid grid-cols-2 gap-3">
            <Field label="Owner">
              <Select value={deal.owner ?? ''} onChange={(e) => patch({ owner: e.target.value })}>
                <option value="">Unassigned</option>
                {OWNERS.map((o) => <option key={o} value={o}>{o}</option>)}
              </Select>
            </Field>
            <Field label="Vertical">
              <Select value={deal.vertical ?? ''} onChange={(e) => patch({ vertical: e.target.value })}>
                <option value="">Unsorted</option>
                {verticals.map((v) => <option key={v.id} value={v.name}>{v.name}</option>)}
                {/* Preserve a legacy free-text vertical not in the list. */}
                {deal.vertical && !verticals.some((v) => v.name === deal.vertical) && (
                  <option value={deal.vertical}>{deal.vertical}</option>
                )}
              </Select>
            </Field>
            <Field label="Source">
              <Select value={deal.source ?? ''} onChange={(e) => patch({ source: e.target.value })}>
                <option value="">—</option>
                {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            </Field>
            <Field label="Channel">
              <Select value={deal.channel ?? ''} onChange={(e) => patch({ channel: e.target.value })}>
                <option value="">—</option>
                {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </Field>
            <Field label="Pilot Spend (USD)">
              <Input
                type="number"
                min="0"
                defaultValue={deal.pilot_spend ?? ''}
                onBlur={(e) => patch({ pilot_spend: e.target.value === '' ? null : Number(e.target.value) })}
                className="font-mono"
              />
            </Field>
            <div className="col-span-2">
              <Field label="Point of Contact">
                <ContactSelect
                  value={deal.contact_id ?? ''}
                  disabled={busy}
                  onChange={(e) => patch({ contact_id: e.target.value })}
                />
              </Field>
            </div>
            <div className="self-end">
              <Eyebrow className="mb-1">Days in pipeline</Eyebrow>
              <span className="font-mono text-[13px] text-text-primary">{deal.days_in_pipeline}d</span>
            </div>
          </div>

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
                  Permanently delete <span className="text-text-primary">{deal.brand_name}</span> and its
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

// Touch log with an inline "Add Touch" form.
function TouchLog({ deal, onChanged }) {
  const [adding, setAdding] = useState(false);
  const blank = () => ({ touch_type: 'Email', outcome: 'No Response', notes: '', touch_date: todayInput() });
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.addTouch(deal.id, form);
      setForm(blank());
      setAdding(false);
      onChanged();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-5 py-4">
      <div className="flex items-center justify-between mb-3">
        <Eyebrow>Touch Log</Eyebrow>
        <Button variant="ghost" onClick={() => setAdding((a) => !a)}>+ Add Touch</Button>
      </div>

      {adding && (
        <form onSubmit={submit} className="border border-hairline p-3 mb-3 space-y-2">
          <Field label="Date Sent">
            <Input
              type="date"
              value={form.touch_date}
              onChange={(e) => setForm({ ...form, touch_date: e.target.value })}
              style={{ colorScheme: 'dark' }}
              className="font-mono"
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Select value={form.touch_type} onChange={(e) => setForm({ ...form, touch_type: e.target.value })}>
              {TOUCH_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
            <Select value={form.outcome} onChange={(e) => setForm({ ...form, outcome: e.target.value })}>
              {TOUCH_OUTCOMES.map((o) => <option key={o} value={o}>{o}</option>)}
            </Select>
          </div>
          <Input
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="Notes (optional)"
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={busy}>Log Touch</Button>
          </div>
        </form>
      )}

      <div className="space-y-2">
        {deal.touches.length === 0 ? (
          <div className="text-text-disabled text-[12px]">No touches logged.</div>
        ) : (
          deal.touches.map((t) => (
            <div key={t.id} className="border-b border-hairline pb-2">
              <div className="flex items-center justify-between text-[12px]">
                <span className="flex items-center gap-1.5">
                  <span className="text-text-primary">{t.touch_type}</span>
                  {t.source === 'gmail' && (
                    <span className="eyebrow text-signal/80 border border-signal/30 px-1">Gmail</span>
                  )}
                </span>
                <span className="text-text-muted">{fmtDate(t.touch_date)}</span>
              </div>
              <div className="flex items-center justify-between mt-0.5">
                <span className="eyebrow text-text-secondary">{t.outcome}</span>
              </div>
              {t.notes && <div className="text-[12px] text-text-secondary mt-1">{t.notes}</div>}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
