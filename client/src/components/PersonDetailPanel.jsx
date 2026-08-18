import { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api.js';
import { usePeople } from '../state/PeopleContext.jsx';
import { useLeads } from '../state/LeadsContext.jsx';
import { OWNERS, TOUCH_TYPES, TOUCH_OUTCOMES } from '../lib/stages.js';
import { fmtDate, todayInput } from '../lib/dates.js';
import { relativeTime } from '../lib/leads.js';
import { SlideOver } from './Overlay.jsx';
import { Field, Input, TextArea, Select, Button, Eyebrow } from './ui.jsx';

// Slide-in panel showing one person in full: editable profile + their complete
// outreach history with Panel.
export default function PersonDetailPanel() {
  const { selectedId, closePerson, refresh } = usePeople();
  const { openLead } = useLeads();
  const [person, setPerson] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showDelete, setShowDelete] = useState(false);

  const load = useCallback(async () => {
    if (selectedId == null) return;
    try {
      setPerson(await api.getContact(selectedId));
    } catch (e) {
      // Bad/deleted person id in the URL (e.g. a stale or nonexistent deep
      // link) — bounce back to the roster instead of hanging on "Loading…".
      closePerson();
    }
  }, [selectedId, closePerson]);

  useEffect(() => {
    setPerson(null);
    setShowDelete(false);
    load();
  }, [selectedId, load]);

  if (selectedId == null) return null;

  // Run a mutation, then refresh this panel + the roster.
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

  // updateContact is scoped to the parent company (lead_id, contact id).
  const patch = (partial) => after(() => api.updateContact(person.lead_id, person.id, partial));

  async function deletePerson() {
    setBusy(true);
    try {
      await api.deleteContact(person.lead_id, person.id);
      closePerson();
      await refresh();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  function viewCompany() {
    closePerson();
    openLead(person.lead_id);
  }

  return (
    <SlideOver onClose={closePerson} width="w-[480px]">
      {!person ? (
        <div className="p-6 text-text-secondary text-[13px]">Loading…</div>
      ) : (
        <div className="flex flex-col min-h-full">
          {/* Header */}
          <div className="px-5 pt-5 pb-4 border-b border-hairline sticky top-0 bg-space z-10">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <input
                  value={person.name ?? ''}
                  onChange={(e) => setPerson({ ...person, name: e.target.value })}
                  onBlur={(e) => patch({ name: e.target.value })}
                  className="bg-transparent text-text-primary text-[20px] font-semibold outline-none w-full"
                  placeholder="Name"
                />
                {person.title && (
                  <div className="text-text-secondary text-[13px] mt-0.5 truncate">{person.title}</div>
                )}
                <button
                  onClick={viewCompany}
                  className="text-text-muted hover:text-signal text-[12px] mt-1"
                >
                  {person.company_name ?? 'No company'} →
                </button>
              </div>
              <button onClick={closePerson} className="text-text-muted hover:text-text-primary text-[13px]">
                ✕
              </button>
            </div>
          </div>

          {/* Profile */}
          <div className="px-5 py-4 border-b border-hairline">
            <div className="flex items-center justify-between mb-3">
              <Eyebrow>Profile</Eyebrow>
              {person.enriched_at ? (
                <Button
                  variant="ghost"
                  disabled={busy || !(person.email || person.linkedin)}
                  title="Re-fetch from Apollo (uses a credit)"
                  onClick={() => after(() => api.enrichContact(person.id, { force: true }))}
                >
                  ↻ Re-enrich
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  disabled={busy || !(person.email || person.linkedin)}
                  title={
                    person.email || person.linkedin
                      ? 'Pull title, contact info & location from Apollo'
                      : 'Add a work email or LinkedIn URL first'
                  }
                  onClick={() => after(() => api.enrichContact(person.id))}
                >
                  ↻ Enrich from Apollo
                </Button>
              )}
            </div>
            {/* Keyed by enriched_at so Apollo-filled values replace the
                uncontrolled inputs' DOM value after an enrichment refresh. */}
            <div key={`profile-${person.enriched_at ?? '0'}`} className="grid grid-cols-2 gap-3">
              <Field label="Title">
                <Input defaultValue={person.title ?? ''} onBlur={(e) => patch({ title: e.target.value })} placeholder="VP Growth" />
              </Field>
              <Field label="Seniority / Dept">
                <Input defaultValue={person.seniority ?? ''} onBlur={(e) => patch({ seniority: e.target.value })} placeholder="Director, Marketing" />
              </Field>
              <Field label="Email">
                <Input type="email" defaultValue={person.email ?? ''} onBlur={(e) => patch({ email: e.target.value })} placeholder="name@company.com" />
              </Field>
              <Field label="Phone">
                <Input defaultValue={person.phone ?? ''} onBlur={(e) => patch({ phone: e.target.value })} placeholder="+1 555 123 4567" />
              </Field>
              <Field label="LinkedIn">
                <Input defaultValue={person.linkedin ?? ''} onBlur={(e) => patch({ linkedin: e.target.value })} placeholder="linkedin.com/in/…" />
              </Field>
              <Field label="Location">
                <Input defaultValue={person.location ?? ''} onBlur={(e) => patch({ location: e.target.value })} placeholder="San Francisco, CA" />
              </Field>
            </div>
            <div className="mt-3">
              <Field label="Notes / Background">
                <TextArea
                  defaultValue={person.notes ?? ''}
                  onBlur={(e) => patch({ notes: e.target.value })}
                  placeholder="Who they are, how we know them, relationship context…"
                />
              </Field>
            </div>
            {person.enriched_at && (
              <div className="text-text-disabled text-[11px] mt-3">
                Last enriched {relativeTime(person.enriched_at)}
              </div>
            )}
          </div>

          {/* Outreach history */}
          <OutreachLog person={person} busy={busy} after={after} />

          {/* Footer — remove person */}
          <div className="px-5 py-4 border-t border-hairline mt-auto bg-space">
            {showDelete ? (
              <div className="border border-red-500/30 p-3 space-y-2">
                <div className="text-text-secondary text-[12px]">
                  Permanently delete <span className="text-text-primary">{person.name}</span> and their
                  outreach history? This cannot be undone.
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setShowDelete(false)}>Cancel</Button>
                  <Button variant="danger" disabled={busy} onClick={deletePerson}>Remove Person</Button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowDelete(true)}
                className="text-text-muted hover:text-red-400 text-[12px] transition-colors"
              >
                Remove this person
              </button>
            )}
          </div>
        </div>
      )}
    </SlideOver>
  );
}

