import { useState } from 'react';
import { api } from '../lib/api.js';
import { Modal } from './Overlay.jsx';
import { Field, Input, TextArea, Select, Button } from './ui.jsx';

const NEW = '__new__';

// Create a company. Vertical can be an existing one or a newly-typed name (the
// server creates it on the fly). HQ / size / status / description are optional.
// asClient — when true, the company is created already flagged is_client (the
// sidebar's "+ New Client" flow); otherwise it's a plain company, same as the
// Companies board's "+ Add Company".
export default function AddLeadModal({ verticals, onClose, onCreated, asClient = false }) {
  const [form, setForm] = useState({
    company_name: '',
    website: '',
    vertical_id: '',
    hq_location: '',
    headcount: '',
    description: '',
  });
  const [newVertical, setNewVertical] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    if (!form.company_name.trim()) return setError('Company name is required.');
    setSaving(true);
    setError(null);
    try {
      const body = {
        company_name: form.company_name.trim(),
        website: form.website.trim() || null,
        hq_location: form.hq_location.trim() || null,
        headcount: form.headcount.trim() || null,
        description: form.description.trim() || null,
        is_client: asClient,
      };
      if (form.vertical_id === NEW) {
        if (!newVertical.trim()) {
          setSaving(false);
          return setError('Enter a name for the new vertical.');
        }
        body.vertical_name = newVertical.trim();
      } else if (form.vertical_id) {
        body.vertical_id = Number(form.vertical_id);
      }
      const created = await api.createLead(body);
      onCreated?.(created);
      onClose();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <Modal title={asClient ? 'Add Client' : 'Add Company'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Company Name">
          <Input value={form.company_name} onChange={set('company_name')} placeholder="Acme Co" autoFocus />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Website">
            <Input value={form.website} onChange={set('website')} placeholder="acme.com" />
          </Field>

          <Field label="Vertical">
            <Select value={form.vertical_id} onChange={set('vertical_id')}>
              <option value="">Unsorted</option>
              {verticals.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
              <option value={NEW}>+ New vertical…</option>
            </Select>
          </Field>
        </div>

        {form.vertical_id === NEW && (
          <Field label="New Vertical Name">
            <Input value={newVertical} onChange={(e) => setNewVertical(e.target.value)} placeholder="Gaming" />
          </Field>
        )}

        <div className="grid grid-cols-2 gap-4">
          <Field label="HQ / Location">
            <Input value={form.hq_location} onChange={set('hq_location')} placeholder="San Francisco, CA" />
          </Field>

          <Field label="Employees / Size">
            <Input value={form.headcount} onChange={set('headcount')} placeholder="51-200" />
          </Field>
        </div>

        <Field label="Description">
          <TextArea value={form.description} onChange={set('description')} placeholder="What the company does, context, fit…" />
        </Field>

        {error && <div className="text-red-400 text-[12px]">{error}</div>}

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? 'Saving…' : asClient ? 'Add Client' : 'Add Company'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
