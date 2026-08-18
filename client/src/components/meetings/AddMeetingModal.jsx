import { useMemo, useState } from 'react';
import { api } from '../../lib/api.js';
import { useDeals } from '../../state/DealsContext.jsx';
import { OUTREACH_STAGES, STAGE_LABELS } from '../../lib/stages.js';
import { todayInput } from '../../lib/dates.js';
import { Modal } from '../Overlay.jsx';
import { Field, Input, Button } from '../ui.jsx';
import SearchSelect from '../SearchSelect.jsx';
import { DealCreateForm } from '../AddDealModal.jsx';

// "+ Add Meeting" on the Meetings page covers two distinct cases: a meeting
// for a deal already tracked in Outreach (just move it to S4), and a meeting
// that was never tracked at all (create the deal directly at S4).
export default function AddMeetingModal({ onClose, onCreated }) {
  const [mode, setMode] = useState('new'); // 'new' | 'convert'

  return (
    <Modal title="Add Meeting" onClose={onClose}>
      <div className="flex gap-2 mb-4">
        <Button
          type="button"
          variant={mode === 'new' ? 'primary' : 'ghost'}
          onClick={() => setMode('new')}
        >
          Log new meeting
        </Button>
        <Button
          type="button"
          variant={mode === 'convert' ? 'primary' : 'ghost'}
          onClick={() => setMode('convert')}
        >
          Convert existing deal
        </Button>
      </div>

      {mode === 'new' ? (
        <DealCreateForm stage="S4" submitLabel="Log Meeting" onClose={onClose} onCreated={onCreated} />
      ) : (
        <ConvertDealForm onClose={onClose} onCreated={onCreated} />
      )}
    </Modal>
  );
}

// Moves a deal already sitting in Outreach (S1-S3) straight to S4 — no new
// SQL needed, api.setStage() already jumps a deal to any stage with no
// ordering validation (it's how Kanban drag-and-drop works).
function ConvertDealForm({ onClose, onCreated }) {
  const { deals } = useDeals();
  const [dealId, setDealId] = useState('');
  const [meetingDate, setMeetingDate] = useState(todayInput());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const options = useMemo(
    () =>
      deals
        .filter((d) => OUTREACH_STAGES.includes(d.current_stage))
        .sort((a, b) => a.company_name.localeCompare(b.company_name))
        .map((d) => ({
          value: d.id,
          label: `${d.company_name} (${STAGE_LABELS[d.current_stage]})`,
        })),
    [deals],
  );

  async function submit(e) {
    e.preventDefault();
    if (!dealId) return setError('Select a deal to convert.');
    setSaving(true);
    setError(null);
    try {
      const result = await api.setStage(Number(dealId), 'S4', meetingDate);
      onCreated?.(result);
      onClose();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Deal">
        <SearchSelect
          value={dealId}
          onChange={setDealId}
          options={options}
          placeholder="Search pipeline deals…"
          emptyText="No deals in the pipeline"
        />
      </Field>

      <Field label="Meeting Date">
        <Input
          type="date"
          value={meetingDate}
          onChange={(e) => setMeetingDate(e.target.value)}
          style={{ colorScheme: 'dark' }}
          className="font-mono"
        />
      </Field>

      {error && <div className="text-red-400 text-[12px]">{error}</div>}

      <div className="flex items-center justify-between pt-1">
        <span className="eyebrow text-text-muted">Moves straight to S4 · {STAGE_LABELS.S4}</span>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? 'Saving…' : 'Log Meeting'}
          </Button>
        </div>
      </div>
    </form>
  );
}
