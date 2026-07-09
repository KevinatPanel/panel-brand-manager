import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import ViewHeader from '../components/ViewHeader.jsx';
import { Button, Eyebrow } from '../components/ui.jsx';

// Small numeric cell used throughout the editor.
function Num({ value, onChange, className = '', width = 'w-20' }) {
  return (
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`${width} bg-space border border-hairline px-2 py-1 font-mono text-[13px] text-text-primary outline-none focus:border-signal/60 ${className}`}
    />
  );
}

// Scoring Config — the ONLY place point values can be changed. Signal keys and
// labels are structural and read-only. Saving rescores every lead.
export default function ScoringConfigView() {
  const navigate = useNavigate();
  const [categories, setCategories] = useState([]);
  const [signals, setSignals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .getScoringConfig()
      .then((cfg) => {
        setCategories(cfg.categories);
        // Deep clone so edits don't mutate the fetched data.
        setSignals(JSON.parse(JSON.stringify(cfg.signals)));
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // Immutable update of a signal by index.
  const editSignal = (idx, updater) =>
    setSignals((prev) => prev.map((s, i) => (i === idx ? updater({ ...s }) : s)));

  const num = (v) => (v === '' || v == null ? 0 : Number(v));

  // For toggles, "Yes points" drives both the Yes option AND max_points.
  function setYesPoints(idx, val) {
    editSignal(idx, (s) => {
      const opts = (s.options ?? []).map((o) => (o.value === 'Yes' ? { ...o, points: num(val) } : o));
      return { ...s, options: opts, max_points: num(val) };
    });
  }
  function setMax(idx, val) {
    editSignal(idx, (s) => ({ ...s, max_points: num(val) }));
  }
  function setOptionPoints(idx, optIdx, val) {
    editSignal(idx, (s) => ({
      ...s,
      options: s.options.map((o, i) => (i === optIdx ? { ...o, points: num(val) } : o)),
    }));
  }
  function setRangeField(idx, optIdx, field, val) {
    editSignal(idx, (s) => ({
      ...s,
      options: s.options.map((o, i) => (i === optIdx ? { ...o, [field]: num(val) } : o)),
    }));
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const updates = signals.map((s) => ({
        signal_key: s.signal_key,
        max_points: s.max_points,
        options: s.options,
      }));
      const res = await api.saveScoringConfig(updates);
      setMessage(`Config saved. ${res.rescored} lead${res.rescored === 1 ? '' : 's'} rescored.`);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <ViewHeader title="Scoring Config" subtitle="Edit point values — saving rescores every lead">
        <Button variant="ghost" onClick={() => navigate('/leads')}>← Back to Leads</Button>
        <Button variant="primary" onClick={save} disabled={saving || loading}>
          {saving ? 'Saving…' : 'Save Config'}
        </Button>
      </ViewHeader>

      {message && (
        <div className="mx-6 mt-4 border border-signal/40 text-signal text-[13px] px-4 py-2">{message}</div>
      )}
      {error && (
        <div className="mx-6 mt-4 border border-red-500/40 text-red-400 text-[13px] px-4 py-2">{error}</div>
      )}

      {loading ? (
        <div className="px-6 py-10 text-text-secondary text-[13px]">Loading…</div>
      ) : (
        <div className="px-6 py-6 max-w-3xl space-y-8">
          {categories.map((cat) => {
            const catSignals = signals
              .map((s, idx) => ({ s, idx }))
              .filter(({ s }) => s.category === cat);
            const catMax = catSignals.reduce((sum, { s }) => sum + (s.max_points || 0), 0);
            return (
              <section key={cat}>
                <div className="flex items-center justify-between mb-3 pb-2 border-b border-hairline">
                  <Eyebrow className="text-text-secondary">{cat}</Eyebrow>
                  <span className="font-mono text-text-muted text-[12px]">{catMax} pts max</span>
                </div>
                <div className="space-y-5">
                  {catSignals.map(({ s, idx }) => (
                    <SignalEditor
                      key={s.signal_key}
                      s={s}
                      idx={idx}
                      setMax={setMax}
                      setYesPoints={setYesPoints}
                      setOptionPoints={setOptionPoints}
                      setRangeField={setRangeField}
                      Num={Num}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

// One signal's editor, branching on input_type.
function SignalEditor({ s, idx, setMax, setYesPoints, setOptionPoints, setRangeField, Num }) {
  const yesOpt = (s.options ?? []).find((o) => o.value === 'Yes');

  return (
    <div className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-2 items-start">
      <div className="text-text-primary text-[13px] pt-1">{s.label}</div>

      {/* Right column: max points (except toggles, which use Yes points). */}
      <div className="flex items-center gap-2 justify-end">
        {s.input_type === 'toggle' ? (
          <>
            <span className="eyebrow text-text-muted">Yes</span>
            <Num value={yesOpt?.points ?? 0} onChange={(v) => setYesPoints(idx, v)} width="w-16" />
          </>
        ) : s.input_type === 'text' ? (
          <span className="eyebrow text-text-disabled">Informational</span>
        ) : (
          <>
            <span className="eyebrow text-text-muted">Max</span>
            <Num value={s.max_points} onChange={(v) => setMax(idx, v)} width="w-16" />
          </>
        )}
      </div>

      {/* Detail rows span both columns. */}
      {s.input_type === 'select' && (
        <div className="col-span-2 grid grid-cols-2 gap-x-8 gap-y-1.5 pl-4 mt-1">
          {s.options.map((o, optIdx) => (
            <div key={o.value} className="flex items-center justify-between gap-2">
              <span className="text-text-secondary text-[12px]">{o.label}</span>
              <Num value={o.points} onChange={(v) => setOptionPoints(idx, optIdx, v)} width="w-14" />
            </div>
          ))}
        </div>
      )}

      {s.input_type === 'number' && (
        <div className="col-span-2 pl-4 mt-1 space-y-1.5">
          <div className="grid grid-cols-[1fr_1fr_auto] gap-3 eyebrow text-text-disabled">
            <span>Min $</span>
            <span>Max $</span>
            <span>Pts</span>
          </div>
          {s.options.map((r, optIdx) => (
            <div key={optIdx} className="grid grid-cols-[1fr_1fr_auto] gap-3 items-center">
              <Num value={r.min} onChange={(v) => setRangeField(idx, optIdx, 'min', v)} width="w-full" />
              <Num value={r.max} onChange={(v) => setRangeField(idx, optIdx, 'max', v)} width="w-full" />
              <Num value={r.points} onChange={(v) => setRangeField(idx, optIdx, 'points', v)} width="w-14" />
            </div>
          ))}
          <div className="text-text-disabled text-[11px]">Values outside every range score 0.</div>
        </div>
      )}

      {s.input_type === 'derived' && (
        <div className="col-span-2 grid grid-cols-2 gap-x-8 gap-y-1.5 pl-4 mt-1">
          {s.options.map((t, optIdx) => (
            <div key={optIdx} className="flex items-center justify-between gap-2">
              <span className="text-text-secondary text-[12px]">≥ {t.min} contact{t.min === 1 ? '' : 's'}</span>
              <Num value={t.points} onChange={(v) => setOptionPoints(idx, optIdx, v)} width="w-14" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
