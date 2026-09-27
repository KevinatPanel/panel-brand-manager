// ---------------------------------------------------------------------------
// Data layer for the playbook features (0053): deal economics, the qualifier,
// Ad Library checks, client programs, playbook wording and app settings.
// Kept apart from api.js so that file stops growing.
//
// Until 0053 is applied the tables don't exist; every read here then returns
// an empty result instead of throwing, so the pages still load. Writes throw
// a clear message instead.
// ---------------------------------------------------------------------------
import { supabase } from './supabaseClient.js';

const MISSING = ['PGRST205', '42P01', 'PGRST204', '42703'];
const NOT_READY = 'This needs the latest database update (migration 0053) before it can save.';

function read({ data, error }, empty) {
  if (error) {
    if (MISSING.includes(error.code)) return empty;
    throw new Error(error.message);
  }
  return data ?? empty;
}
function write({ data, error }) {
  if (error) throw new Error(MISSING.includes(error.code) ? NOT_READY : error.message);
  return data;
}

const clean = (obj, keys) => {
  const out = {};
  for (const k of keys) {
    if (obj[k] === undefined) continue;
    out[k] = obj[k] === '' ? null : obj[k];
  }
  return out;
};

export const playbook = {
  // ---- app_settings (0026): JSON values by key ----
  async getSetting(key) {
    const rows = read(await supabase.from('app_settings').select('value').eq('key', key), []);
    return rows[0]?.value ?? null;
  },
  async setSetting(key, value) {
    return write(
      await supabase
        .from('app_settings')
        .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' }),
    );
  },

  // ---- A. deal economics ----
  async listDealEconomics() {
    return read(await supabase.from('deal_economics').select('*'), []);
  },
  async getDealEconomics(dealId) {
    const rows = read(await supabase.from('deal_economics').select('*').eq('deal_id', dealId), []);
    return rows[0] ?? null;
  },
  async saveDealEconomics(dealId, patch) {
    const row = clean(patch, ['payable_event', 'cpa', 'brand_cac', 'conv_per_1k', 'user_value', 'reach_rate', 'notes']);
    return write(
      await supabase
        .from('deal_economics')
        .upsert({ deal_id: dealId, ...row, updated_at: new Date().toISOString() }, { onConflict: 'deal_id' }),
    );
  },

  // ---- B. qualifier inputs ----
  async listQualifiers() {
    return read(await supabase.from('lead_qualifier').select('*'), []);
  },
  async getQualifier(leadId) {
    const rows = read(await supabase.from('lead_qualifier').select('*').eq('lead_id', leadId), []);
    return rows[0] ?? null;
  },
  async saveQualifier(leadId, patch) {
    const row = clean(patch, ['funding_stage', 'funding_date', 'employees', 'vertical_key', 'ad_spend']);
    return write(
      await supabase
        .from('lead_qualifier')
        .upsert({ lead_id: leadId, ...row, updated_at: new Date().toISOString() }, { onConflict: 'lead_id' }),
    );
  },

  // ---- D. Ad Library checks ----
  async listAdChecks(leadId) {
    return read(
      await supabase.from('ad_library_checks').select('*').eq('lead_id', leadId).order('checked_on', { ascending: false }).order('id', { ascending: false }),
      [],
    );
  },
  // The latest check per company, for badges and prep sheets.
  async latestAdChecks() {
    const rows = read(
      await supabase.from('ad_library_checks').select('*').order('checked_on', { ascending: false }).order('id', { ascending: false }),
      [],
    );
    const latest = {};
    for (const r of rows) if (!(r.lead_id in latest)) latest[r.lead_id] = r;
    return latest;
  },
  async addAdCheck(leadId, body) {
    const row = clean(body, ['checked_on', 'active_ads', 'creators', 'hook', 'notes', 'checked_by']);
    return write(await supabase.from('ad_library_checks').insert({ lead_id: leadId, ...row }));
  },
  async deleteAdCheck(id) {
    return write(await supabase.from('ad_library_checks').delete().eq('id', id));
  },

  // ---- G. client programs ----
  async listClientPrograms() {
    const rows = read(await supabase.from('client_programs').select('*'), []);
    return Object.fromEntries(rows.map((r) => [r.lead_id, r]));
  },
  async saveClientProgram(leadId, patch) {
    const row = clean(patch, ['tracking_live', 'active_creators', 'monthly_views', 'notes']);
    return write(
      await supabase
        .from('client_programs')
        .upsert({ lead_id: leadId, ...row, updated_at: new Date().toISOString() }, { onConflict: 'lead_id' }),
    );
  },

  // Live ad items per company: the default active-creator count.
  async liveCreatorCounts(leadIds) {
    if (!leadIds.length) return {};
    const rows = read(
      await supabase.from('ad_items').select('lead_id, creator_name').in('lead_id', leadIds).eq('current_stage', 'live'),
      [],
    );
    const sets = {};
    for (const r of rows) (sets[r.lead_id] ??= new Set()).add((r.creator_name ?? '').toLowerCase());
    return Object.fromEntries(Object.entries(sets).map(([k, v]) => [k, v.size]));
  },

  // Everflow months per client, newest first, with the traffic numbers pulled
  // out of the raw reporting row (clicks, approved conversions).
  async clientMonths(leadIds, since) {
    if (!leadIds.length) return {};
    let q = supabase
      .from('client_spend_actuals')
      .select(
        'lead_id, month, revenue, payout, total_click:everflow_raw->reporting->>total_click, unique_click:everflow_raw->reporting->>unique_click, cv:everflow_raw->reporting->>cv',
      )
      .in('lead_id', leadIds)
      .order('month', { ascending: false });
    if (since) q = q.gte('month', since);
    const rows = read(await q, []);
    const out = {};
    for (const r of rows) {
      const n = (v) => (v == null ? null : Number(v));
      (out[r.lead_id] ??= []).push({
        month: r.month,
        revenue: r.revenue,
        payout: r.payout,
        clicks: n(r.unique_click) ?? n(r.total_click),
        conversions: n(r.cv),
      });
    }
    return out;
  },

  // ---- E/F. playbook wording ----
  async listPlaybook(kind) {
    let q = supabase.from('playbook_entries').select('*').order('sort').order('key');
    if (kind) q = q.eq('kind', kind);
    const rows = read(await q, []);
    return Object.fromEntries(rows.map((r) => [r.key, r]));
  },

  // ---- Everything the Programs page needs about deals' milestones ----
  async milestonesFor(dealIds) {
    if (!dealIds.length) return {};
    const rows = read(await supabase.from('deal_milestones').select('*').in('deal_id', dealIds), []);
    return Object.fromEntries(rows.map((r) => [r.deal_id, r]));
  },

  // Recent calls on a deal, newest first (prep sheet).
  async callsForDeal(dealId) {
    return read(
      await supabase.from('call_insights').select('*').eq('deal_id', dealId).eq('status', 'done').order('call_date', { ascending: false }),
      [],
    );
  },

  // The deal's most recent logged touches (prep sheet).
  async recentTouches(dealId, limit = 6) {
    return read(
      await supabase.from('touch_log').select('touch_date, touch_type, outcome, notes').eq('deal_id', dealId).order('touch_date', { ascending: false }).limit(limit),
      [],
    );
  },
};
