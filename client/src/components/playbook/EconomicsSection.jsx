import { useCallback, useEffect, useState } from 'react';
import { Eyebrow, Input } from '../ui.jsx';
import { playbook } from '../../lib/playbookApi.js';
import { dealEconomics, profitOf } from '../../lib/economics.js';
import { useEconomics } from '../../lib/useEconomics.js';
import { money, wholeMoney, ZoneChip, ZoneMeter } from './Zone.jsx';

// The Deal Economics card: the offer's numbers in, the eCPM zone, a valid
// bid range and a reverse-engineered fair payout out. A dead-zone offer is
// flagged before anyone pitches it. Inputs save on blur.
const FIELDS = [
  { key: 'payable_event', label: 'Payable event', placeholder: 'signup, install, first deposit…', type: 'text' },
  { key: 'cpa', label: 'Payout per event ($)', placeholder: '35', type: 'number' },
  { key: 'conv_per_1k', label: 'Events per 1,000 views', placeholder: '0.5', type: 'number' },
  { key: 'brand_cac', label: 'Brand’s CAC today ($)', placeholder: '120', type: 'number' },
];
const REVERSE_FIELDS = [
  { key: 'user_value', label: 'Value of a converted user ($)', placeholder: '100', type: 'number' },
  { key: 'reach_rate', label: '% who reach that step', placeholder: '10', type: 'number' },
];

export default function EconomicsSection({ deal, onChange }) {
  const settings = useEconomics();
  const [row, setRow] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    playbook.getDealEconomics(deal.id).then((r) => setRow(r ?? {})).catch((e) => setError(e.message));
  }, [deal.id]);
  useEffect(() => {
    load();
  }, [load]);

  async function save(key, raw) {
    const value = raw === '' ? null : raw;
    if ((row?.[key] ?? null) == value) return;
    setRow((r) => ({ ...r, [key]: value }));
    try {
      await playbook.saveDealEconomics(deal.id, { [key]: value });
      setError(null);
      onChange?.();
    } catch (e) {
      setError(e.message);
    }
  }

  if (!row) return null;
  const e = dealEconomics(row, settings);
  const profit = profitOf(deal.deal_size, settings);

  const input = (f) => (
    <label key={f.key} className="block">
      <span className="eyebrow text-text-muted block mb-1">{f.label}</span>
      <Input
        key={`${deal.id}-${f.key}`}
        type={f.type}
        step="any"
        defaultValue={row[f.key] ?? ''}
        placeholder={f.placeholder}
        onBlur={(ev) => save(f.key, ev.target.value.trim())}
      />
    </label>
  );

  return (
    <section className="px-5 py-4 border-b border-hairline">
      <div className="flex items-center justify-between mb-3">
        <Eyebrow>Deal economics</Eyebrow>
        <ZoneChip zone={e.zone} />
      </div>

      <div className="grid grid-cols-2 gap-3">{FIELDS.map(input)}</div>

      <div className="mt-4">
        <div className="flex items-baseline justify-between mb-1.5">
          <span className="text-text-secondary text-[12px]">Creator eCPM</span>
          <span className="font-mono text-text-primary text-[15px]">{money(e.ecpm)}</span>
        </div>
        <ZoneMeter ecpm={e.ecpm} settings={settings} />
        {e.zone === 'dead' && (
          <p className="mt-2 text-red-400 text-[12px]">
            Dead zone: creators earn under ${settings.dead_below} per 1,000 views here and will pass on it.
            Raise the payout or move the event up the funnel before pitching this.
          </p>
        )}
        {e.ecpm == null && (
          <p className="mt-2 text-text-muted text-[12px]">Add the payout and events per 1,000 views to see the zone.</p>
        )}
      </div>

      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12px]">
        <dt className="text-text-muted">Valid bid range</dt>
        <dd className="text-text-primary font-mono">
          {money(e.range.floor, 0)} to {e.range.ceiling != null ? money(e.range.ceiling) : 'the brand’s CAC'}
          {e.bidStatus === 'below_floor' && <span className="text-red-400 font-sans"> · payout is below the creator floor</span>}
          {e.bidStatus === 'above_cac' && <span className="text-red-400 font-sans"> · payout is above their CAC, they lose money per user</span>}
        </dd>
        <dt className="text-text-muted">Panel profit at deal size</dt>
        <dd className="text-text-primary font-mono">
          {wholeMoney(profit.profit)} <span className="text-text-muted font-sans">on {wholeMoney(profit.spend)} spend</span>
        </dd>
      </dl>

      <details className="mt-4 group">
        <summary className="cursor-pointer text-text-secondary hover:text-text-primary text-[12px] select-none">
          Reverse-engineer a fair payout
        </summary>
        <div className="mt-3 grid grid-cols-2 gap-3">{REVERSE_FIELDS.map(input)}</div>
        <p className="mt-3 text-[12px] text-text-secondary">
          {e.fair ? (
            <>
              Each {row.payable_event || 'payable event'} is worth about{' '}
              <span className="font-mono text-text-primary">{money(e.fair.raw)}</span> to them
              {e.fair.floored ? (
                <>, under the creator floor, so offer at least <span className="font-mono text-text-primary">{money(e.fair.payout, 0)}</span> or pick a deeper event.</>
              ) : (
                <>, so a payout up to <span className="font-mono text-text-primary">{money(e.fair.payout)}</span> is fair.</>
              )}
            </>
          ) : (
            'What a fully converted user is worth, times the share of payable-event users who get there.'
          )}
        </p>
      </details>

      {error && <div className="mt-2 text-red-400 text-[12px]">{error}</div>}
    </section>
  );
}
