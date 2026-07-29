import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useLeads } from '../state/LeadsContext.jsx';
import { useDeals } from '../state/DealsContext.jsx';
import { fmtDate } from '../lib/dates.js';
import { Field, Input, Button, Eyebrow } from './ui.jsx';
import SearchSelect from './SearchSelect.jsx';
import AdTrackerSection from './AdTrackerSection.jsx';
import SpendGoalWidget from './SpendGoalWidget.jsx';
import QualityMetricWidget from './QualityMetricWidget.jsx';
import OffersWidget from './OffersWidget.jsx';
import ScoreBadge from './company/ScoreBadge.jsx';
import EnrichmentSection from './company/EnrichmentSection.jsx';
import SignalsSection from './company/SignalsSection.jsx';
import FirmographicsFields from './company/FirmographicsFields.jsx';

// The full company/client profile: two independently-scrolling columns, same
// pattern as DealView.jsx — firmographics/enrichment/signals/account actions
// in a wide left column, Contacts/Ad Tracker/Activity pinned in a fixed-width
// right sidebar. Rendered as the full page at /clients/:id and /leads/:leadId
// (see CompanyView.jsx) — there is no slide-over anymore.
//   leadId     — company to load
//   onDeleted  — called after the company is deleted (caller navigates away)
export default function CompanyProfile({ leadId, onDeleted }) {
  const { verticals, config, refresh } = useLeads();
  const { deals } = useDeals();
  const navigate = useNavigate();
  const [lead, setLead] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [showMerge, setShowMerge] = useState(false);
  const [mergeCompanies, setMergeCompanies] = useState([]);
  const [mergeTargetId, setMergeTargetId] = useState('');
  const [mergeError, setMergeError] = useState(null);

  const load = useCallback(async () => {
    if (leadId == null) return;
    try {
      setLead(await api.getLead(leadId));
    } catch (e) {
      // Bad/deleted lead id (e.g. a stale or nonexistent deep link) — bounce
      // back instead of hanging on "Loading…".
      onDeleted?.();
    }
  }, [leadId, onDeleted]);

  useEffect(() => {
    setLead(null);
    setShowDelete(false);
    setShowMerge(false);
    setMergeTargetId('');
    load();
  }, [leadId, load]);

  // Companies list for the "merge into" picker, loaded lazily when opened —
  // matches AddPersonModal's company picker (listLeads + alphabetical sort).
  useEffect(() => {
    if (!showMerge) return;
    api
      .listLeads()
      .then((rows) =>
        setMergeCompanies(
          [...rows]
            .filter((r) => r.id !== leadId)
            .sort((a, b) => (a.company_name ?? '').localeCompare(b.company_name ?? '')),
        ),
      )
      .catch((e) => setMergeError(e.message));
  }, [showMerge, leadId]);

  // Delete the lead entirely, then notify the caller and refresh the board.
  async function deleteLead() {
    setBusy(true);
    try {
      await api.deleteLead(lead.id);
      onDeleted?.();
      await refresh();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  // Merge this company into another (it becomes the loser and is deleted —
  // see merge_leads RPC), then bounce back like a delete.
  async function mergeInto() {
    if (!mergeTargetId) {
      setMergeError('Choose a company to merge into.');
      return;
    }
    setBusy(true);
    setMergeError(null);
    try {
      await api.mergeLeads(Number(mergeTargetId), lead.id);
      onDeleted?.();
      await refresh();
    } catch (e) {
      setMergeError(e.message);
    } finally {
      setBusy(false);
    }
  }

  // Run a mutation, then refresh this profile + the board (re-ranks/re-scores).
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

  if (!lead || !config) {
    return <div className="p-6 text-text-secondary text-[13px]">Loading…</div>;
  }

  return (
    <div className="flex-1 min-h-0 flex items-start pl-6">
      {/* Left column — everything except Contacts/Ad Tracker/Activity */}
      <div className="flex-1 min-w-0 h-full overflow-y-auto py-6 pr-6 border-r border-hairline flex justify-center">
        <div className="w-full max-w-[720px]">
          {/* Header */}
          <div className="px-5 pt-5 pb-4 border-b border-hairline">
            <input
              key={lead.id}
              defaultValue={lead.company_name ?? ''}
              onBlur={(e) => {
                const next = e.target.value.trim();
                if (next && next !== lead.company_name) {
                  after(() => api.updateLead(lead.id, { company_name: next }));
                } else {
                  e.target.value = lead.company_name ?? '';
                }
              }}
              className="bg-transparent text-text-primary text-[20px] font-semibold outline-none w-full truncate"
              placeholder="Company name"
            />
            <ScoreBadge score={lead.score} updatedAt={lead.score_updated_at} />

            <FirmographicsFields lead={lead} verticals={verticals} after={after}>
              <EverflowAdvertiserIdField lead={lead} busy={busy} after={after} />
              {lead.everflow_advertiser_id && (
                <EverflowQualityEventNameField lead={lead} after={after} />
              )}
            </FirmographicsFields>
          </div>

          {/* Enrichment/Signals/pipeline actions/merge/remove are all
              prospect-side concepts (Directory) — not shown once a company
              is a client. */}
          {!lead.is_client && (
            <>
              {/* Enrichment (Apollo) */}
              <EnrichmentSection lead={lead} busy={busy} after={after} />

              {/* Signals */}
              <SignalsSection lead={lead} config={config} after={after} />

              {/* Footer — client flag, Start Outreach + remove lead */}
              <div className="px-5 py-4 border-t border-hairline space-y-3">
                <Button
                  variant="secondary"
                  className="w-full"
                  disabled={busy}
                  onClick={() => after(() => api.updateLead(lead.id, { is_client: true }))}
                >
                  ★ Mark as client
                </Button>

                {lead.in_pipeline ? (
                  <div className="flex items-center justify-between">
                    <span className="eyebrow text-signal flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 bg-signal inline-block" />
                      In Pipeline
                    </span>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        const deal = deals.find((d) => d.id === lead.deal_id);
                        const base = deal?.current_stage === 'S4' ? '/meetings' : '/outreach';
                        navigate(lead.deal_id ? `${base}/${lead.deal_id}` : base);
                      }}
                    >
                      View in Pipeline →
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="primary"
                    className="w-full"
                    disabled={busy}
                    onClick={() => after(() => api.startLeadOutreach(lead.id))}
                  >
                    Start Outreach →
                  </Button>
                )}

                {showMerge ? (
                  <div className="border border-hairline p-3 space-y-2">
                    <div className="text-text-secondary text-[12px]">
                      Merge <span className="text-text-primary">{lead.company_name}</span> into another
                      company — its contacts, ad items, signals, and spend history move over, then this
                      record is deleted. This cannot be undone.
                    </div>
                    <SearchSelect
                      value={mergeTargetId}
                      onChange={setMergeTargetId}
                      options={mergeCompanies.map((c) => ({ value: c.id, label: c.company_name }))}
                      placeholder="Select a company…"
                    />
                    {mergeError && <div className="text-red-400 text-[12px]">{mergeError}</div>}
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setShowMerge(false);
                          setMergeTargetId('');
                          setMergeError(null);
                        }}
                      >
                        Cancel
                      </Button>
                      <Button variant="danger" disabled={busy || !mergeTargetId} onClick={mergeInto}>
                        Merge
                      </Button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowMerge(true)}
                    className="text-text-muted hover:text-text-primary text-[12px] transition-colors"
                  >
                    Merge into another company
                  </button>
                )}

                {showDelete ? (
                  <div className="border border-red-500/30 p-3 space-y-2">
                    <div className="text-text-secondary text-[12px]">
                      Permanently delete <span className="text-text-primary">{lead.company_name}</span>,
                      its signals and contacts? This cannot be undone.
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" onClick={() => setShowDelete(false)}>Cancel</Button>
                      <Button variant="danger" disabled={busy} onClick={deleteLead}>Remove Lead</Button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowDelete(true)}
                    className="text-text-muted hover:text-red-400 text-[12px] transition-colors"
                  >
                    Remove this lead
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Right sidebar — Spend vs. Goal, Contacts, Ad Tracker, Activity.
          Spend vs. Goal and Ad Tracker are client-only concepts (nothing to
          track until there's a live ad deal) — hidden for Directory
          prospects, same as the Enrichment/Signals/pipeline gating above. */}
      <div className="w-[420px] shrink-0 h-full overflow-y-auto">
        {lead.is_client && <SpendGoalWidget lead={lead} />}
        <QualityMetricWidget lead={lead} />
        <OffersWidget lead={lead} />
        <ContactsSection lead={lead} busy={busy} after={after} />
        {lead.is_client && <AdTrackerSection leadId={lead.id} />}
        <ActivitySection leadId={lead.id} />
      </div>
    </div>
  );
}

