import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { STAGE_LABELS, FUNNEL_STAGES } from '../../lib/stages.js';
import { Button } from '../ui.jsx';

// One page inside the Outreach Settings dialog: editable per-stage weight
// (0-100%) used to compute the Outreach board's weighted pipeline value
// (deal_size * weight). Load/edit/save shape mirrors ScoringConfigView.
export default function StageWeightsSection() {
  const [weights, setWeights] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .listStageWeights()
      .then((rows) => {
        const byCode = new Map(rows.map((r) => [r.stage_code, r]));
        setWeights(FUNNEL_STAGES.map((code) => byCode.get(code) ?? { stage_code: code, weight: 0 }));
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const setWeight = (code, pct) =>
    setWeights((prev) =>
      prev.map((w) =>
        w.stage_code === code ? { ...w, weight: Math.min(1, Math.max(0, Number(pct) / 100)) } : w,
      ),
    );

  async function save() {
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      await Promise.all(weights.map((w) => api.updateStageWeight(w.stage_code, w.weight)));
      setMessage('Stage weights saved.');
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-3">
        <div className="text-text-secondary text-[12px]">
          % of deal size counted toward weighted pipeline value
        </div>
        <Button variant="primary" onClick={save} disabled={saving || loading}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>

      {message && (
        <div className="mb-3 border border-signal/40 text-signal text-[13px] px-3 py-1.5">{message}</div>
      )}
      {error && (
        <div className="mb-3 border border-red-500/40 text-red-400 text-[13px] px-3 py-1.5">{error}</div>
      )}

      {loading ? (
        <div className="text-text-secondary text-[13px] py-6">Loading…</div>
      ) : (
        <div className="space-y-3">
          {weights.map((w) => (
            <div key={w.stage_code} className="flex items-center justify-between gap-4">
              <div className="text-text-primary text-[13px]">
                {w.stage_code} · {STAGE_LABELS[w.stage_code]}
              </div>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={Math.round(w.weight * 100)}
                  onChange={(e) => setWeight(w.stage_code, e.target.value)}
                  className="w-16 bg-space border border-hairline px-2 py-1 font-mono text-[13px] text-text-primary text-right outline-none focus:border-signal/60"
                />
                <span className="text-text-muted text-[12px]">%</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
