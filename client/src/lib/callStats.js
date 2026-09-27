// ---------------------------------------------------------------------------
// Per-brand numbers behind the Calls view's charts and timeline, computed from
// the analyzed calls (call_insights) plus each deal's email milestones
// (deal_milestones: first email, paper, live, status), its first Email touch
// and the date it was won. Pure functions; no fetching.
// ---------------------------------------------------------------------------

// The pushback themes (0051 call_insights.pushback[].theme), in column order.
export const THEMES = [
  { key: 'quality', label: 'Quality', def: 'User quality, retention, fraud and LTV: will these users be worth paying for?' },
  { key: 'control', label: 'Control', def: 'Approval over creators or content, and brand safety.' },
  { key: 'mechanics', label: 'How it works', def: 'How the model works, who pays whom, and how Panel makes money.' },
  { key: 'scripts', label: 'Scripts', def: 'Scripts, authenticity and the creative itself.' },
  { key: 'proof', label: 'Proof', def: 'Case studies, examples and other clients.' },
  { key: 'price', label: 'Price', def: 'CPA, payout, budget and fees.' },
  { key: 'supply', label: 'Supply', def: 'Creator pool, niche, geography and audience fit.' },
  { key: 'tracking', label: 'Tracking', def: 'Attribution, MMP, postbacks and reporting.' },
  { key: 'launch', label: 'Getting live', def: 'Contracts, legal, compliance, timelines and setup.' },
];

// The buyer-profile checks (0051 call_insights.profile), in column order.
// `good` is the answer that matched the brands that closed; supply_restriction
// is the one where "no" is the good answer.
export const PROFILE_CHECKS = [
  { key: 'kpi_owner_on_call', label: 'KPI owner on the call', good: true },
  { key: 'named_flat_fee_pain', label: 'Named flat fee pain', good: true },
  { key: 'can_sign_alone', label: 'Could sign alone', good: true },
  { key: 'cheap_frequent_event', label: 'Cheap frequent event', good: true },
  { key: 'tracking_ready', label: 'Tracking stack ready', good: true },
  { key: 'ok_with_ad_approval', label: 'OK with ad level approval', good: true },
  { key: 'supply_restriction', label: 'Supply restriction', good: false },
];

// Whole days from a to b (dates or ISO timestamps), by calendar day.
export function daysBetween(a, b) {
  if (!a || !b) return null;
  const day = (v) => {
    const [y, m, d] = String(v).slice(0, 10).split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((day(b) - day(a)) / 86_400_000);
}

// "27:11" / "1:02:05" -> minutes as a decimal (27.18). null if unparseable.
export function minuteOf(stamp) {
  if (!stamp) return null;
  const parts = String(stamp).trim().split(':').map(Number);
  if (parts.some((n) => Number.isNaN(n))) return null;
  const secs = parts.reduce((acc, n) => acc * 60 + n, 0);
  return parts.length >= 2 ? secs / 60 : null;
}

const today = () => new Date().toISOString().slice(0, 10);

// calls: the view's flattened call rows (only state === 'done' are used).
// deals: DealsContext deals. context: api.callTimelineContext() result.
export function brandStats(calls, deals, context) {
  const dealById = new Map(deals.map((d) => [d.id, d]));
  const byDeal = new Map();
  for (const c of calls) {
    if (c.state !== 'done') continue;
    if (!byDeal.has(c.deal_id)) byDeal.set(c.deal_id, []);
    byDeal.get(c.deal_id).push(c);
  }

  return [...byDeal.entries()].map(([dealId, list]) => {
    const sorted = [...list].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
    const deal = dealById.get(dealId);
    const yesIdx = sorted.findIndex((c) => c.result === 'yes');
    const yesCall = yesIdx >= 0 ? sorted[yesIdx] : null;
    const latest = sorted[sorted.length - 1];
    // The deciding call: where they said yes, else the latest one.
    const deciding = yesCall ?? latest;

    const ms = context.milestones?.[dealId] ?? {};
    // The email milestone is the better first-email source (it reads the whole
    // thread history); the earliest logged Email touch is the fallback.
    const firstEmail = ms.first_email_at ?? context.firstEmail[dealId]?.slice(0, 10) ?? null;
    const firstCall = sorted[0]?.date ?? null;
    const yesDate = yesCall?.date ?? null;
    const wonDate = context.won[dealId]?.slice(0, 10) ?? null;
    const paperDate = ms.paper_at ?? null;
    const liveDate = ms.live_at ?? null;

    // Pushback grouped by theme, each item remembering its call.
    const pushback = {};
    for (const c of sorted) {
      for (const p of c.insight?.pushback ?? []) {
        (pushback[p.theme] ??= []).push({ text: p.text, date: c.date });
      }
    }
    // Profile: the latest call that established each check wins.
    const profile = {};
    for (const c of sorted) Object.assign(profile, c.insight?.profile ?? {});

    const layersCall = [...sorted].reverse().find((c) => (c.insight?.decision_layers ?? []).length);

    return {
      deal_id: dealId,
      brand: deal?.company_name ?? latest.brand,
      vertical: deal?.vertical_name ?? null,
      stage: deal?.current_stage ?? null,
      calls: sorted,
      callCount: sorted.length,
      minutes: sorted.reduce((n, c) => n + (c.minutes ?? 0), 0),
      questions: sorted.reduce((n, c) => n + (c.questions_count ?? 0), 0),
      firstEmail,
      firstCall,
      yesDate,
      wonDate,
      paperDate,
      paperNote: ms.paper_note ?? null,
      liveDate,
      liveNote: ms.live_note ?? null,
      statusNote: ms.status_note ?? null,
      callsToYes: yesIdx >= 0 ? yesIdx + 1 : null,
      emailToCall: daysBetween(firstEmail, firstCall),
      callToYes: daysBetween(firstCall, yesDate),
      yesToLive: daysBetween(yesDate, liveDate),
      // Not live yet: days since the yes so far.
      yesOpenDays: yesDate && !liveDate ? daysBetween(yesDate, today()) : null,
      yesMinute: minuteOf(yesCall?.insight?.buy_in_at),
      yesStamp: yesCall?.insight?.buy_in_at ?? null,
      decidingQuestions: deciding?.questions_count ?? null,
      decidingIsYes: !!yesCall,
      decisionLayers: layersCall?.insight?.decision_layers ?? [],
      latestResult: latest?.result ?? null,
      payout: [...sorted].reverse().find((c) => c.insight?.payout)?.insight.payout ?? null,
      cap: [...sorted].reverse().find((c) => c.insight?.budget_cap)?.insight.budget_cap ?? null,
      pushback,
      profile,
      yesCall,
    };
  });
}