// Everflow Advertiser ID — same inline-edit convention as the other header
// fields (uncontrolled Input, save on blur), except changing or clearing an
// ID that's already set requires an explicit confirm first: this field
// silently controls which advertiser Spend & Goals syncs against, so a
// fat-fingered edit would quietly start pulling the wrong client's revenue.
// First-time entry (field currently empty) still saves immediately — nothing
// to protect yet. Confirm styling mirrors the "Remove this lead" pattern
// below in this same file.
function EverflowAdvertiserIdField({ lead, busy, after }) {
  const [pending, setPending] = useState(null);
  const [resetKey, setResetKey] = useState(0);
  const current = lead.everflow_advertiser_id ?? '';

  function handleBlur(e) {
    const next = e.target.value.trim();
    if (next === current) return;
    if (!current) {
      after(() => api.updateLead(lead.id, { everflow_advertiser_id: next || null }));
      return;
    }
    setPending(next);
  }

  function confirm() {
    after(() => api.updateLead(lead.id, { everflow_advertiser_id: pending || null })).then(() =>
      setPending(null),
    );
  }

  function cancel() {
    setPending(null);
    setResetKey((k) => k + 1);
  }

  return (
    <Field label="Everflow Advertiser ID">
      <Input key={`efid-${current}-${resetKey}`} defaultValue={current} onBlur={handleBlur} placeholder="e.g. 1234" />
      {pending !== null && (
        <div className="mt-1.5 border border-red-500/30 p-2 space-y-1.5">
          <div className="text-text-secondary text-[11px]">
            {pending ? (
              <>
                Change Advertiser ID from <span className="text-text-primary">{current}</span> to{' '}
                <span className="text-text-primary">{pending}</span>? This affects Spend &amp; Goals syncing.
              </>
            ) : (
              <>Clear the Advertiser ID? Spend syncing for this client will stop until it's set again.</>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={cancel}>Cancel</Button>
            <Button variant="danger" disabled={busy} onClick={confirm}>Confirm</Button>
          </div>
        </div>
      )}
    </Field>
  );
}

// Free-text name of this client's secondary "quality" conversion event in
// Everflow (e.g. "Payroll" for Current) — distinct from the billable/base
// event the Spend & Goals sync tracks. Unlike the Advertiser ID above, changing
// this only affects which secondary metric QualityMetricWidget displays; it
// never redirects spend/goal syncing, so a plain save-on-blur is fine — no
// confirm step needed.
function EverflowQualityEventNameField({ lead, after }) {
  const current = lead.everflow_quality_event_name ?? '';

  function handleBlur(e) {
    const next = e.target.value.trim();
    if (next === current) return;
    after(() => api.updateLead(lead.id, { everflow_quality_event_name: next || null }));
  }

  return (
    <Field label="Everflow Quality Event">
      <Input key={`efqe-${current}`} defaultValue={current} onBlur={handleBlur} placeholder="e.g. Payroll" />
    </Field>
  );
}

// Unified, read-only activity feed: person touches + deal touches + meetings,
// merged newest-first. Lazy-loaded so opening a company doesn't pay for it
// unless the section renders.
function ActivitySection({ leadId }) {
  const [items, setItems] = useState(null);

  useEffect(() => {
    let active = true;
    setItems(null);
    api
      .getCompanyActivity(leadId)
      .then((rows) => active && setItems(rows))
      .catch(() => active && setItems([]));
    return () => {
      active = false;
    };
  }, [leadId]);

  return (
    <div className="px-5 py-4 border-t border-hairline">
      <Eyebrow className="mb-3">Activity</Eyebrow>
      {items == null ? (
        <div className="text-text-disabled text-[12px]">Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-text-disabled text-[12px]">No activity yet.</div>
      ) : (
        <div className="space-y-2">
          {items.map((it) => (
            <div key={it.id} className="border-b border-hairline pb-2">
              <div className="flex items-center justify-between text-[12px]">
                <span className="text-text-primary flex items-center gap-1.5">
                  <ActivityKind kind={it.kind} />
                  {it.kind === 'meeting' ? (it.title || 'Meeting') : it.touch_type}
                  {it.kind === 'person' && it.contact_name && (
                    <span className="text-text-secondary">· {it.contact_name}</span>
                  )}
                  {it.owner && <span className="text-text-muted">· {it.owner}</span>}
                </span>
                <span className="text-text-muted">{fmtDate(it.date)}</span>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                {it.kind !== 'meeting' && it.outcome && (
                  <span className="eyebrow text-text-secondary">{it.outcome}</span>
                )}
                {it.kind === 'meeting' && it.status && (
                  <span className="eyebrow text-text-secondary">{it.status}</span>
                )}
                {it.source === 'gmail' && <span className="eyebrow text-text-disabled">via Gmail</span>}
              </div>
              {it.notes && <div className="text-[12px] text-text-secondary mt-1">{it.notes}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Small monospace tag distinguishing the three activity sources.
function ActivityKind({ kind }) {
  const label = { person: 'person', deal: 'deal', meeting: 'mtg' }[kind] ?? kind;
  return <span className="font-mono text-[10px] text-text-disabled uppercase">[{label}]</span>;
}

// Contacts list + add form. Adding/removing rescores via key_contacts.
const EMPTY_CONTACT = { name: '', title: '', linkedin: '', email: '' };

function ContactsSection({ lead, busy, after }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY_CONTACT);

  function submit(e) {
    e.preventDefault();
    if (!form.name.trim()) return;
    after(() => api.addContact(lead.id, form)).then(() => {
      setForm(EMPTY_CONTACT);
      setAdding(false);
    });
  }

  return (
    <div className="px-5 py-4 border-t border-hairline">
      <div className="flex items-center justify-between mb-3">
        <Eyebrow>Contacts</Eyebrow>
        <Button variant="ghost" onClick={() => setAdding((a) => !a)}>+ Add Contact</Button>
      </div>

      {adding && (
        <form onSubmit={submit} className="border border-hairline p-3 mb-3 space-y-2">
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name" autoFocus />
          <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Title" />
          <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="Email" type="email" />
          <Input value={form.linkedin} onChange={(e) => setForm({ ...form, linkedin: e.target.value })} placeholder="LinkedIn URL" />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={busy}>Add</Button>
          </div>
        </form>
      )}

      <div className="space-y-2">
        {lead.contacts.length === 0 ? (
          <div className="text-text-disabled text-[12px]">No contacts yet.</div>
        ) : (
          lead.contacts.map((c) => (
            <ContactRow key={c.id} lead={lead} contact={c} busy={busy} after={after} />
          ))
        )}
      </div>
    </div>
  );
}

// A single contact row — view mode shows name/title/email + links; edit mode
// swaps in inline fields saved on blur via api.updateContact.
function ContactRow({ lead, contact, busy, after }) {
  const [editing, setEditing] = useState(false);

  function save(patch) {
    after(() => api.updateContact(lead.id, contact.id, patch));
  }

  if (editing) {
    return (
      <div className="border border-hairline p-3 mb-1 space-y-2">
        <Input defaultValue={contact.name ?? ''} onBlur={(e) => save({ name: e.target.value })} placeholder="Name" />
        <Input defaultValue={contact.title ?? ''} onBlur={(e) => save({ title: e.target.value })} placeholder="Title" />
        <Input defaultValue={contact.email ?? ''} onBlur={(e) => save({ email: e.target.value })} placeholder="Email" type="email" />
        <Input defaultValue={contact.linkedin ?? ''} onBlur={(e) => save({ linkedin: e.target.value })} placeholder="LinkedIn URL" />
        <div className="flex justify-end">
          <Button type="button" variant="ghost" onClick={() => setEditing(false)}>Done</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between border-b border-hairline pb-2">
      <div className="min-w-0">
        <div className="text-text-primary text-[13px] truncate">{contact.name}</div>
        {contact.title && <div className="text-text-secondary text-[12px] truncate">{contact.title}</div>}
        {contact.email && (
          <a
            href={`mailto:${contact.email}`}
            className="text-text-muted hover:text-signal text-[12px] truncate block"
          >
            {contact.email}
          </a>
        )}
      </div>
      <div className="flex items-center gap-3 shrink-0">
        {contact.linkedin && (
          <a
            href={contact.linkedin.startsWith('http') ? contact.linkedin : `https://${contact.linkedin}`}
            target="_blank"
            rel="noreferrer"
            className="text-text-muted hover:text-signal text-[12px]"
          >
            in↗
          </a>
        )}
        <button
          onClick={() => setEditing(true)}
          className="text-text-muted hover:text-text-primary text-[12px]"
          title="Edit contact"
        >
          ✎
        </button>
        <button
          onClick={() => after(() => api.deleteContact(lead.id, contact.id))}
          className="text-text-muted hover:text-red-400 text-[12px]"
          title="Delete contact"
          disabled={busy}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
