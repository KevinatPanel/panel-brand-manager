// ---------------------------------------------------------------------------
// Client programs after signing: lifecycle phase, health, spend trend, profit
// and traffic, per client. One loader shared by the Programs page, the client
// profile and Home.
// ---------------------------------------------------------------------------
import { playbook } from './playbookApi.js';
import { budgetTrend, diagnoseHealth, diagnoseProgram, phaseFor, profitOf, dealEconomics } from './economics.js';

// 'YYYY-MM-01' for the month `offset` months from now (0 = this month).
export function monthKey(offset = 0, today = new Date()) {
  const d = new Date(today.getFullYear(), today.getMonth() + offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

// clients: leads with is_client; deals: DealsContext deals.
export async function loadPrograms(clients, deals, settings) {
  const ids = clients.map((c) => c.id);
  const dealByLead = new Map(deals.map((d) => [d.lead_id, d]));
  const dealIds = [...dealByLead.values()].map((d) => d.id);
  const [months, programs, liveCreators, milestones, econRows] = await Promise.all([
    playbook.clientMonths(ids, monthKey(-4)),
    playbook.listClientPrograms(),
    playbook.liveCreatorCounts(ids),
    playbook.milestonesFor(dealIds),
    playbook.listDealEconomics(),
  ]);
  const econByDeal = Object.fromEntries(econRows.map((r) => [r.deal_id, r]));

  const thisMonth = monthKey(0);
  const lastMonth = monthKey(-1);
  const prevMonth = monthKey(-2);

  return clients.map((c) => {
    const deal = dealByLead.get(c.id) ?? null;
    const ms = deal ? milestones[deal.id] : null;
    const rows = months[c.id] ?? [];
    const at = (m) => rows.find((r) => r.month === m) ?? null;
    const current = at(thisMonth);
    const last = at(lastMonth);
    const prev = at(prevMonth);
    // Went live: the email milestone, else the first month Everflow shows revenue.
    const firstRevenue = [...rows].reverse().find((r) => (r.revenue ?? 0) > 0)?.month ?? null;
    const liveDate = ms?.live_at ?? firstRevenue;
    const phase = phaseFor(liveDate);
    const program = programs[c.id] ?? {};
    // Tracking: the manual flag, else inferred from Everflow conversions.
    const conversionsSeen = rows.some((r) => (r.conversions ?? 0) > 0);
    const tracking = program.tracking_live ?? (conversionsSeen ? true : null);
    const trend = budgetTrend(prev?.revenue, last?.revenue);
    const creatorsNow = program.active_creators ?? liveCreators[c.id] ?? null;
    const health = diagnoseHealth({
      phase: phase?.key,
      tracking,
      trend: trend?.trend ?? null,
      creators: creatorsNow == null ? null : { now: creatorsNow, before: null },
    });
    const spend = current?.revenue ?? last?.revenue ?? null;
    const econ = deal ? econByDeal[deal.id] : null;
    return {
      lead: c,
      deal,
      liveDate,
      liveSource: ms?.live_at ? 'email' : firstRevenue ? 'everflow' : null,
      phase,
      program,
      tracking,
      trend,
      creators: creatorsNow,
      health,
      months: rows,
      current,
      last,
      spend,
      spendMonth: current ? 'this month' : last ? 'last month' : null,
      profit: profitOf(spend ?? 0, settings),
      diagnosis: last ? diagnoseProgram(last, program.monthly_views, settings) : null,
      econ,
      bid: econ?.cpa != null ? Number(econ.cpa) : null,
      zone: econ ? dealEconomics(econ, settings).zone : null,
    };
  });
}

// J. Brands in one vertical side by side: bids and share of traffic for the
// month (clicks, falling back to revenue when Everflow has no click data).
export function marketplace(programRows, monthPick = 'last') {
  const byVertical = new Map();
  for (const p of programRows) {
    const key = p.lead.vertical_name ?? 'No vertical';
    if (!byVertical.has(key)) byVertical.set(key, []);
    byVertical.get(key).push(p);
  }
  return [...byVertical.entries()]
    .map(([vertical, rows]) => {
      const month = (p) => (monthPick === 'current' ? p.current : p.last);
      const useClicks = rows.some((p) => (month(p)?.clicks ?? 0) > 0);
      const traffic = (p) => (useClicks ? month(p)?.clicks : month(p)?.revenue) ?? 0;
      const total = rows.reduce((n, p) => n + traffic(p), 0);
      const topBid = Math.max(0, ...rows.map((p) => p.bid ?? 0)) || null;
      return {
        vertical,
        basis: useClicks ? 'clicks' : 'revenue',
        total,
        topBid,
        brands: rows
          .map((p) => ({
            ...p,
            traffic: traffic(p),
            share: total ? traffic(p) / total : 0,
            gapToTop: topBid != null && p.bid != null ? topBid - p.bid : null,
          }))
          .sort((a, b) => b.share - a.share || (b.bid ?? 0) - (a.bid ?? 0)),
      };
    })
    .sort((a, b) => b.brands.length - a.brands.length || a.vertical.localeCompare(b.vertical));
}
