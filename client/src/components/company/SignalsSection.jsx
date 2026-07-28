import { api } from '../../lib/api.js';
import { Input, Eyebrow } from '../ui.jsx';
import SignalControl from '../SignalControl.jsx';

const isDateValue = (v) => v && !['Yes', 'No', 'Unknown'].includes(v) && !Number.isNaN(Date.parse(v));

// Points earned, shown inline to the right of each signal.
function PointsBadge({ points, maxPoints }) {
  if (maxPoints === 0) {
    return <span className="eyebrow text-text-disabled">Info</span>;
  }
  return (
    <span className={`font-mono text-[12px] ${points > 0 ? 'text-signal' : 'text-text-disabled'}`}>
      +{points}
    </span>
  );
}

// The scoring rubric, grouped by category in configured order — shared by the
// company profile and the deal panel's Company Intel section.
export default function SignalsSection({ lead, config, after }) {
  // Save a signal, always sending both value + notes so neither is wiped.
  function saveSignal(key, patch) {
    const cur = lead.signals[key] ?? {};
    const merged = {
      value: patch.value !== undefined ? patch.value : (cur.value ?? null),
      notes: patch.notes !== undefined ? patch.notes : (cur.notes ?? null),
    };
    after(() => api.setSignal(lead.id, key, merged));
  }

  // Group signals by category in configured order.
  const signalsByCategory = new Map();
  for (const cat of config.categories) signalsByCategory.set(cat, []);
  for (const s of config.signals) {
    if (!signalsByCategory.has(s.category)) signalsByCategory.set(s.category, []);
    signalsByCategory.get(s.category).push(s);
  }

  return (
    <div className="px-5 py-4 border-b border-hairline">
      <Eyebrow className="mb-3">Signals</Eyebrow>
      <div className="space-y-5">
        {config.categories.map((cat) => {
          const sigs = signalsByCategory.get(cat) ?? [];
          if (sigs.length === 0) return null;
          return (
            <div key={cat}>
              <div className="text-text-muted text-[11px] mb-2">{cat}</div>
              <div className="space-y-3">
                {sigs.map((cfg) => {
                  const sig = lead.signals[cfg.signal_key] ?? {};
                  const showNotes =
                    (cfg.has_notes || cfg.has_text) &&
                    (sig.value === 'Yes' || isDateValue(sig.value) || (sig.notes ?? '') !== '');
                  return (
                    <div key={cfg.signal_key}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-text-secondary text-[13px]">{cfg.label}</span>
                        <PointsBadge points={lead.points?.[cfg.signal_key] ?? 0} maxPoints={cfg.max_points} />
                      </div>
                      <SignalControl
                        config={cfg}
                        value={sig.value}
                        onChange={(v) => saveSignal(cfg.signal_key, { value: v })}
                      />
                      {showNotes && (
                        <Input
                          defaultValue={sig.notes ?? ''}
                          onBlur={(e) => saveSignal(cfg.signal_key, { notes: e.target.value || null })}
                          placeholder={cfg.has_text ? 'Name' : 'Notes'}
                          className="mt-1.5"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
