import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Modal } from './Overlay.jsx';
import { Field, Input, TextArea, Select, Button } from './ui.jsx';

const NEW = '__new__';

// Add a person. A person belongs to a company (lead_contacts.lead_id is NOT
// NULL), so a company must be chosen. Pick an existing company or type a new
// one — the new company is created on the fly. Profile fields are optional.
export default function AddPersonModal({ onClose, onCreated, defaultLeadId = '' }) {
  const [companies, setCompanies] = useState([]);
  const [form, setForm] = useState({
    // Default to creating a new company; if opened from a company context use
    // that company instead. Either way the user can switch via the dropdown.
    lead_id: defaultLeadId ? String(defaultLeadId) : NEW,
    name: '',
    title: '',
    email: '',
    phone: '',
    linkedin: '',
    location: '',
    seniority: '',
    notes: '',
  });
  const [newCompany, setNewCompany] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .listLeads()
      .then((rows) =>
        setCompanies(
          [...rows].sort((a, b) => (a.company_name ?? '').localeCompare(b.company_name ?? '')),
        ),
      )
      .catch((e) => setError(e.message));
  }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    if (!form.lead_id) return setError('Choose a company.');
    if (form.lead_id === NEW && !newCompany.trim())
      return setError('Enter a name for the new company.');
    if (!form.name.trim()) return setError('Name is required.');
    setSaving(true);
    setError(null);
    try {
      // New company? Create it first, then attach the person to it.
      let leadId = form.lead_id;
      if (leadId === NEW) {
        const company = await api.createLead({ company_name: newCompany.trim() });
        leadId = company.id;
      }
      await api.addContact(Number(leadId), {
        name: form.name.trim(),
        title: form.title.trim() || null,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        linkedin: form.linkedin.trim() || null,
        location: form.location.trim() || null,
        seniority: form.seniority.trim() || null,
        notes: form.notes.trim() || null,
      });
      onCreated?.();
      onClose();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <Modal title="Add Person" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Company">
          <Select value={form.lead_id} onChange={set('lead_id')}>
            <option value="">Select a company…</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.company_name}</option>
            ))}
            <option value={NEW}>+ New company…</option>
          </Select>
        </Field>

        {form.lead_id === NEW && (
          <Field label="New Company Name">
            <Input value={newCompany} onChange={(e) => setNewCompany(e.target.value)} placeholder="Acme Co" />
          </Field>
        )}

        <div className="grid grid-cols-2 gap-4">
          <Field label="Name">
            <Input value={form.name} onChange={set('name')} placeholder="Jane Doe" autoFocus />
          </Field>
          <Field label="Title">
            <Input value={form.title} onChange={set('title')} placeholder="VP Growth" />
          </Field>
          <Field label="Email">
            <Input type="email" value={form.email} onChange={set('email')} placeholder="jane@acme.com" />
          </Field>
          <Field label="Phone">
            <Input value={form.phone} onChange={set('phone')} placeholder="+1 555 123 4567" />
          </Field>
          <Field label="LinkedIn">
            <Input value={form.linkedin} onChange={set('linkedin')} placeholder="linkedin.com/in/…" />
          </Field>
          <Field label="Location">
            <Input value={form.location} onChange={set('location')} placeholder="San Francisco, CA" />
          </Field>
        </div>

        <Field label="Seniority / Dept">
          <Input value={form.seniority} onChange={set('seniority')} placeholder="Director, Marketing" />
        </Field>

        <Field label="Notes / Background">
          <TextArea rows={3} value={form.notes} onChange={set('notes')} placeholder="Who they are, how we know them…" />
        </Field>

        {error && <div className="text-red-400 text-[12px]">{error}</div>}

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? 'Saving…' : 'Add Person'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
