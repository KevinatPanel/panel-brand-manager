import { useEffect, useState, useCallback } from 'react';
import { api } from '../../lib/api.js';
import { STAKEHOLDER_ROLES } from '../../lib/stages.js';
import { Eyebrow, Input, Select, Button } from '../ui.jsx';
import { fmtDate } from '../../lib/dates.js';

// Self-fetching, like the slide-out's TouchLog/Meetings sub-components — this
// section loads and refreshes its own data rather than riding on getDeal()'s
// payload, so the full page's sections can be added independently.
export default function StakeholdersSection({ dealId }) {
  const [stakeholders, setStakeholders] = useState(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.listStakeholders(dealId).then(setStakeholders).catch(() => setStakeholders([]));
  }, [dealId]);

  useEffect(() => {
    load();
  }, [load]);

  async function after(fn) {
    setBusy(true);
    try {
      await fn();
      load();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (stakeholders === null) return null;

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <Eyebrow>Stakeholders</Eyebrow>
        <Button variant="ghost" onClick={() => setAdding((a) => !a)}>+ Add Stakeholder</Button>
      </div>

      {adding && (
        <StakeholderForm
          busy={busy}
          onCancel={() => setAdding(false)}
          onSubmit={(body) => after(() => api.addStakeholder(dealId, body)).then(() => setAdding(false))}
        />
      )}

      {stakeholders.length === 0 && !adding ? (
        <div className="text-text-disabled text-[12px]">No stakeholders yet.</div>
      ) : (
        <div className="space-y-2">
          {stakeholders.map((s) => (
            <StakeholderRow
              key={s.id}
              stakeholder={s}
              busy={busy}
              onSetPrimary={() => after(() => api.setPrimaryStakeholder(dealId, s.id))}
              onSave={(body) => after(() => api.updateStakeholder(dealId, s.id, body))}
              onRemove={() => after(() => api.deleteStakeholder(dealId, s.id))}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function StakeholderForm({ initial, busy, onCancel, onSubmit }) {
  const [form, setForm] = useState(
    initial ? { name: initial.name, role: initial.role, email: initial.email ?? '', linkedin: initial.linkedin ?? '' }
      : { name: '', role: 'Other', email: '', linkedin: '' },
  );
  return (
    <div className="border border-hairline p-3 mb-3 space-y-2">
      <Input
        value={form.name}
        onChange={(e) => setForm({ ...form, name: e.target.value })}
        placeholder="Name"
        autoFocus
      />
      <div className="grid grid-cols-2 gap-2">
        <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
          {STAKEHOLDER_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </Select>
        <Input
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          placeholder="Email (optional)"
        />
      </div>
      <Input
        value={form.linkedin}
        onChange={(e) => setForm({ ...form, linkedin: e.target.value })}
        placeholder="LinkedIn URL (optional)"
      />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button variant="primary" disabled={busy || !form.name.trim()} onClick={() => onSubmit(form)}>
          Save
        </Button>
      </div>
    </div>
  );
}

function StakeholderRow({ stakeholder, busy, onSetPrimary, onSave, onRemove }) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <StakeholderForm
        initial={stakeholder}
        busy={busy}
        onCancel={() => setEditing(false)}
        onSubmit={(body) => onSave(body).then(() => setEditing(false))}
      />
    );
  }

  return (
    <div className="flex items-start justify-between gap-2 border-b border-hairline pb-2">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-text-primary text-[13px]">{stakeholder.name}</span>
          <span className="eyebrow text-text-secondary border border-hairline px-1.5 py-0.5">
            {stakeholder.role}
          </span>
          {stakeholder.is_primary && (
            <span className="eyebrow text-signal border border-signal/40 px-1.5 py-0.5">Primary</span>
          )}
        </div>
        <div className="text-[12px] text-text-secondary mt-0.5 truncate">
          {[stakeholder.email, stakeholder.linkedin].filter(Boolean).join(' · ') || '—'}
        </div>
        <div className="text-[11px] text-text-muted mt-0.5">
          Last touched: {stakeholder.last_touched ? fmtDate(stakeholder.last_touched) : 'never'}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {!stakeholder.is_primary && (
          <Button variant="ghost" disabled={busy} onClick={onSetPrimary}>Set primary</Button>
        )}
        <Button variant="ghost" disabled={busy} onClick={() => setEditing(true)}>Edit</Button>
        <Button variant="ghost" disabled={busy} onClick={onRemove}>Remove</Button>
      </div>
    </div>
  );
}
