import { useState } from 'react';
import { api } from '../../lib/api.js';
import { TOUCH_TYPES, TOUCH_OUTCOMES } from '../../lib/stages.js';
import { fmtDate, todayInput } from '../../lib/dates.js';
import { Field, Input, Select, Button, Eyebrow } from '../ui.jsx';

// Touch log with an inline "Add Touch" form. Shared by the Outreach/Meetings
// slide-out (DealDetailPanel.jsx) and the Meetings inline collapsible
// (MeetingRow.jsx).
export default function TouchLog({ deal, onChanged }) {
  const [adding, setAdding] = useState(false);
  const blank = () => ({ touch_type: 'Email', outcome: 'No Response', notes: '', touch_date: todayInput() });
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.addTouch(deal.id, form);
      setForm(blank());
      setAdding(false);
      onChanged();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-5 py-4">
      <div className="flex items-center justify-between mb-3">
        <Eyebrow>Touch Log</Eyebrow>
        <Button variant="ghost" onClick={() => setAdding((a) => !a)}>+ Add Touch</Button>
      </div>

      {adding && (
        <form onSubmit={submit} className="border border-hairline p-3 mb-3 space-y-2">
          <Field label="Date Sent">
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
        {deal.touches.length === 0 ? (
          <div className="text-text-disabled text-[12px]">No touches logged.</div>
        ) : (
          deal.touches.map((t) => (
            <div key={t.id} className="border-b border-hairline pb-2">
              <div className="flex items-center justify-between text-[12px]">
                <span className="flex items-center gap-1.5">
                  <span className="text-text-primary">{t.touch_type}</span>
                  {t.source === 'gmail' && (
                    <span className="eyebrow text-signal/80 border border-signal/30 px-1">Gmail</span>
                  )}
                </span>
                <span className="text-text-muted">{fmtDate(t.touch_date)}</span>
              </div>
              <div className="flex items-center justify-between mt-0.5">
                <span className="eyebrow text-text-secondary">{t.outcome}</span>
              </div>
              {t.notes && <div className="text-[12px] text-text-secondary mt-1">{t.notes}</div>}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