// Per-person outreach log with an inline "Log Touch" form (mirrors the deal
// TouchLog, plus an owner field).
function OutreachLog({ person, busy, after }) {
  const [adding, setAdding] = useState(false);
  const blank = () => ({ touch_type: 'Email', outcome: 'No Response', owner: '', notes: '', touch_date: todayInput() });
  const [form, setForm] = useState(blank);

  function submit(e) {
    e.preventDefault();
    after(() => api.addContactTouch(person.id, form)).then(() => {
      setForm(blank());
      setAdding(false);
    });
  }

  return (
    <div className="px-5 py-4">
      <div className="flex items-center justify-between mb-3">
        <Eyebrow>Outreach History</Eyebrow>
        <Button variant="ghost" onClick={() => setAdding((a) => !a)}>+ Log Touch</Button>
      </div>

      {adding && (
        <form onSubmit={submit} className="border border-hairline p-3 mb-3 space-y-2">
          <Field label="Date">
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
          <Select value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })}>
            <option value="">Owner (unassigned)</option>
            {OWNERS.map((o) => <option key={o} value={o}>{o}</option>)}
          </Select>
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
        {person.touches.length === 0 ? (
          <div className="text-text-disabled text-[12px]">No outreach logged yet.</div>
        ) : (
          person.touches.map((t) => (
            <div key={t.id} className="border-b border-hairline pb-2">
              <div className="flex items-center justify-between text-[12px]">
                <span className="text-text-primary">
                  {t.touch_type}
                  {t.owner && <span className="text-text-muted"> · {t.owner}</span>}
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-text-muted">{fmtDate(t.touch_date)}</span>
                  <button
                    onClick={() => after(() => api.deleteContactTouch(person.id, t.id))}
                    className="text-text-muted hover:text-red-400"
                    title="Delete touch"
                    disabled={busy}
                  >
                    ✕
                  </button>
                </div>
              </div>
              <div className="mt-0.5 flex items-center gap-2">
                <span className="eyebrow text-text-secondary">{t.outcome}</span>
                {t.source === 'gmail' && <span className="eyebrow text-text-disabled">via Gmail</span>}
              </div>
              {t.notes && <div className="text-[12px] text-text-secondary mt-1">{t.notes}</div>}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
