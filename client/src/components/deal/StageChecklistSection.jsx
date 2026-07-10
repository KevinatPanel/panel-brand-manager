import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { Eyebrow } from '../ui.jsx';

// Exit criteria for the deal's CURRENT stage — advisory only for v1: checking
// every criterion never blocks moving the stage manually (see DealView's
// "Move to next" button, unaffected by this section).
export default function StageChecklistSection({ dealId, stageCode }) {
  const [criteria, setCriteria] = useState(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const load = useCallback(() => {
    api.getStageChecklist(dealId, stageCode).then(setCriteria).catch(() => setCriteria([]));
  }, [dealId, stageCode]);

  useEffect(() => {
    load();
  }, [load]);

  async function toggle(criterion) {
    setBusy(true);
    setCriteria((prev) => prev.map((c) => (c.id === criterion.id ? { ...c, checked: !c.checked } : c)));
    try {
      await api.toggleChecklistItem(dealId, criterion.id, !criterion.checked);
    } catch (e) {
      alert(e.message);
      load();
    } finally {
      setBusy(false);
    }
  }

  if (criteria === null) return null;

  const allChecked = criteria.length > 0 && criteria.every((c) => c.checked);

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <Eyebrow>Stage Checklist</Eyebrow>
        {criteria.length > 0 && (
          <span
            className={`eyebrow px-1.5 py-0.5 border ${
              allChecked ? 'text-signal border-signal/40' : 'text-text-muted border-hairline'
            }`}
          >
            {allChecked ? 'Ready to advance' : `${criteria.filter((c) => c.checked).length}/${criteria.length} complete`}
          </span>
        )}
      </div>

      {criteria.length === 0 ? (
        <div className="text-text-disabled text-[12px]">
          No exit criteria configured for this stage.{' '}
          <button
            onClick={() => navigate('/stage-criteria')}
            className="text-text-secondary hover:text-text-primary underline"
          >
            Configure
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {criteria.map((c) => (
            <label key={c.id} className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={c.checked}
                disabled={busy}
                onChange={() => toggle(c)}
                className="accent-signal"
              />
              <span className={`text-[13px] ${c.checked ? 'text-text-disabled line-through' : 'text-text-primary'}`}>
                {c.label}
              </span>
            </label>
          ))}
        </div>
      )}

      <div className="text-[11px] text-text-disabled mt-2">
        Advisory only — does not block moving stages manually.
      </div>
    </section>
  );
}
