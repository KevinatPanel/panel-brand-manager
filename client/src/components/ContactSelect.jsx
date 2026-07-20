import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import SearchSelect from './SearchSelect.jsx';

// Flat, searchable picker of every contact across all companies, labeled
// "Name — Company". A deal points at one person; the list is unscoped
// because a brand-new deal may not have a linked company yet. Self-loading
// so call sites just pass value/onChange (event-shaped, to match the native
// <select> this used to be — SearchSelect itself fires a raw value).
export default function ContactSelect({ value, onChange, disabled }) {
  const [contacts, setContacts] = useState([]);

  useEffect(() => {
    api
      .listContacts()
      .then((rows) =>
        setContacts(
          [...rows].sort((a, b) =>
            (a.name || a.email || '').localeCompare(b.name || b.email || ''),
          ),
        ),
      )
      .catch(() => {});
  }, []);

  return (
    <SearchSelect
      value={value ?? ''}
      onChange={(v) => onChange({ target: { value: v } })}
      options={contacts.map((c) => ({
        value: c.id,
        label:
          (c.name || c.email || `Contact #${c.id}`) +
          (c.company_name ? ` — ${c.company_name}` : ''),
      }))}
      pinnedOptions={[{ value: '', label: '— No contact —' }]}
      placeholder="— No contact —"
      disabled={disabled}
    />
  );
}
