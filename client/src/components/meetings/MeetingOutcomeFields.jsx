import { useState } from 'react';
import { api } from '../../lib/api.js';
import { MEETING_OUTCOMES } from '../../lib/stages.js';
import { Field, Select, TextArea } from '../ui.jsx';

// How a finished meeting went — outcome + free-text notes, autosaving on
// change/blur (same defaultValue+onBlur pattern used elsewhere, e.g.
// PersonDetailPanel.jsx), so there's no separate Save button to miss.
export default function MeetingOutcomeFields({ deal, onChanged }) {
  const [saving, setSaving] = useState(false);

  async function patch(partial) {
    setSaving(true);
    try {
      await api.updateDeal(deal.id, partial);
      onChanged?.();
    } catch (e) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <Field label="Meeting Notes">
        <TextArea
          rows={2}
          defaultValue={deal.meeting_notes ?? ''}
          disabled={saving}
          onBlur={(e) => patch({ meeting_notes: e.target.value })}
          placeholder="What came out of the call…"
        />
      </Field>
      <Field label="Meeting Outcome">
        <Select
          value={deal.meeting_outcome ?? ''}
          disabled={saving}
          onChange={(e) => patch({ meeting_outcome: e.target.value || null })}
        >
          <option value="">—</option>
          {MEETING_OUTCOMES.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </Select>
      </Field>
    </div>
  );
}
