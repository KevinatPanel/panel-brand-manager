import { useCallback, useEffect, useState } from 'react';
import { Eyebrow, Select, Input } from '../ui.jsx';
import { playbook } from '../../lib/playbookApi.js';
import {
  AD_SPEND_OPTIONS,
  EMPLOYEE_OPTIONS,
  FUNDING_OPTIONS,
  MODE_GUIDE,
  VERTICAL_OPTIONS,
  classifyBrand,
  qualifierInputs,
} from '../../lib/qualifier.js';

const MODE_TONE = {
  hyper: 'bg-signal text-space border-signal',
  efficient: 'text-signal border-signal/50',
  unclear: 'text-text-secondary border-hairline',
  early: 'text-text-muted border-hairline',
};

// The mode as a small labeled chip (Companies list, deal panel, prep sheet).
export function QualifierChip({ result, className = '' }) {
  if (!result) return null;
  return (
    <span
      title={result.reasons.join(' · ')}
      className={`inline-block border px-1.5 py-0.5 eyebrow whitespace-nowrap ${MODE_TONE[result.mode]} ${className}`}
    >
      {result.label}
    </span>
  );
}

const FIELDS = [
  { key: 'funding_stage', label: 'Latest funding', options: FUNDING_OPTIONS },
  { key: 'funding_date', label: 'Funding date', date: true },
  { key: 'employees', label: 'Headcount', options: EMPLOYEE_OPTIONS },
  { key: 'vertical_key', label: 'Vertical', options: VERTICAL_OPTIONS },
  { key: 'ad_spend', label: 'Monthly paid media', options: AD_SPEND_OPTIONS },
];

// Pre-call qualifier on the company profile: the classification, why, how to
// lead the call, and the inputs (Apollo-filled, each overridable).
export default function QualifierSection({ lead, adCheck }) {
  const [manual, setManual] = useState(null);
  const [guide, setGuide] = useState({});
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    playbook.getQualifier(lead.id).then((r) => setManual(r ?? {})).catch((e) => setError(e.message));
  }, [lead.id]);
  useEffect(() => {
    load();
    playbook.listPlaybook('qualifier').then(setGuide).catch(() => {});
  }, [load]);

  if (!manual) return null;
  const inputs = qualifierInputs(lead, manual);
  const result = classifyBrand(inputs, new Date(), adCheck);

  async function save(key, value) {
    setManual((m) => ({ ...m, [key]: value || null }));
    try {
      await playbook.saveQualifier(lead.id, { [key]: value || null });
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <section className="px-5 py-4 border-t border-hairline">
      <div className="flex items-center justify-between mb-3">
        <Eyebrow>Pre-call qualifier</Eyebrow>
        <QualifierChip result={result} />
      </div>

      {result ? (
        <div className="mb-4 space-y-2">
          <p className="text-text-primary text-[13px]">{guide[result.mode]?.body ?? MODE_GUIDE[result.mode]}</p>
          <ul className="space-y-0.5">
            {result.reasons.map((r) => (
              <li key={r} className="text-text-secondary text-[12px]">· {r}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mb-4 text-text-muted text-[12px]">
          Add the funding stage, or any two fields, for a read. Enriching from Apollo fills most of these.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        {FIELDS.map((f) => {
          const cur = inputs[f.key];
          return (
            <label key={f.key} className="block">
              <span className="eyebrow text-text-muted flex items-center gap-1.5 mb-1">
                {f.label}
                {cur.source === 'apollo' && <span className="text-text-disabled normal-case tracking-normal">from Apollo</span>}
              </span>
              {f.date ? (
                <Input
                  type="date"
                  key={`${lead.id}-${cur.value}`}
                  defaultValue={cur.value ?? ''}
                  onBlur={(e) => e.target.value !== (manual[f.key] ?? '') && save(f.key, e.target.value)}
                />
              ) : (
                <Select value={manual[f.key] ?? ''} onChange={(e) => save(f.key, e.target.value)}>
                  <option value="">{cur.source === 'apollo' ? `Auto: ${f.options.find(([k]) => k === cur.value)?.[1] ?? '—'}` : 'Select'}</option>
                  {f.options.map(([k, l]) => (
                    <option key={k} value={k}>{l}</option>
                  ))}
                </Select>
              )}
            </label>
          );
        })}
      </div>
      {error && <div className="mt-2 text-red-400 text-[12px]">{error}</div>}
    </section>
  );
}
