import { useEffect, useState } from 'react';
import { Button, Eyebrow, Input } from '../ui.jsx';
import { playbook } from '../../lib/playbookApi.js';
import { ECONOMICS_DEFAULTS } from '../../lib/economics.js';
import { saveEconomics, useEconomics } from '../../lib/useEconomics.js';
import { GOAL_DEFAULTS } from './GoalsWidget.jsx';

const ECON_FIELDS = [
  ['ua_fee_pct', 'UA fee (% of brand spend)'],
  ['commission_pct', 'Rep commission (% of Panel profit)'],
  ['bid_floor', 'Creator floor ($ per event)'],
  ['dead_below', 'Dead zone below ($ eCPM)'],
  ['goated_above', 'Goated above ($ eCPM)'],
  ['low_ctr_pct', 'Low click-through (%)'],
  ['low_cvr_pct', 'Low conversion rate (%)'],
];
const GOAL_FIELDS = [
  ['start', 'Goals start', 'date'],
  ['pilot_amount', 'Pilot amount ($)'],
  ['pilot_days', 'Pilot goal window (days)'],
  ['pilot_target', 'Pilots to sign'],
  ['pilot_stretch', 'Stretch'],
  ['client_monthly', 'Client monthly spend bar ($)'],
  ['client_target', 'Clients at that bar'],
  ['client_days', 'Client goal window (days)'],
];

// Settings → Economics: the numbers every playbook screen runs on (app_settings
// 'economics' and 'goals').
export default function EconomicsSettings() {
  const econ = useEconomics();
  const [e, setE] = useState(econ);
  const [g, setG] = useState(GOAL_DEFAULTS);
  const [status, setStatus] = useState(null);

  useEffect(() => setE(econ), [econ]);
  useEffect(() => {
    playbook.getSetting('goals').then((v) => v && setG({ ...GOAL_DEFAULTS, ...v })).catch(() => {});
  }, []);

  async function save(ev) {
    ev.preventDefault();
    const nums = (obj, defaults) =>
      Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, typeof defaults[k] === 'number' ? Number(v) : v]));
    try {
      await saveEconomics(nums(e, ECONOMICS_DEFAULTS));
      await playbook.setSetting('goals', nums(g, GOAL_DEFAULTS));
      setStatus({ ok: true, text: 'Saved.' });
    } catch (err) {
      setStatus({ ok: false, text: err.message });
    }
  }

  const field = (obj, set) => ([key, label, type]) => (
    <label key={key} className="block">
      <span className="eyebrow text-text-muted block mb-1">{label}</span>
      <Input type={type ?? 'number'} step="any" value={obj[key] ?? ''} onChange={(ev) => set({ ...obj, [key]: ev.target.value })} />
    </label>
  );

  return (
    <form onSubmit={save} className="panel-card p-5 space-y-5">
      <div>
        <Eyebrow className="mb-1">Economics</Eyebrow>
        <p className="text-text-muted text-[12px]">Used by deal economics, the Pipeline and Programs profit figures, and the program diagnostics.</p>
      </div>
      <div className="grid grid-cols-2 gap-3">{ECON_FIELDS.map(field(e, setE))}</div>
      <label className="flex items-center gap-2 text-text-secondary text-[13px]">
        <input type="checkbox" checked={!!e.show_commission} onChange={(ev) => setE({ ...e, show_commission: ev.target.checked })} />
        Show commission projections next to profit
      </label>
      <div className="border-t border-hairline pt-4">
        <Eyebrow className="mb-3">Goals on Home</Eyebrow>
        <div className="grid grid-cols-2 gap-3">{GOAL_FIELDS.map(field(g, setG))}</div>
      </div>
      <div className="flex items-center justify-end gap-3">
        {status && <span className={`text-[12px] ${status.ok ? 'text-signal' : 'text-red-400'}`}>{status.text}</span>}
        <Button type="submit" variant="primary">Save</Button>
      </div>
    </form>
  );
}
