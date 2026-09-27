import { useEffect, useMemo, useState } from 'react';
import { Eyebrow } from '../ui.jsx';
import { api } from '../../lib/api.js';
import { playbook } from '../../lib/playbookApi.js';
import { monthKey } from '../../lib/programs.js';
import { profitOf } from '../../lib/economics.js';
import { useEconomics } from '../../lib/useEconomics.js';
import { useDeals } from '../../state/DealsContext.jsx';
import { useLeads } from '../../state/LeadsContext.jsx';
import { formatCurrency } from '../../lib/stages.js';
import { wholeMoney } from './Zone.jsx';

// Settings → Economics (app_settings key 'goals').
export const GOAL_DEFAULTS = {
  start: '2026-06-01',
  pilot_amount: 10000,
  pilot_days: 90,
  pilot_target: 1,
  pilot_stretch: 3,
  client_monthly: 30000,
  client_target: 2,
  client_days: 180,
};

const DAY = 86_400_000;
const parse = (s) => {
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
};
const longDate = (d) => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

function GoalCard({ tag, headline, detail, count, target, stretch, start, days, names }) {
  const s = parse(start);
  const deadline = new Date(s.getTime() + days * DAY);
  const now = new Date();
  const left = Math.ceil((deadline - now) / DAY);
  const elapsed = Math.min(100, Math.max(0, ((now - s) / (deadline - s)) * 100));
  const done = count >= target;
  const progress = Math.min(100, (count / Math.max(target, 1)) * 100);
  return (
    <div className="panel-card p-5 relative overflow-hidden">
      <div className={`absolute top-0 left-0 right-0 h-[2px] ${done ? 'bg-signal' : 'bg-text-muted'}`} />
      <div className="flex items-center justify-between">
        <span className="eyebrow text-text-muted">{tag}</span>
        <span className={`eyebrow ${done ? 'text-signal' : left < 0 ? 'text-red-400' : 'text-text-secondary'}`}>
          {done ? 'Hit' : left < 0 ? `${-left} days past` : `${left} days left`}
        </span>
      </div>
      <div className="text-text-primary text-[18px] font-semibold mt-3">{headline}</div>
      <p className="text-text-muted text-[12px] mt-1">{detail}</p>
      <div className="mt-4 flex items-baseline gap-2">
        <span className="font-mono text-text-primary text-[28px] leading-none">{count}</span>
        <span className="text-text-secondary text-[13px]">of {target}{stretch ? ` · stretch ${stretch}` : ''}</span>
      </div>
      <div className="mt-2 h-1.5 bg-hairline">
        <div className="h-full bg-signal" style={{ width: `${progress}%` }} />
      </div>
      {names.length > 0 && <p className="text-text-secondary text-[12px] mt-2 truncate" title={names.join(', ')}>{names.join(', ')}</p>}
      <div className="mt-4 flex justify-between text-text-disabled text-[11px] font-mono">
        <span>Due {longDate(deadline)}</span>
        <span>{Math.round(elapsed)}% of the window gone</span>
      </div>
    </div>
  );
}

// I. The two formal goals on Home, counted from real data: pilots of at least
// the pilot amount won since the start date, and clients spending at least the
// monthly bar (Everflow, this month or last).
export default function GoalsWidget() {
  const { deals } = useDeals();
  const { leads } = useLeads();
  const settings = useEconomics();
  const [goals, setGoals] = useState(GOAL_DEFAULTS);
  const [won, setWon] = useState({});
  const [months, setMonths] = useState({});

  const clients = useMemo(() => leads.filter((l) => l.is_client), [leads]);
  useEffect(() => {
    playbook.getSetting('goals').then((g) => g && setGoals({ ...GOAL_DEFAULTS, ...g })).catch(() => {});
  }, []);
  useEffect(() => {
    const ids = deals.map((d) => d.id);
    api.callTimelineContext(ids).then((ctx) => setWon({ won: ctx.won, milestones: ctx.milestones })).catch(() => {});
  }, [deals]);
  useEffect(() => {
    playbook.clientMonths(clients.map((c) => c.id), monthKey(-1)).then(setMonths).catch(() => {});
  }, [clients]);

  // Pilots: deals at or above the pilot amount that were won, or had their
  // paper done, on or after the start date.
  const pilots = deals.filter((d) => {
    if ((d.deal_size ?? 0) < goals.pilot_amount) return false;
    const w = won.won?.[d.id]?.slice(0, 10);
    const paper = won.milestones?.[d.id]?.paper_at;
    return (w && w >= goals.start) || (paper && paper >= goals.start);
  });
  const monthSpend = (id) => Math.max(0, ...(months[id] ?? []).map((m) => m.revenue ?? 0));
  const bigClients = clients.filter((c) => monthSpend(c.id) >= goals.client_monthly);
  const allSpend = clients.reduce((n, c) => n + ((months[c.id] ?? []).find((m) => m.month === monthKey(0))?.revenue ?? 0), 0);
  const profit = profitOf(allSpend, settings);

  return (
    <section className="mb-6">
      <div className="flex items-baseline justify-between mb-3">
        <Eyebrow>Goals</Eyebrow>
        <span className="text-text-muted text-[12px]">
          This month: {wholeMoney(allSpend)} client spend · {wholeMoney(profit.profit)} Panel profit
          {settings.show_commission ? ` · ${wholeMoney(profit.commission)} commission` : ''}
        </span>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <GoalCard
          tag={`${goals.pilot_days} day goal`}
          headline={`First ${formatCurrency(goals.pilot_amount)} test pilot signed`}
          detail={`Deals of ${formatCurrency(goals.pilot_amount)} or more won, or with paper done, since ${longDate(parse(goals.start))}.`}
          count={pilots.length}
          target={goals.pilot_target}
          stretch={goals.pilot_stretch}
          start={goals.start}
          days={goals.pilot_days}
          names={pilots.map((d) => d.company_name)}
        />
        <GoalCard
          tag={`${goals.client_days} day goal`}
          headline={`${goals.client_target} active clients at ${formatCurrency(goals.client_monthly)} per month`}
          detail={`Clients whose Everflow spend reached ${formatCurrency(goals.client_monthly)} this month or last.`}
          count={bigClients.length}
          target={goals.client_target}
          start={goals.start}
          days={goals.client_days}
          names={bigClients.map((c) => c.company_name)}
        />
      </div>
    </section>
  );
}
