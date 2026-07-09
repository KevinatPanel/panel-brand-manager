import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Select } from './ui.jsx';

// Flat picker of every contact across all companies, labeled "Name — Company".
// A deal points at one person; the list is unscoped because a brand-new deal may
// not have a linked company yet. Self-loading so call sites just pass value/onChange.
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
    <Select value={value ?? ''} onChange={onChange} disabled={disabled}>
      <option value="">— No contact —</option>
      {contacts.map((c) => (
        <option key={c.id} value={c.id}>
          {(c.name || c.email || `Contact #${c.id}`) +
            (c.company_name ? ` — ${c.company_name}` : '')}
        </option>
      ))}
    </Select>
  );
}
