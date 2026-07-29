import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import SearchSelect from './SearchSelect.jsx';

const NEW = '__new__';

// Flat, searchable picker of every contact across all companies, labeled
// "Name — Company". A deal points at one person; the list is unscoped
// because a brand-new deal may not have a linked company yet. Self-loading
// so call sites just pass value/onChange (event-shaped, to match the native
// <select> this used to be — SearchSelect itself fires a raw value).
// `onCreateNew`, if passed, adds a "+ New contact…" pinned option above the
// list — picking it calls onCreateNew() instead of onChange, so the caller
// can swap in its own inline create-contact fields.
export default function ContactSelect({ value, onChange, disabled, onCreateNew }) {
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

  const pinnedOptions = [{ value: '', label: '— No contact —' }];
  if (onCreateNew) pinnedOptions.push({ value: NEW, label: '+ New contact…' });

  return (
    <SearchSelect
      value={value ?? ''}
      onChange={(v) => (v === NEW ? onCreateNew() : onChange({ target: { value: v } }))}
      options={contacts.map((c) => ({
        value: c.id,
        label:
          (c.name || c.email || `Contact #${c.id}`) +
          (c.company_name ? ` — ${c.company_name}` : ''),
      }))}
      pinnedOptions={pinnedOptions}
      placeholder="— No contact —"
      disabled={disabled}
    />
  );
}
