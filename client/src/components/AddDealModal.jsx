import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { OWNERS, SOURCES, CHANNELS } from '../lib/stages.js';
import { todayInput } from '../lib/dates.js';
import { Modal } from './Overlay.jsx';
import { Field, Input, Select, Button } from './ui.jsx';
import ContactSelect from './ContactSelect.jsx';

// Create a new deal. Used in two modes:
//   - "deal" (default): enters the sales cycle at S1
//   - "lead": a prospecting target at P1 (from the Leads view)
export default function AddDealModal({ mode = 'deal', onClose, onCreated }) {
  const isLead = mode === 'lead';
  const [form, setForm] = useState({
    brand_name: '',
    vertical: '',
    owner: '',
    source: 'Outbound',
    channel: 'Email',
    pilot_spend: '',
    contact_id: '',
    intent_notes: '',
    entered_at: todayInput(), // start date — backdate for historical accounts
  });
  const [verticals, setVerticals] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.listVerticals().then(setVerticals).catch(() => {});
  }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    if (!form.brand_name.trim()) return setError('Brand name is required.');
    setSaving(true);
    setError(null);
    try {
      const created = await api.createDeal({
        ...form,
        current_stage: isLead ? 'P1' : 'S1',
        pilot_spend: form.pilot_spend === '' ? null : Number(form.pilot_spend),
      });
      onCreated?.(created);
      onClose();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <Modal title={isLead ? 'Add Lead' : 'Add Deal'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Brand Name">
          <Input value={form.brand_name} onChange={set('brand_name')} placeholder="Acme Co" autoFocus />
        </Field>

        <Field label="Point of Contact">
          <ContactSelect value={form.contact_id} onChange={set('contact_id')} />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Vertical">
            <Select value={form.vertical} onChange={set('vertical')}>
              <option value="">Unsorted</option>
              {verticals.map((v) => (
                <option key={v.id} value={v.name}>{v.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Owner">
            <Select value={form.owner} onChange={set('owner')}>
              <option value="">Unassigned</option>
              {OWNERS.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Source">
            <Select value={form.source} onChange={set('source')}>
              {SOURCES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </Select>
          </Field>
          <Field label="Channel">
            <Select value={form.channel} onChange={set('channel')}>
              {CHANNELS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </Select>
          </Field>
        </div>

        {isLead ? (
          <Field label="Intent Notes">
            <Input value={form.intent_notes} onChange={set('intent_notes')} placeholder="Why now?" />
          </Field>
        ) : (
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
        )}

        <Field label={isLead ? 'Date Added' : 'Date Entered (S1)'}>
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
          <span className="eyebrow text-text-muted">
            Starts at {isLead ? 'P1 · Target' : 'S1 · Outreach Sent'}
          </span>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? 'Saving…' : isLead ? 'Add Lead' : 'Add Deal'}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
