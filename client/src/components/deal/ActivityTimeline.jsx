import { useEffect, useState, useCallback } from 'react';
import { api } from '../../lib/api.js';
import { STAGE_LABELS, TOUCH_TYPES, TOUCH_OUTCOMES } from '../../lib/stages.js';
import { Eyebrow, Button, Input, Select } from '../ui.jsx';
import { fmtDate, todayInput } from '../../lib/dates.js';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'stage', label: 'Stage changes' },
  { key: 'touch', label: 'Touches' },
  { key: 'note', label: 'Notes' },
  { key: 'task', label: 'Tasks' },
  { key: 'file', label: 'Files' },
];

const KIND_META = {
  stage: { tag: 'Stage' },
  touch: { tag: 'Touch' },
  note: { tag: 'Note' },
  task: { tag: 'Task done' },
  file: { tag: 'File' },
};

// Merged reverse-chronological feed (stage changes, touches, notes, task
// completions, attachment uploads) — structural twin of the existing
// getCompanyActivity() feed in api.js, applied to a deal instead of a company.
export default function ActivityTimeline({ dealId }) {
  const [items, setItems] = useState(null);
  const [stakeholders, setStakeholders] = useState([]);
  const [filter, setFilter] = useState('all');
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.getDealActivity(dealId).then(setItems).catch(() => setItems([]));
    api.listStakeholders(dealId).then(setStakeholders).catch(() => {});
  }, [dealId]);

  useEffect(() => {
    load();
  }, [load]);

  if (items === null) return null;

  const visible = filter === 'all' ? items : items.filter((i) => i.kind === filter);

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <Eyebrow>Activity</Eyebrow>
        <Button variant="ghost" onClick={() => setAdding((a) => !a)}>+ Add Touch</Button>
      </div>

      <div className="flex items-center gap-1 mb-3 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`eyebrow px-2 py-1 border transition-colors ${
              filter === f.key
                ? 'border-signal/40 text-signal'
                : 'border-hairline text-text-muted hover:text-text-primary'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {adding && (
        <AddTouchForm
          dealId={dealId}
          stakeholders={stakeholders}
          busy={busy}
          setBusy={setBusy}
          onDone={() => {
            setAdding(false);
            load();
          }}
          onCancel={() => setAdding(false)}
        />
      )}

      {visible.length === 0 ? (
        <div className="text-text-disabled text-[12px]">Nothing here yet.</div>
      ) : (
        <div className="space-y-2">
          {visible.map((item) => (
            <TimelineRow key={item.id} item={item} />
          ))}
        </div>
      )}
    </section>
  );
}

function TimelineRow({ item }) {
  const meta = KIND_META[item.kind] ?? { tag: item.kind };
  return (
    <div className="flex items-start justify-between gap-3 border-b border-hairline pb-2">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="eyebrow border border-hairline px-1.5 py-0.5 text-text-secondary shrink-0">
            {meta.tag}
          </span>
          <span className="text-[13px] text-text-primary truncate">
            {item.kind === 'stage' && `Moved to ${STAGE_LABELS[item.stage] ?? item.stage}`}
            {item.kind === 'touch' &&
              `${item.touch_type}${item.stakeholder_name ? ` with ${item.stakeholder_name}` : ''} — ${item.outcome}`}
            {item.kind === 'note' && (item.content_text?.slice(0, 140) || '(empty note)')}
            {item.kind === 'task' && `${item.title} completed`}
            {item.kind === 'file' && `${item.filename} uploaded`}
          </span>
        </div>
        {item.kind === 'touch' && item.notes && (
          <div className="text-[12px] text-text-secondary mt-0.5">{item.notes}</div>
        )}
      </div>
      <span className="text-[11px] text-text-muted shrink-0">{fmtDate(item.date)}</span>
    </div>
  );
}

function AddTouchForm({ dealId, stakeholders, busy, setBusy, onDone, onCancel }) {
  const [form, setForm] = useState({
    touch_type: 'Email',
    outcome: 'No Response',
    notes: '',
    touch_date: todayInput(),
    stakeholder_id: '',
  });

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.addTouch(dealId, { ...form, stakeholder_id: form.stakeholder_id || null });
      onDone();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="border border-hairline p-3 mb-3 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Input
          type="date"
          value={form.touch_date}
          onChange={(e) => setForm({ ...form, touch_date: e.target.value })}
          style={{ colorScheme: 'dark' }}
          className="font-mono"
        />
        <Select value={form.stakeholder_id} onChange={(e) => setForm({ ...form, stakeholder_id: e.target.value })}>
          <option value="">No stakeholder tagged</option>
          {stakeholders.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Select value={form.touch_type} onChange={(e) => setForm({ ...form, touch_type: e.target.value })}>
          {TOUCH_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </Select>
        <Select value={form.outcome} onChange={(e) => setForm({ ...form, outcome: e.target.value })}>
          {TOUCH_OUTCOMES.map((o) => <option key={o} value={o}>{o}</option>)}
        </Select>
      </div>
      <Input
        value={form.notes}
        onChange={(e) => setForm({ ...form, notes: e.target.value })}
        placeholder="Notes (optional)"
      />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={busy}>Log Touch</Button>
      </div>
    </form>
  );
}
