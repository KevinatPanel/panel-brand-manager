// ---------------------------------------------------------------------------
// Auto-sort: puts unsorted companies into verticals so "Unsorted" empties
// itself. Runs when the Companies board loads (and from its Auto-sort button):
//   1. keyword rules (lib/verticalRules.js), in the browser, instantly
//   2. Claude for the rest (Edge Function classify-verticals), in batches
// Companies a person placed or left Unsorted on purpose (vertical_source
// 'manual', migration 0054) are never touched.
// ---------------------------------------------------------------------------
import { supabase } from './supabaseClient.js';
import { classifyLead, mapRules } from './verticalRules.js';

const MISSING = ['42703', 'PGRST204', 'PGRST205', '42P01'];
const missing = (error) => error && MISSING.includes(error.code);

// Unsorted companies with what the rules read. Before 0054 there is no
// vertical_source column, so every unsorted company is fair game.
async function unsortedLeads() {
  const cols = 'id, company_name, domain, website, industry, description';
  const withSource = await supabase
    .from('leads')
    .select(`${cols}, vertical_source`)
    .is('vertical_id', null);
  if (!withSource.error) return { rows: withSource.data.filter((l) => l.vertical_source !== 'manual'), tracked: true };
  if (!missing(withSource.error)) throw new Error(withSource.error.message);
  const plain = await supabase.from('leads').select(cols).is('vertical_id', null);
  if (plain.error) throw new Error(plain.error.message);
  return { rows: plain.data, tracked: false };
}

// Pass 1. Returns how many companies the rules placed.
export async function sortByRules(verticals) {
  const { rows, tracked } = await unsortedLeads();
  const ruleMap = mapRules(verticals);
  const byVertical = new Map();
  for (const lead of rows) {
    const hit = classifyLead(lead, ruleMap);
    if (!hit) continue;
    const list = byVertical.get(hit.vertical.id) ?? [];
    list.push({ id: lead.id, reason: hit.reason });
    byVertical.set(hit.vertical.id, list);
  }
  let placed = 0;
  const now = new Date().toISOString();
  for (const [verticalId, list] of byVertical) {
    const ids = list.map((l) => l.id);
    // One write per vertical. The reason is per company, so it only goes on
    // when the column exists; the rules' reason is short and generic enough
    // to share ("Keyword rules") when written in bulk.
    const patch = { vertical_id: verticalId, updated_at: now };
    if (tracked) Object.assign(patch, { vertical_source: 'rules', vertical_reason: 'Keyword rules (name, site, industry, description)' });
    const { error } = await supabase.from('leads').update(patch).in('id', ids).is('vertical_id', null);
    if (error) throw new Error(error.message);
    placed += ids.length;
  }
  return { placed, left: rows.length - placed, tracked };
}

// Pass 2. Calls classify-verticals until it has nothing left, reporting
// progress. Resolves { placed, created, skipped, unavailable }; unavailable is
// set when the function isn't deployed yet (or errors), so the board can say so.
// recheck also re-sends companies Claude already looked at (once each: only
// those checked before this run started).
export async function sortWithClaude({ recheck = false, onProgress } = {}) {
  const total = { placed: 0, created: [], skipped: 0, unavailable: null };
  const startedAt = new Date().toISOString();
  for (let round = 0; round < 20; round++) {
    const { data, error } = await supabase.functions.invoke('classify-verticals', {
      method: 'POST',
      body: recheck ? { checked_before: startedAt } : {},
    });
    if (error || data?.error) {
      let msg = data?.error ?? error?.message ?? 'unknown error';
      // FunctionsHttpError hides the body; read it when there is one.
      if (error?.context?.json) {
        try {
          msg = (await error.context.json()).error ?? msg;
        } catch {
          /* keep msg */
        }
      }
      if (error?.context?.status === 404 || /not found|Failed to send/i.test(msg)) msg = 'not deployed';
      total.unavailable = msg;
      break;
    }
    total.placed += data.placed ?? 0;
    total.skipped += data.skipped ?? 0;
    total.created.push(...(data.created ?? []));
    onProgress?.({ ...total });
    if (!data.more || (data.placed ?? 0) + (data.skipped ?? 0) === 0) break;
  }
  return total;
}
