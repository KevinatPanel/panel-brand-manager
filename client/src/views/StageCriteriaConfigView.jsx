import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { STAGES } from '../lib/stages.js';
import ViewHeader from '../components/ViewHeader.jsx';
import { Button, Eyebrow, Input } from '../components/ui.jsx';

// LOST is terminal — it has no "next stage" to gate criteria for, so it's not
// configurable here.
const CONFIGURABLE_STAGES = STAGES.filter((s) => s.group !== 'terminal');

// Admin/settings area for per-stage exit criteria + the global deal-health
// threshold. Editable by any user for v1 (no permission tiers) — everything
// here autosaves per field/row, unlike ScoringConfigView's explicit "Save"
// button (that pattern exists there because saving triggers an expensive
// rescore-every-lead fan-out; nothing here has an equivalent cost).
export default function StageCriteriaConfigView() {
  const navigate = useNavigate();
  const [criteria, setCriteria] = useState(null);
  const [threshold, setThreshold] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [list, health] = await Promise.all([api.listStageExitCriteria(), api.getHealthConfig()]);
    setCriteria(list);
    setThreshold(String(health.stale_days_threshold));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function after(fn) {
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (criteria === null) return null;

  const byStage = new Map();
  for (const c of criteria) {
    if (!byStage.has(c.stage_code)) byStage.set(c.stage_code, []);
    byStage.get(c.stage_code).push(c);
  }

  return (
    <div>
      <ViewHeader title="Stage Criteria" subtitle="Exit-criteria checklists + deal health threshold — advisory only">
        <Button variant="ghost" onClick={() => navigate('/pipeline')}>← Back to Pipeline</Button>
      </ViewHeader>

      <div className="px-6 py-6 max-w-2xl space-y-8">
        <section>
          <Eyebrow className="mb-3">Deal Health</Eyebrow>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] text-text-secondary">Flag a deal "at risk" after</span>
            <Input
              type="number"
              min="1"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              onBlur={() => after(() => api.saveHealthConfig({ stale_days_threshold: threshold }))}
              className="w-16 font-mono"
            />
            <span className="text-[13px] text-text-secondary">
              days in the same stage with no touch logged.
            </span>
          </div>
        </section>

        {CONFIGURABLE_STAGES.map((stage) => (
          <StageCriteriaEditor
            key={stage.code}
            stage={stage}
            criteria={(byStage.get(stage.code) ?? []).slice().sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)}
            busy={busy}
            after={after}
          />
        ))}
      </div>
    </div>
  );
}

function StageCriteriaEditor({ stage, criteria, busy, after }) {
  const [adding, setAdding] = useState('');

  function move(index, dir) {
    const next = criteria.slice();
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    after(() => api.reorderStageExitCriteria(stage.code, next.map((c) => c.id)));
  }

  function addCriterion(e) {
    e.preventDefault();
    if (!adding.trim()) return;
    after(() => api.addStageExitCriterion(stage.code, adding)).then(() => setAdding(''));
  }

  return (
    <section>
      <div className="mb-2 pb-2 border-b border-hairline">
        <Eyebrow className="text-text-secondary">
          {stage.code} · {stage.label}
        </Eyebrow>
      </div>
      <div className="space-y-1.5 mb-2">
        {criteria.map((c, i) => (
          <div key={c.id} className="flex items-center gap-2">
            <div className="flex flex-col shrink-0">
              <button
                disabled={busy || i === 0}
                onClick={() => move(i, -1)}
                className="text-text-muted hover:text-text-primary disabled:opacity-30 text-[10px] leading-none"
              >
                ▲
              </button>
              <button
                disabled={busy || i === criteria.length - 1}
                onClick={() => move(i, 1)}
                className="text-text-muted hover:text-text-primary disabled:opacity-30 text-[10px] leading-none"
              >
                ▼
              </button>
            </div>
            <input
              defaultValue={c.label}
              disabled={busy}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== c.label) after(() => api.updateStageExitCriterion(c.id, { label: v }));
              }}
              className="flex-1 bg-space border border-hairline px-2 py-1.5 text-[13px] text-text-primary outline-none focus:border-signal/60"
            />
            <Button variant="ghost" disabled={busy} onClick={() => after(() => api.deleteStageExitCriterion(c.id))}>
              Remove
            </Button>
          </div>
        ))}
      </div>
      <form onSubmit={addCriterion} className="flex items-center gap-2">
        <input
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          placeholder="Add criterion…"
          disabled={busy}
          className="flex-1 bg-space border border-hairline px-2 py-1.5 text-[13px] text-text-primary placeholder:text-text-disabled outline-none focus:border-signal/60"
        />
        <Button type="submit" variant="ghost" disabled={busy || !adding.trim()}>Add</Button>
      </form>
    </section>
  );
}
