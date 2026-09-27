// ---------------------------------------------------------------------------
// Keyword rules that place a company into one of the workspace's verticals
// from its name, domain, Apollo industry and description. Pure. The first pass
// of auto-sort (lib/autoSort.js); whatever the rules can't place confidently
// goes to Claude (Edge Function classify-verticals).
//
// Each rule finds its vertical by name pattern, so renaming "Sports betting"
// to "Sportsbooks" still works. A rule whose vertical doesn't exist is skipped.
// ---------------------------------------------------------------------------

const RULES = [
  {
    key: 'sports_betting',
    distinct: true, // its words rarely mean anything else: one is enough
    vertical: /betting|sportsbook|gambling|igaming|casino/i,
    words: /\b(sports?book|sports? betting|betting|bets?|wager\w*|gambling|casinos?|igaming|i-gaming|daily fantasy|dfs|sweepstakes casino|poker|slots?|parlays?)\b/i,
    industry: /gambling|casinos?/i,
  },
  {
    key: 'prediction',
    distinct: true, // its words rarely mean anything else: one is enough
    vertical: /prediction/i,
    words: /\b(prediction markets?|event contracts?|forecasting markets?|kalshi|polymarket)\b/i,
  },
  {
    key: 'dating',
    distinct: true, // its words rarely mean anything else: one is enough
    vertical: /dating|relationship/i,
    words: /\b(dating|matchmaking|singles|date nights?|find love|meet people)\b/i,
  },
  {
    key: 'legal',
    distinct: true, // its words rarely mean anything else: one is enough
    vertical: /legal|law/i,
    words: /\b(law firms?|legal services?|attorneys?|lawyers?|personal injury|litigation|legal ?tech|paralegals?|class action|mass torts?|esq)\b/i,
    industry: /law practice|legal services/i,
  },
  {
    key: 'rewarded_ua',
    vertical: /rewarded|user acquisition|\bua\b/i,
    words: /\b(rewarded (play|ads?|apps?|ua)|play[- ]to[- ]earn|get paid to|earn (rewards|cash|gift cards)|offerwalls?|cash rewards? app|survey rewards?|rewards? apps?|loyalty rewards?)\b/i,
  },
  {
    key: 'gaming',
    vertical: /gaming|games/i,
    words: /\b(video games?|mobile games?|gaming|game studios?|esports|e-sports|gamers?|puzzle games?|casual games?)\b/i,
    industry: /computer games|gaming/i,
  },
  {
    key: 'fintech',
    vertical: /fin ?tech/i,
    words: /\b(fintech|neobank\w*|cash advance|paycheck advance|earned wage|ewa|bnpl|buy now,? pay later|budgeting apps?|personal finance apps?|investing apps?|stock trading|brokerage apps?|crypto\w*|bitcoin|blockchain|digital wallets?|payments? apps?|credit[- ]builder|credit score|banking apps?|robo[- ]advis\w*|money apps?)\b/i,
  },
  {
    key: 'financial_services',
    vertical: /financial services|^finance$|banking|insurance/i,
    words: /\b(insurance|insurers?|credit unions?|banks?|lending|lenders?|loans?|mortgages?|tax (prep\w*|services|software)|accounting|wealth management|financial advis\w*|credit cards?|debt relief|debt consolidation|annuit\w*)\b/i,
    industry: /financial services|banking|insurance|investment management|accounting/i,
  },
  {
    key: 'healthtech',
    vertical: /health ?tech|digital health|healthcare/i,
    words: /\b(telehealth|telemedicine|digital health|health ?tech|virtual care|online (doctors?|pharmacy|therapy)|glp-?1|weight loss (program|medication)s?|prescriptions?|ehr|health records|healthcare (technology|software|platform)|care navigation|remote patient)\b/i,
    industry: /hospital & health care|medical practice|medical devices|pharmaceuticals|health care/i,
  },
  {
    key: 'fitness',
    vertical: /fitness|gym/i,
    words: /\b(fitness|gyms?|workouts?|pilates|personal train\w*|strength training|running app|indoor cycling|home fitness|fitness apps?|athletic training|crossfit)\b/i,
  },
  {
    key: 'wellness',
    vertical: /wellness/i,
    words: /\b(wellness|supplements?|vitamins?|nutrition|meditation|mindfulness|mental health|sleep|self[- ]care|skin ?care|protein|hydration|holistic|therapy)\b/i,
    industry: /health, wellness|wellness|alternative medicine|nutrition/i,
  },
  {
    key: 'ecommerce',
    vertical: /e-?commerce|retail|shopping|dtc|consumer goods/i,
    words: /\b(e-?commerce|online (store|shop|retail\w*)|online shopping|shop online|marketplace|apparel|fashion|clothing|cosmetics|beauty|dtc|direct[- ]to[- ]consumer|consumer goods|subscription box\w*|home goods|jewelry|footwear)\b/i,
    industry: /retail|apparel|cosmetics|consumer goods|e-?commerce|luxury goods|sporting goods/i,
  },
];

