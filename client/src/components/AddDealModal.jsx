import { useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { useLeads } from '../state/LeadsContext.jsx';
import { OWNERS, SOURCES, CHANNELS } from '../lib/stages.js';
import { todayInput } from '../lib/dates.js';
import { Modal } from './Overlay.jsx';
import { Field, Input, Select, Button } from './ui.jsx';
import ContactSelect from './ContactSelect.jsx';

// Create a deal by attaching it to a company — search Directory for an
// existing company or create one inline, then start outreach (S1) on it.
// Every deal requires a lead_id now (see 0039_unify_deal_lead_identity), so
// this replaces the old free-text "brand name" field, which let a rep create
// a deal with zero link to Directory and silently duplicate a company that
// already existed there.
export default function AddDealModal({ onClose, onCreated }) {
  const { leads, verticals, refresh: refreshLeads } = useLeads();
  const [query, setQuery] = useState('');
  const [companyOpen, setCompanyOpen] = useState(false);
  const [selectedLead, setSelectedLead] = useState(null);
  const [creatingNew, setCreatingNew] = useState(false);
  const [newVerticalId, setNewVerticalId] = useState('');

  const [form, setForm] = useState({
    owner: '',
    source: 'Outbound',
    channel: 'Email',
    pilot_spend: '',
    contact_id: '',
    entered_at: todayInput(), // start date — backdate for historical accounts
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // Companies already in the pipeline can't take a second deal (one deal per
  // lead, enforced by start_outreach()) — exclude them from search results.
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return leads
      .filter((l) => !l.in_pipeline && l.company_name.toLowerCase().includes(q))
      .slice(0, 8);
  }, [leads, query]);

  function pickLead(lead) {
    setSelectedLead(lead);
    setCreatingNew(false);
    setCompanyOpen(false);
  }

  function pickCreateNew() {
    setSelectedLead(null);
    setCreatingNew(true);
    setCompanyOpen(false);
  }

  function resetCompany() {
    setSelectedLead(null);
    setCreatingNew(false);
    setQuery('');
  }

  async function submit(e) {
    e.preventDefault();
    if (!selectedLead && !creatingNew) return setError('Search for a company or create a new one.');
    if (creatingNew && !query.trim()) return setError('Company name is required.');
    setSaving(true);
    setError(null);
    try {
      let leadId = selectedLead?.id;
      if (!leadId) {
        const created = await api.createLead({
          company_name: query.trim(),
          vertical_id: newVerticalId ? Number(newVerticalId) : undefined,
        });
        leadId = created.id;
        await refreshLeads();
      }
      const result = await api.startLeadOutreach(leadId, {
        owner: form.owner,
        source: form.source,
        channel: form.channel,
        pilot_spend: form.pilot_spend,
        contact_id: form.contact_id,
        entered_at: form.entered_at,
      });
      onCreated?.(result);
      onClose();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <Modal title="Add Deal" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Company">
          {selectedLead || creatingNew ? (
            <div className="flex items-center justify-between border border-hairline px-2.5 py-1.5">
              <span className="text-text-primary text-[13px] truncate">
                {selectedLead ? selectedLead.company_name : `${query.trim()} (new company)`}
              </span>
              <button
                type="button"
                onClick={resetCompany}
                className="text-text-muted hover:text-text-primary text-[12px] shrink-0 ml-2"
              >
                Change
              </button>
            </div>
          ) : (
            <div className="relative">
              <Input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setCompanyOpen(true);
                }}
                onFocus={() => setCompanyOpen(true)}
                placeholder="Search companies…"
                autoFocus
              />
              {companyOpen && query.trim() && (
                <div className="absolute left-0 top-full mt-1 w-full max-h-[240px] overflow-y-auto bg-space border border-hairline z-40">
                  {matches.map((l) => (
                    <button
                      type="button"
                      key={l.id}
                      onMouseDown={() => pickLead(l)}
                      className="w-full text-left px-3 py-2 text-[13px] text-text-primary hover:bg-card-hover"
                    >
                      {l.company_name}
                    </button>
                  ))}
                  <button
                    type="button"
                    onMouseDown={pickCreateNew}
                    className="w-full text-left px-3 py-2 text-[13px] text-signal hover:bg-card-hover border-t border-hairline"
                  >
                    + Create “{query.trim()}” as a new company
                  </button>
                </div>
              )}
            </div>
          )}
        </Field>

        {creatingNew && (
          <Field label="Vertical">
            <Select value={newVerticalId} onChange={(e) => setNewVerticalId(e.target.value)}>
              <option value="">Unsorted</option>
              {verticals.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </Select>
          </Field>
        )}

        <Field label="Point of Contact">
          <ContactSelect value={form.contact_id} onChange={set('contact_id')} />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Owner">
            <Select value={form.owner} onChange={set('owner')}>
              <option value="">Unassigned</option>
              {OWNERS.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </Select>
          </Field>
          <Field label="Source">
            <Select value={form.source} onChange={set('source')}>
              {SOURCES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Channel">
            <Select value={form.channel} onChange={set('channel')}>
              {CHANNELS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </Select>
          </Field>
          <Field label="Pilot Spend (USD)">
            <Input
              type="number"
              min="0"
              value={form.pilot_spend}
              onChange={set('pilot_spend')}
              placeholder="15000"
              className="font-mono"
            />
          </Field>
        </div>

        <Field label="Date Entered (S1)">
          <Input
            type="date"
            value={form.entered_at}
            onChange={set('entered_at')}
            style={{ colorScheme: 'dark' }}
            className="font-mono"
          />
        </Field>

        {error && <div className="text-red-400 text-[12px]">{error}</div>}

        <div className="flex items-center justify-between pt-1">
          <span className="eyebrow text-text-muted">Starts at S1 · Outreach Sent</span>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? 'Saving…' : 'Add Deal'}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