// Points: a keyword in the company's own name or domain is the strongest
// signal, one in the description next, an Apollo industry label last.
const NAME_PTS = 3;
const TEXT_PTS = 2;
const INDUSTRY_PTS = 1;
const MIN_SCORE = 3;

// A domain like "betmgm.com" becomes "betmgm com" so the word rules can read it.
const domainWords = (lead) =>
  String(lead.domain || lead.website || '')
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[./-]/g, ' ');

// Match the rules against the workspace's verticals: { ruleKey: vertical }.
export function mapRules(verticals) {
  const map = {};
  for (const r of RULES) {
    const v = verticals.find((x) => r.vertical.test(x.name));
    if (v) map[r.key] = v;
  }
  return map;
}

// Score one company against every mapped rule. Returns the winning vertical
// and why, or null when nothing matched or two verticals tied.
export function classifyLead(lead, ruleMap) {
  const name = `${lead.company_name ?? ''} ${domainWords(lead)}`;
  const text = String(lead.description ?? '');
  const industry = String(lead.industry ?? '');
  const scores = [];
  for (const r of RULES) {
    const vertical = ruleMap[r.key];
    if (!vertical) continue;
    let score = 0;
    const hits = [];
    const n = name.match(r.words);
    if (n) { score += NAME_PTS; hits.push(`“${n[0]}” in the name`); }
    // Each distinct keyword in the description adds weight: one loose word
    // ("shop", "sleep") isn't enough on its own, two agreeing ones are.
    const t = [...new Set((text.match(new RegExp(r.words.source, 'gi')) ?? []).map((w) => w.toLowerCase()))];
    if (t.length) { score += (r.distinct ? MIN_SCORE : TEXT_PTS) + t.length - 1; hits.push(`${t.slice(0, 3).map((w) => `“${w}”`).join(', ')} in the description`); }
    if (r.industry && r.industry.test(industry)) { score += INDUSTRY_PTS; hits.push(`industry ${industry}`); }
    if (score) scores.push({ vertical, score, hits });
  }
  if (!scores.length) return null;
  // The same vertical can be reached by two rules (for example a combined
  // "Health & Wellness" vertical): keep its best score.
  const best = new Map();
  for (const s of scores) {
    const cur = best.get(s.vertical.id);
    if (!cur || s.score > cur.score) best.set(s.vertical.id, s);
  }
  const ranked = [...best.values()].sort((a, b) => b.score - a.score);
  const [top, next] = ranked;
  // Act only on a name keyword, two description keywords, or a description
  // keyword the industry agrees with. A tie is a guess: leave it to Claude.
  if (top.score < MIN_SCORE) return null;
  if (next && next.score >= top.score) return null;
  return { vertical: top.vertical, reason: `Keyword rules: ${top.hits.join(', ')}` };
}
