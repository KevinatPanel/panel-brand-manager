// ---------------------------------------------------------------------------
// Data layer — same method names + return shapes as the old fetch-based API,
// but backed by supabase-js (Postgres + RLS). Business logic that used to live
// in the Express server now runs here, reusing the ported pure modules.
//
// Stage transitions are just stage_history inserts; a DB trigger syncs
// deals.current_stage. Deleting a deal resets its linked lead (DB trigger).
// "Start Outreach" from a lead is the start_outreach() Postgres function.
// Lead scores are recomputed client-side and written to leads.score.
// ---------------------------------------------------------------------------
import { supabase } from './supabaseClient.js';
import { nowIso, normalizeDateInput, daysBetween, todayInput, toDateInput } from './dates.js';
import {
  STAGES,
  OWNERS,
  SOURCES,
  CHANNELS,
  COMPANY_STATUSES,
  TOUCH_TYPES,
  TOUCH_OUTCOMES,
  STAKEHOLDER_ROLES,
  DEFAULT_HEALTH_THRESHOLD_DAYS,
  nextStageCode,
  AD_STAGES,
  PLATFORMS,
} from './stages.js';
import { CATEGORY_ORDER, enrichConfig } from './scoringDefaults.js';
import { calculateScore } from './leadScoring.js';
import { buildLeadSummary } from './leadsCompute.js';

const STAGE_CODES = STAGES.map((s) => s.code);
const AD_STAGE_CODES = AD_STAGES.map((s) => s.code);

// Throw on a Supabase error, else return data.
function unwrap({ data, error }) {
  if (error) throw new Error(error.message || 'Request failed');
  return data;
}

// ===== Deals =====================================================

// Enrich a deal_summaries row: real boolean + live days_in_stage + computed
// deal health. is_at_risk is deliberately computed here client-side, not in
// SQL — days_in_stage/days_in_pipeline are never computed in SQL either, and
// baking the admin-editable threshold into the deal_summaries view would mean
// a migration every time someone tweaks it (see 0027's comment).
function enrichDeal(row, healthThreshold = DEFAULT_HEALTH_THRESHOLD_DAYS) {
  const enteredAt = row.current_stage_entered_at ?? null;
  const pipelineAt = row.pipeline_entered_at ?? row.created_at ?? null;
  const daysInStage = enteredAt ? daysBetween(enteredAt) : 0;
  return {
    ...row,
    fast_track: !!row.fast_track,
    stage_entered_at: enteredAt,
    days_in_stage: daysInStage,
    pipeline_entered_at: pipelineAt,
    days_in_pipeline: pipelineAt ? daysBetween(pipelineAt) : 0,
    is_at_risk:
      row.current_stage !== 'LOST' && daysInStage > healthThreshold && !row.last_touch_in_stage,
  };
}

// Deal health threshold: fetched once and cached in-memory (admin edits are
// rare, so a same-session staleness window until next reload is acceptable).
let healthConfigCache = null;
async function getHealthThreshold() {
  if (healthConfigCache) return healthConfigCache.stale_days_threshold;
  const row = unwrap(
    await supabase.from('app_settings').select('value').eq('key', 'deal_health').maybeSingle(),
  );
  healthConfigCache = row?.value ?? { stale_days_threshold: DEFAULT_HEALTH_THRESHOLD_DAYS };
  return healthConfigCache.stale_days_threshold;
}

async function fetchDealSummary(id) {
  const threshold = await getHealthThreshold();
  const row = unwrap(await supabase.from('deal_summaries').select('*').eq('id', id).single());
  return enrichDeal(row, threshold);
}

// Insert a stage_history row (the trigger syncs deals.current_stage).
async function recordStage(dealId, stage, when = nowIso()) {
  unwrap(
    await supabase.from('stage_history').insert({ deal_id: dealId, stage, entered_at: when }),
  );
}

// ===== Ad tracker helpers ========================================

async function fetchAdItemSummary(id) {
  return unwrap(await supabase.from('ad_item_summaries').select('*').eq('id', id).single());
}

// Creators are shared as a plain link (profile/content URL); add a scheme if
// missing so it's always a clickable href, not just free text.
function normalizeCreatorLink(value) {
  const s = String(value).trim();
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}

// ===== Lead scoring helpers ======================================

async function loadConfigs() {
  const rows = unwrap(
    await supabase.from('scoring_config').select('*').order('sort_order').order('id'),
  );
  return rows.map(enrichConfig);
}

async function loadSignalMap(leadId) {
  const rows = unwrap(
    await supabase.from('lead_signals').select('signal_key,value,notes').eq('lead_id', leadId),
  );
  const map = {};
  for (const r of rows) map[r.signal_key] = { value: r.value, notes: r.notes };
  return map;
}

async function contactCount(leadId) {
  const { count, error } = await supabase
    .from('lead_contacts')
    .select('*', { count: 'exact', head: true })
    .eq('lead_id', leadId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

// Recompute + persist a lead's score. Returns the new score.
async function rescoreLead(leadId, configs = null) {
  const cfgs = configs ?? (await loadConfigs());
  const [signalMap, contacts] = await Promise.all([loadSignalMap(leadId), contactCount(leadId)]);
  const { score } = calculateScore(cfgs, signalMap, contacts);
  const now = nowIso();
  unwrap(
    await supabase
      .from('leads')
      .update({ score, score_updated_at: now, updated_at: now })
      .eq('id', leadId),
  );
  return score;
}

async function leadSummaryById(id) {
  const lead = unwrap(
    await supabase.from('leads').select('*, vertical:verticals(name)').eq('id', id).single(),
  );
  const configs = await loadConfigs();
  const [signalMap, contacts] = await Promise.all([loadSignalMap(id), contactCount(id)]);
  return buildLeadSummary({ ...lead, vertical_name: lead.vertical?.name ?? null }, configs, signalMap, contacts);
}

// Recompute every lead (after a scoring-config change). Returns the count.
async function rescoreAllLeadsInternal() {
  const configs = await loadConfigs();
  const leads = unwrap(await supabase.from('leads').select('id'));
  const allSignals = unwrap(await supabase.from('lead_signals').select('lead_id,signal_key,value,notes'));
  const allContacts = unwrap(await supabase.from('lead_contacts').select('lead_id'));

  const signalsByLead = new Map();
  for (const s of allSignals) {
    if (!signalsByLead.has(s.lead_id)) signalsByLead.set(s.lead_id, {});
    signalsByLead.get(s.lead_id)[s.signal_key] = { value: s.value, notes: s.notes };
  }
  const countByLead = new Map();
  for (const c of allContacts) countByLead.set(c.lead_id, (countByLead.get(c.lead_id) ?? 0) + 1);

  const now = nowIso();
  await Promise.all(
    leads.map((l) => {
      const { score } = calculateScore(configs, signalsByLead.get(l.id) ?? {}, countByLead.get(l.id) ?? 0);
      return supabase
        .from('leads')
        .update({ score, score_updated_at: now, updated_at: now })
        .eq('id', l.id)
        .then(({ error }) => {
          if (error) throw new Error(error.message);
        });
    }),
  );
  return leads.length;
}

// ===== Public API ================================================

export const api = {
  // ---- Deals ----
  listDeals: async () => {
    const threshold = await getHealthThreshold();
    const rows = unwrap(
      await supabase.from('deal_summaries').select('*').order('updated_at', { ascending: false }),
    );
    return rows.map((r) => enrichDeal(r, threshold));
  },

  getDeal: async (id) => {
    const threshold = await getHealthThreshold();
    const deal = enrichDeal(
      unwrap(await supabase.from('deal_summaries').select('*').eq('id', id).single()),
      threshold,
    );
    const history = unwrap(
      await supabase
        .from('stage_history')
        .select('id,stage,entered_at')
        .eq('deal_id', id)
        // Order by id (insertion order = true progression order). NOT by the
        // user-editable entered_at — otherwise editing a date reshuffles the list.
        .order('id'),
    );
    const touches = unwrap(
      await supabase
        .from('touch_log')
        .select('*')
        .eq('deal_id', id)
        .order('touch_date', { ascending: false })
        .order('id', { ascending: false }),
    );
    const stage_history = history.map((row, i) => {
      const next = history[i + 1];
      const endIso = next ? next.entered_at : nowIso();
      return { ...row, days_in_stage: daysBetween(row.entered_at, endIso), ongoing: !next };
    });
    return { ...deal, stage_history, touches };
  },

  createDeal: async (body = {}) => {
    if (!body.brand_name || !String(body.brand_name).trim()) {
      throw new Error('brand_name is required');
    }
    const stage = STAGE_CODES.includes(body.current_stage) ? body.current_stage : 'S1';
    const startAt = normalizeDateInput(body.entered_at);
    const id = unwrap(
      await supabase
        .from('deals')
        .insert({
          brand_name: String(body.brand_name).trim(),
          vertical: body.vertical ?? null,
          owner: OWNERS.includes(body.owner) ? body.owner : null,
          source: SOURCES.includes(body.source) ? body.source : null,
          current_stage: stage,
          channel: CHANNELS.includes(body.channel) ? body.channel : null,
          fast_track: !!body.fast_track,
          pilot_spend: body.pilot_spend !== '' && body.pilot_spend != null ? Number(body.pilot_spend) : null,
          contact_id: body.contact_id ? Number(body.contact_id) : null,
          intent_notes: body.intent_notes ?? null,
          closed_lost_reason: null,
          created_at: startAt,
          updated_at: startAt,
        })
        .select('id')
        .single(),
    ).id;
    await recordStage(id, stage, startAt);
    return fetchDealSummary(id);
  },

  updateDeal: async (id, body = {}) => {
    const patch = { updated_at: nowIso() };
    if (body.brand_name !== undefined) patch.brand_name = String(body.brand_name).trim();
    if (body.vertical !== undefined) patch.vertical = body.vertical;
    if (body.owner !== undefined) patch.owner = OWNERS.includes(body.owner) ? body.owner : null;
    if (body.source !== undefined) patch.source = SOURCES.includes(body.source) ? body.source : null;
    if (body.channel !== undefined) patch.channel = CHANNELS.includes(body.channel) ? body.channel : null;
    if (body.fast_track !== undefined) patch.fast_track = !!body.fast_track;
    if (body.pilot_spend !== undefined)
      patch.pilot_spend = body.pilot_spend === '' || body.pilot_spend === null ? null : Number(body.pilot_spend);
    if (body.contact_id !== undefined) patch.contact_id = body.contact_id ? Number(body.contact_id) : null;
    if (body.intent_notes !== undefined) patch.intent_notes = body.intent_notes;
    unwrap(await supabase.from('deals').update(patch).eq('id', id));
    return fetchDealSummary(id);
  },

  advanceDeal: async (id) => {
    const deal = unwrap(await supabase.from('deals').select('current_stage').eq('id', id).single());
    if (deal.current_stage === 'LOST') throw new Error('Deal is Closed Lost and cannot advance');
    const next = nextStageCode(deal.current_stage);
    if (!next) throw new Error(`No next stage after ${deal.current_stage}`);
    await recordStage(id, next);
    return fetchDealSummary(id);
  },

  setStage: async (id, stage) => {
    if (!STAGE_CODES.includes(stage)) throw new Error('Invalid stage code');
    await recordStage(id, stage);
    return fetchDealSummary(id);
  },

  // Old prospecting flow (P1/P2 -> S1 + first touch); retained for compatibility.
  startOutreach: async (id, body = {}) => {
    const now = nowIso();
    await recordStage(id, 'S1', now);
    unwrap(
      await supabase.from('touch_log').insert({
        deal_id: id,
        touch_date: now,
        touch_type: TOUCH_TYPES.includes(body.touch_type) ? body.touch_type : 'Email',
        outcome: 'No Response',
        notes: body.notes ?? 'First outreach sent.',
        created_at: now,
      }),
    );
    return fetchDealSummary(id);
  },

  markLost: async (id, reason) => {
    const r = (reason ?? '').toString().trim();
    if (!r) throw new Error('A lost reason is required');
    unwrap(await supabase.from('deals').update({ closed_lost_reason: r, updated_at: nowIso() }).eq('id', id));
    await recordStage(id, 'LOST');
    return fetchDealSummary(id);
  },

  deleteDeal: async (id) => {
    // .select() so a silently-filtered 0-row delete (RLS / no match) surfaces as
    // an error instead of a no-op that looks like "nothing happened".
    const rows = unwrap(await supabase.from('deals').delete().eq('id', id).select('id'));
    if (!rows || rows.length === 0) {
      throw new Error('Deal was not deleted (no matching row or permission denied).');
    }
    return { deleted: true };
  },

  addTouch: async (id, body = {}) => {
    if (!TOUCH_TYPES.includes(body.touch_type)) throw new Error('Invalid touch_type');
    const outcome = TOUCH_OUTCOMES.includes(body.outcome) ? body.outcome : 'Other';
    const when = normalizeDateInput(body.touch_date);
    return unwrap(
      await supabase
        .from('touch_log')
        .insert({
          deal_id: id,
          touch_date: when,
          touch_type: body.touch_type,
          outcome,
          notes: body.notes ?? null,
          stakeholder_id: body.stakeholder_id ? Number(body.stakeholder_id) : null,
          created_at: nowIso(),
        })
        .select('*')
        .single(),
    );
  },

  updateStageDate: async (id, historyId, entered_at) => {
    if (!entered_at) throw new Error('entered_at is required');
    unwrap(
      await supabase
        .from('stage_history')
        .update({ entered_at: normalizeDateInput(entered_at) })
        .eq('id', historyId)
        .eq('deal_id', id),
    );
    unwrap(await supabase.from('deals').update({ updated_at: nowIso() }).eq('id', id));
    return api.getDeal(id);
  },

  // ---- Deal stakeholders ----
  // Each section below is self-fetching (mirrors DealDetailPanel's Meetings
  // sub-component pattern) rather than folding into getDeal()'s payload, so
  // the full page's sections can load/refresh independently.
  listStakeholders: async (dealId) => {
    const rows = unwrap(
      await supabase
        .from('deal_stakeholders')
        .select('*')
        .eq('deal_id', dealId)
        .order('is_primary', { ascending: false })
        .order('id'),
    );
    const ids = rows.map((r) => r.id);
    const lastByStakeholder = new Map();
    if (ids.length) {
      const touches = unwrap(
        await supabase.from('touch_log').select('stakeholder_id,touch_date').in('stakeholder_id', ids),
      );
      for (const t of touches) {
        const prev = lastByStakeholder.get(t.stakeholder_id);
        if (!prev || t.touch_date > prev) lastByStakeholder.set(t.stakeholder_id, t.touch_date);
      }
    }
    return rows.map((r) => ({ ...r, last_touched: lastByStakeholder.get(r.id) ?? null }));
  },

  addStakeholder: async (dealId, body = {}) => {
    if (!body.name || !String(body.name).trim()) throw new Error('Stakeholder name is required');
    const now = nowIso();
    return unwrap(
      await supabase
        .from('deal_stakeholders')
        .insert({
          deal_id: dealId,
          name: String(body.name).trim(),
          role: STAKEHOLDER_ROLES.includes(body.role) ? body.role : 'Other',
          email: body.email ? String(body.email).trim() : null,
          linkedin: body.linkedin ? String(body.linkedin).trim() : null,
          is_primary: false,
          source_contact_id: body.source_contact_id ? Number(body.source_contact_id) : null,
          created_at: now,
          updated_at: now,
        })
        .select('*')
        .single(),
    );
  },

  updateStakeholder: async (dealId, stakeholderId, body = {}) => {
    const patch = { updated_at: nowIso() };
    if (body.name !== undefined) patch.name = String(body.name).trim();
    if (body.role !== undefined) patch.role = STAKEHOLDER_ROLES.includes(body.role) ? body.role : 'Other';
    if (body.email !== undefined) patch.email = body.email ? String(body.email).trim() : null;
    if (body.linkedin !== undefined) patch.linkedin = body.linkedin ? String(body.linkedin).trim() : null;
    unwrap(
      await supabase.from('deal_stakeholders').update(patch).eq('id', stakeholderId).eq('deal_id', dealId),
    );
  },

  // No auto-promotion of a new primary if the primary is removed — the UI
  // simply shows no primary contact until someone explicitly sets one.
  deleteStakeholder: async (dealId, stakeholderId) => {
    unwrap(
      await supabase.from('deal_stakeholders').delete().eq('id', stakeholderId).eq('deal_id', dealId),
    );
  },

  // Atomic unset-then-set via the set_primary_stakeholder() RPC (0019) so we
  // never trip the "one primary per deal" partial unique index mid-flight.
  setPrimaryStakeholder: async (dealId, stakeholderId) => {
    unwrap(
      await supabase.rpc('set_primary_stakeholder', {
        p_deal_id: dealId,
        p_stakeholder_id: stakeholderId,
      }),
    );
  },

  // ---- Deal tasks ----
  listTasks: async (dealId) => {
    return unwrap(
      await supabase
        .from('deal_tasks')
        .select('*')
        .eq('deal_id', dealId)
        .order('due_date', { ascending: true, nullsFirst: false })
        .order('id', { ascending: true }),
    );
  },

  addTask: async (dealId, body = {}) => {
    if (!body.title || !String(body.title).trim()) throw new Error('Task title is required');
    const now = nowIso();
    return unwrap(
      await supabase
        .from('deal_tasks')
        .insert({
          deal_id: dealId,
          title: String(body.title).trim(),
          owner: OWNERS.includes(body.owner) ? body.owner : null,
          due_date: body.due_date ? toDateInput(normalizeDateInput(body.due_date)) : null,
          status: 'open',
          stage_code: STAGE_CODES.includes(body.stage_code) ? body.stage_code : null,
          created_at: now,
          updated_at: now,
        })
        .select('*')
        .single(),
    );
  },

  updateTask: async (dealId, taskId, body = {}) => {
    const patch = { updated_at: nowIso() };
    if (body.title !== undefined) patch.title = String(body.title).trim();
    if (body.owner !== undefined) patch.owner = OWNERS.includes(body.owner) ? body.owner : null;
    if (body.due_date !== undefined)
      patch.due_date = body.due_date ? toDateInput(normalizeDateInput(body.due_date)) : null;
    if (body.stage_code !== undefined)
      patch.stage_code = STAGE_CODES.includes(body.stage_code) ? body.stage_code : null;
    unwrap(await supabase.from('deal_tasks').update(patch).eq('id', taskId).eq('deal_id', dealId));
  },

  completeTask: async (dealId, taskId) => {
    unwrap(
      await supabase
        .from('deal_tasks')
        .update({ status: 'done', completed_at: nowIso(), updated_at: nowIso() })
        .eq('id', taskId)
        .eq('deal_id', dealId),
    );
  },

  reopenTask: async (dealId, taskId) => {
    unwrap(
      await supabase
        .from('deal_tasks')
        .update({ status: 'open', completed_at: null, updated_at: nowIso() })
        .eq('id', taskId)
        .eq('deal_id', dealId),
    );
  },

  deleteTask: async (dealId, taskId) => {
    unwrap(await supabase.from('deal_tasks').delete().eq('id', taskId).eq('deal_id', dealId));
  },

  // ---- Deal notes ----
  listNotes: async (dealId) => {
    return unwrap(
      await supabase
        .from('deal_notes')
        .select('*')
        .eq('deal_id', dealId)
        .order('pinned', { ascending: false })
        .order('created_at', { ascending: false })
        .order('id', { ascending: false }),
    );
  },

  addNote: async (dealId, body = {}) => {
    if (!body.content_json) throw new Error('content_json is required');
    const now = nowIso();
    return unwrap(
      await supabase
        .from('deal_notes')
        .insert({
          deal_id: dealId,
          content_json: body.content_json,
          content_text: body.content_text ?? '',
          author: OWNERS.includes(body.author) ? body.author : null,
          pinned: false,
          created_at: now,
          updated_at: now,
        })
        .select('*')
        .single(),
    );
  },

  updateNote: async (dealId, noteId, body = {}) => {
    const patch = { updated_at: nowIso() };
    if (body.content_json !== undefined) patch.content_json = body.content_json;
    if (body.content_text !== undefined) patch.content_text = body.content_text;
    unwrap(await supabase.from('deal_notes').update(patch).eq('id', noteId).eq('deal_id', dealId));
  },

  pinNote: async (dealId, noteId) => {
    unwrap(
      await supabase
        .from('deal_notes')
        .update({ pinned: true, updated_at: nowIso() })
        .eq('id', noteId)
        .eq('deal_id', dealId),
    );
  },

  unpinNote: async (dealId, noteId) => {
    unwrap(
      await supabase
        .from('deal_notes')
        .update({ pinned: false, updated_at: nowIso() })
        .eq('id', noteId)
        .eq('deal_id', dealId),
    );
  },

  deleteNote: async (dealId, noteId) => {
    unwrap(await supabase.from('deal_notes').delete().eq('id', noteId).eq('deal_id', dealId));
  },

  // ---- Deal attachments ----
  // Supabase Storage is the first file-upload feature in this app; the
  // 'deal-attachments' bucket (private, 25MB cap, mime allowlist) is the real
  // server-side enforcement point, since there's no custom backend (0023).
  listAttachments: async (dealId) => {
    return unwrap(
      await supabase
        .from('deal_attachments')
        .select('*')
        .eq('deal_id', dealId)
        .order('created_at', { ascending: false }),
    );
  },

  uploadAttachment: async (dealId, file, uploadedBy) => {
    const path = `${dealId}/${crypto.randomUUID()}-${file.name}`;
    const { error: uploadError } = await supabase.storage.from('deal-attachments').upload(path, file);
    if (uploadError) throw new Error(uploadError.message);
    return unwrap(
      await supabase
        .from('deal_attachments')
        .insert({
          deal_id: dealId,
          filename: file.name,
          storage_path: path,
          file_size: file.size,
          content_type: file.type || null,
          uploaded_by: OWNERS.includes(uploadedBy) ? uploadedBy : null,
          created_at: nowIso(),
        })
        .select('*')
        .single(),
    );
  },

  getAttachmentDownloadUrl: async (attachment) => {
    const data = unwrap(
      await supabase.storage.from('deal-attachments').createSignedUrl(attachment.storage_path, 60),
    );
    return data.signedUrl;
  },

  deleteAttachment: async (dealId, attachmentId) => {
    const row = unwrap(
      await supabase
        .from('deal_attachments')
        .select('storage_path')
        .eq('id', attachmentId)
        .eq('deal_id', dealId)
        .single(),
    );
    await supabase.storage.from('deal-attachments').remove([row.storage_path]);
    unwrap(await supabase.from('deal_attachments').delete().eq('id', attachmentId).eq('deal_id', dealId));
  },

  // ---- Stage exit checklist (per-deal state) ----
  getStageChecklist: async (dealId, stageCode) => {
    const criteria = unwrap(
      await supabase
        .from('stage_exit_criteria')
        .select('*')
        .eq('stage_code', stageCode)
        .order('sort_order')
        .order('id'),
    );
    if (!criteria.length) return [];
    const state = unwrap(
      await supabase
        .from('deal_stage_checklist')
        .select('criterion_id,checked')
        .eq('deal_id', dealId)
        .in(
          'criterion_id',
          criteria.map((c) => c.id),
        ),
    );
    const checkedById = new Map(state.map((s) => [s.criterion_id, s.checked]));
    return criteria.map((c) => ({ ...c, checked: checkedById.get(c.id) ?? false }));
  },

  toggleChecklistItem: async (dealId, criterionId, checked) => {
    unwrap(
      await supabase.from('deal_stage_checklist').upsert(
        { deal_id: dealId, criterion_id: criterionId, checked, updated_at: nowIso() },
        { onConflict: 'deal_id,criterion_id' },
      ),
    );
  },

  // ---- Stage exit criteria (admin config) ----
  listStageExitCriteria: async () => {
    return unwrap(
      await supabase.from('stage_exit_criteria').select('*').order('stage_code').order('sort_order').order('id'),
    );
  },

  addStageExitCriterion: async (stageCode, label) => {
    const l = (label ?? '').toString().trim();
    if (!l) throw new Error('label is required');
    const now = nowIso();
    return unwrap(
      await supabase
        .from('stage_exit_criteria')
        .insert({ stage_code: stageCode, label: l, sort_order: 0, created_at: now, updated_at: now })
        .select('*')
        .single(),
    );
  },

  updateStageExitCriterion: async (id, body = {}) => {
    const patch = { updated_at: nowIso() };
    if (body.label !== undefined) patch.label = String(body.label).trim();
    unwrap(await supabase.from('stage_exit_criteria').update(patch).eq('id', id));
  },

  // Cascades deal_stage_checklist rows for this criterion (FK on delete cascade).
  deleteStageExitCriterion: async (id) => {
    unwrap(await supabase.from('stage_exit_criteria').delete().eq('id', id));
  },

  reorderStageExitCriteria: async (stageCode, orderedIds) => {
    for (let i = 0; i < orderedIds.length; i++) {
      unwrap(
        await supabase
          .from('stage_exit_criteria')
          .update({ sort_order: i, updated_at: nowIso() })
          .eq('id', orderedIds[i])
          .eq('stage_code', stageCode),
      );
    }
  },

  // ---- Deal health config (admin) ----
  getHealthConfig: async () => {
    const threshold = await getHealthThreshold();
    return { stale_days_threshold: threshold };
  },

  saveHealthConfig: async (value = {}) => {
    const n = Number(value.stale_days_threshold);
    const patch = { stale_days_threshold: Number.isFinite(n) && n > 0 ? Math.round(n) : DEFAULT_HEALTH_THRESHOLD_DAYS };
    unwrap(
      await supabase
        .from('app_settings')
        .upsert({ key: 'deal_health', value: patch, updated_at: nowIso() }, { onConflict: 'key' }),
    );
    healthConfigCache = patch; // write straight to the cache, no refetch needed
    return patch;
  },

  // ---- Activity timeline (merged feed) ----
  // Structural twin of getCompanyActivity() below: merge every heterogeneous
  // source into one { kind, id, date, ... } array, sorted newest-first.
  getDealActivity: async (dealId) => {
    const [history, touches, stakeholders, notes, tasks, attachments] = await Promise.all([
      supabase.from('stage_history').select('*').eq('deal_id', dealId),
      supabase.from('touch_log').select('*').eq('deal_id', dealId),
      supabase.from('deal_stakeholders').select('id,name').eq('deal_id', dealId),
      supabase.from('deal_notes').select('*').eq('deal_id', dealId),
      supabase.from('deal_tasks').select('*').eq('deal_id', dealId).not('completed_at', 'is', null),
      supabase.from('deal_attachments').select('*').eq('deal_id', dealId),
    ]);

    const nameByStakeholder = new Map(unwrap(stakeholders).map((s) => [s.id, s.name]));
    const items = [];

    for (const h of unwrap(history)) {
      items.push({ kind: 'stage', id: `st${h.id}`, date: h.entered_at, stage: h.stage });
    }
    for (const t of unwrap(touches)) {
      items.push({
        kind: 'touch',
        id: `t${t.id}`,
        date: t.touch_date,
        touch_type: t.touch_type,
        outcome: t.outcome,
        notes: t.notes,
        source: t.source,
        stakeholder_name: t.stakeholder_id ? nameByStakeholder.get(t.stakeholder_id) ?? null : null,
      });
    }
    for (const n of unwrap(notes)) {
      items.push({
        kind: 'note',
        id: `n${n.id}`,
        date: n.created_at,
        content_text: n.content_text,
        author: n.author,
        pinned: n.pinned,
      });
    }
    for (const task of unwrap(tasks)) {
      items.push({ kind: 'task', id: `tk${task.id}`, date: task.completed_at, title: task.title, owner: task.owner });
    }
    for (const a of unwrap(attachments)) {
      items.push({
        kind: 'file',
        id: `f${a.id}`,
        date: a.created_at,
        filename: a.filename,
        uploaded_by: a.uploaded_by,
      });
    }

    items.sort((a, b) => {
      const ta = a.date ? new Date(a.date).getTime() : 0;
      const tb = b.date ? new Date(b.date).getTime() : 0;
      return tb - ta;
    });
    return items;
  },

  // ---- Leads ----
  listLeads: async () => {
    const configs = await loadConfigs();
    const leads = unwrap(
      await supabase.from('leads').select('*, vertical:verticals(name)').order('score', { ascending: false }),
    );
    const allSignals = unwrap(await supabase.from('lead_signals').select('lead_id,signal_key,value,notes'));
    const allContacts = unwrap(await supabase.from('lead_contacts').select('lead_id'));

    const signalsByLead = new Map();
    for (const s of allSignals) {
      if (!signalsByLead.has(s.lead_id)) signalsByLead.set(s.lead_id, {});
      signalsByLead.get(s.lead_id)[s.signal_key] = { value: s.value, notes: s.notes };
    }
    const countByLead = new Map();
    for (const c of allContacts) countByLead.set(c.lead_id, (countByLead.get(c.lead_id) ?? 0) + 1);

    return leads.map((l) =>
      buildLeadSummary(
        { ...l, vertical_name: l.vertical?.name ?? null },
        configs,
        signalsByLead.get(l.id) ?? {},
        countByLead.get(l.id) ?? 0,
      ),
    );
  },

  getLead: async (id) => {
    const lead = unwrap(
      await supabase.from('leads').select('*, vertical:verticals(name)').eq('id', id).single(),
    );
    const configs = await loadConfigs();
    const signalMap = await loadSignalMap(id);
    const contacts = unwrap(
      await supabase.from('lead_contacts').select('*').eq('lead_id', id).order('id'),
    );
    const { breakdown } = calculateScore(configs, signalMap, contacts.length);
    return {
      ...buildLeadSummary({ ...lead, vertical_name: lead.vertical?.name ?? null }, configs, signalMap, contacts.length),
      // buildLeadSummary returns only card fields; the panel also needs the raw
      // company columns (and the Apollo enrichment fields) to display + edit.
      hq_location: lead.hq_location ?? null,
      headcount: lead.headcount ?? null,
      description: lead.description ?? null,
      status: lead.status ?? null,
      domain: lead.domain ?? null,
      industry: lead.industry ?? null,
      estimated_revenue: lead.estimated_revenue ?? null,
      founded_year: lead.founded_year ?? null,
      technologies: lead.technologies ?? null,
      enriched_at: lead.enriched_at ?? null,
      enriched_source: lead.enriched_source ?? null,
      everflow_advertiser_id: lead.everflow_advertiser_id ?? null,
      signals: signalMap,
      contacts,
      points: breakdown,
    };
  },

  createLead: async (body = {}) => {
    if (!body.company_name || !String(body.company_name).trim()) {
      throw new Error('company_name is required');
    }
    let verticalId = body.vertical_id ?? null;
    if (!verticalId && body.vertical_name && String(body.vertical_name).trim()) {
      verticalId = await resolveVertical(String(body.vertical_name).trim());
    }
    const now = nowIso();
    const id = unwrap(
      await supabase
        .from('leads')
        .insert({
          company_name: String(body.company_name).trim(),
          vertical_id: verticalId,
          website: body.website ?? null,
          hq_location: body.hq_location ?? null,
          headcount: body.headcount ?? null,
          description: body.description ?? null,
          status: COMPANY_STATUSES.includes(body.status) ? body.status : null,
          is_client: !!body.is_client,
          score: 0,
          score_updated_at: now,
          in_pipeline: false,
          created_at: now,
          updated_at: now,
        })
        .select('id')
        .single(),
    ).id;
    return leadSummaryById(id);
  },

  updateLead: async (id, body = {}) => {
    const patch = { updated_at: nowIso() };
    if (body.company_name !== undefined) patch.company_name = String(body.company_name).trim();
    if (body.website !== undefined) patch.website = body.website;
    if (body.vertical_id !== undefined) patch.vertical_id = body.vertical_id;
    if (body.hq_location !== undefined) patch.hq_location = body.hq_location;
    if (body.headcount !== undefined) patch.headcount = body.headcount;
    if (body.description !== undefined) patch.description = body.description;
    if (body.status !== undefined) patch.status = COMPANY_STATUSES.includes(body.status) ? body.status : null;
    if (body.is_client !== undefined) patch.is_client = !!body.is_client;
    // Apollo-enriched fields a user can correct by hand.
    if (body.industry !== undefined) patch.industry = body.industry || null;
    if (body.estimated_revenue !== undefined) {
      const n = Number(body.estimated_revenue);
      patch.estimated_revenue = Number.isFinite(n) && n > 0 ? Math.round(n) : null;
    }
    if (body.founded_year !== undefined) {
      const y = Number(body.founded_year);
      patch.founded_year = Number.isFinite(y) && y > 0 ? Math.round(y) : null;
    }
    if (body.everflow_advertiser_id !== undefined) {
      patch.everflow_advertiser_id = body.everflow_advertiser_id
        ? String(body.everflow_advertiser_id).trim()
        : null;
    }
    unwrap(await supabase.from('leads').update(patch).eq('id', id));
    return leadSummaryById(id);
  },

  deleteLead: async (id) => {
    unwrap(await supabase.from('leads').delete().eq('id', id));
    return { deleted: true };
  },

  setSignal: async (id, key, body = {}) => {
    unwrap(
      await supabase.from('lead_signals').upsert(
        {
          lead_id: id,
          signal_key: key,
          value: body.value ?? null,
          notes: body.notes ?? null,
          updated_at: nowIso(),
        },
        { onConflict: 'lead_id,signal_key' },
      ),
    );
    const score = await rescoreLead(id);
    return { ...(await leadSummaryById(id)), score };
  },

  clearSignal: async (id, key) => {
    unwrap(await supabase.from('lead_signals').delete().eq('lead_id', id).eq('signal_key', key));
    const score = await rescoreLead(id);
    return { ...(await leadSummaryById(id)), score };
  },

  addContact: async (id, body = {}) => {
    if (!body.name || !String(body.name).trim()) throw new Error('Contact name is required');
    unwrap(
      await supabase.from('lead_contacts').insert({
        lead_id: id,
        name: String(body.name).trim(),
        title: body.title ?? null,
        linkedin: body.linkedin ?? null,
        email: body.email ?? null,
        phone: body.phone ?? null,
        location: body.location ?? null,
        seniority: body.seniority ?? null,
        notes: body.notes ?? null,
        created_at: nowIso(),
      }),
    );
    const score = await rescoreLead(id);
    const contacts = unwrap(await supabase.from('lead_contacts').select('*').eq('lead_id', id).order('id'));
    return { ...(await leadSummaryById(id)), score, contacts };
  },

  updateContact: async (id, contactId, body = {}) => {
    const patch = {};
    for (const k of ['name', 'title', 'linkedin', 'email', 'phone', 'location', 'seniority', 'notes']) {
      if (body[k] !== undefined) patch[k] = body[k] === '' ? null : body[k];
    }
    unwrap(
      await supabase.from('lead_contacts').update(patch).eq('id', contactId).eq('lead_id', id),
    );
    const contacts = unwrap(await supabase.from('lead_contacts').select('*').eq('lead_id', id).order('id'));
    return { ...(await leadSummaryById(id)), contacts };
  },

  deleteContact: async (id, contactId) => {
    unwrap(await supabase.from('lead_contacts').delete().eq('id', contactId).eq('lead_id', id));
    const score = await rescoreLead(id);
    const contacts = unwrap(await supabase.from('lead_contacts').select('*').eq('lead_id', id).order('id'));
    return { ...(await leadSummaryById(id)), score, contacts };
  },

  startLeadOutreach: async (id) => {
    const dealId = unwrap(await supabase.rpc('start_outreach', { p_lead_id: id }));
    return { ...(await leadSummaryById(id)), deal_id: dealId };
  },

  // Enrich a company from Apollo via the apollo-enrich Edge Function (which holds
  // the API key server-side), then recompute the score client-side so any
  // enriched scoring signals (revenue, recent_funding) take effect immediately.
  enrichLead: async (id, { force = false } = {}) => {
    const data = await invokeEnrich({ kind: 'company', leadId: id, force });
    if (data.skipped) return leadSummaryById(id); // already enriched, no credit spent
    if (!data.matched) {
      const e = new Error(data.reason || 'No Apollo match found for this company.');
      e.code = 'no_match';
      throw e;
    }
    const score = await rescoreLead(id);
    return { ...(await leadSummaryById(id)), score };
  },

  // How many companies would actually spend a credit on "Enrich all": not yet
  // enriched AND has a domain or website. Mirrors the function's credit guards.
  enrichableLeadCount: async () => {
    const rows = unwrap(await supabase.from('leads').select('id, website, domain, enriched_at'));
    return rows.filter((l) => isEnrichableLead(l)).length;
  },

  // Enrich every eligible company sequentially (respects rate limits; stops on a
  // rate-limit hit). Already-enriched/identifier-less leads are filtered out so
  // no credit is wasted. onProgress({ done, total, ...summary }) for live UI.
  enrichAllLeads: async ({ onProgress } = {}) => {
    const rows = unwrap(await supabase.from('leads').select('id, website, domain, enriched_at'));
    const eligible = rows.filter((l) => isEnrichableLead(l));
    const summary = { total: eligible.length, done: 0, enriched: 0, noMatch: 0, failed: 0, stopped: false };
    for (const l of eligible) {
      try {
        await api.enrichLead(l.id); // invokes + rescores; no force
        summary.enriched += 1;
      } catch (e) {
        if (e.code === 'rate_limited') { summary.stopped = true; break; }
        if (e.code === 'no_match') summary.noMatch += 1;
        else summary.failed += 1;
      }
      summary.done += 1;
      onProgress?.({ ...summary });
    }
    return summary;
  },

  // ---- People ----
  // Flat list of every contact across all companies, enriched with the parent
  // company name + vertical and outreach rollups (last_touch_at, touch_count).
  // Powers the People roster.
  listContacts: async () => {
    const rows = unwrap(
      await supabase
        .from('lead_contacts')
        .select('*, lead:leads(id, company_name, vertical_id)')
        .order('id', { ascending: false }),
    );
    const touches = unwrap(await supabase.from('contact_touches').select('contact_id,touch_date'));
    const lastByContact = new Map();
    const countByContact = new Map();
    for (const t of touches) {
      countByContact.set(t.contact_id, (countByContact.get(t.contact_id) ?? 0) + 1);
      const prev = lastByContact.get(t.contact_id);
      if (!prev || t.touch_date > prev) lastByContact.set(t.contact_id, t.touch_date);
    }
    return rows.map((c) => ({
      ...c,
      company_name: c.lead?.company_name ?? null,
      vertical_id: c.lead?.vertical_id ?? null,
      last_touch_at: lastByContact.get(c.id) ?? null,
      touch_count: countByContact.get(c.id) ?? 0,
    }));
  },

  // Full person record: profile + parent company + complete outreach history.
  getContact: async (contactId) => {
    const contact = unwrap(
      await supabase
        .from('lead_contacts')
        .select('*, lead:leads(id, company_name, in_pipeline, deal_id)')
        .eq('id', contactId)
        .single(),
    );
    const touches = unwrap(
      await supabase
        .from('contact_touches')
        .select('*')
        .eq('contact_id', contactId)
        .order('touch_date', { ascending: false })
        .order('id', { ascending: false }),
    );
    return {
      ...contact,
      company_name: contact.lead?.company_name ?? null,
      in_pipeline: contact.lead?.in_pipeline ?? false,
      deal_id: contact.lead?.deal_id ?? null,
      touches,
    };
  },

  addContactTouch: async (contactId, body = {}) => {
    if (!TOUCH_TYPES.includes(body.touch_type)) throw new Error('Invalid touch_type');
    const outcome = TOUCH_OUTCOMES.includes(body.outcome) ? body.outcome : 'Other';
    const owner = OWNERS.includes(body.owner) ? body.owner : null;
    const when = normalizeDateInput(body.touch_date);
    unwrap(
      await supabase.from('contact_touches').insert({
        contact_id: contactId,
        touch_date: when,
        touch_type: body.touch_type,
        outcome,
        owner,
        notes: body.notes ?? null,
        created_at: nowIso(),
      }),
    );
    return api.getContact(contactId);
  },

  deleteContactTouch: async (contactId, touchId) => {
    unwrap(
      await supabase.from('contact_touches').delete().eq('id', touchId).eq('contact_id', contactId),
    );
    return api.getContact(contactId);
  },

  // Unified company activity feed: every person's touches + the deal's
  // touch_log + calendar meetings, merged and sorted newest-first. Each item is
  // { kind: 'person'|'deal'|'meeting', date, ... } for CompanyProfile's
  // Activity section.
  getCompanyActivity: async (leadId) => {
    const lead = unwrap(
      await supabase.from('leads').select('deal_id').eq('id', leadId).single(),
    );
    const contacts = unwrap(
      await supabase.from('lead_contacts').select('id,name').eq('lead_id', leadId),
    );
    const nameById = new Map(contacts.map((c) => [c.id, c.name]));
    const contactIds = contacts.map((c) => c.id);

    const items = [];

    if (contactIds.length) {
      const ptouches = unwrap(
        await supabase.from('contact_touches').select('*').in('contact_id', contactIds),
      );
      for (const t of ptouches) {
        items.push({
          kind: 'person',
          id: `p${t.id}`,
          date: t.touch_date,
          contact_name: nameById.get(t.contact_id) ?? null,
          touch_type: t.touch_type,
          outcome: t.outcome,
          owner: t.owner,
          notes: t.notes,
          source: t.source,
        });
      }
    }

    if (lead.deal_id) {
      const [dtouches, meets] = await Promise.all([
        supabase.from('touch_log').select('*').eq('deal_id', lead.deal_id),
        supabase.from('meetings').select('*').eq('deal_id', lead.deal_id),
      ]);
      for (const t of unwrap(dtouches)) {
        items.push({
          kind: 'deal',
          id: `d${t.id}`,
          date: t.touch_date,
          touch_type: t.touch_type,
          outcome: t.outcome,
          notes: t.notes,
          source: t.source,
        });
      }
      for (const m of unwrap(meets)) {
        items.push({
          kind: 'meeting',
          id: `m${m.id}`,
          date: m.starts_at ?? m.created_at,
          title: m.title,
          status: m.status,
        });
      }
    }

    items.sort((a, b) => {
      const ta = a.date ? new Date(a.date).getTime() : 0;
      const tb = b.date ? new Date(b.date).getTime() : 0;
      return tb - ta;
    });
    return items;
  },

  // Enrich a person from Apollo (title, seniority, email, phone, LinkedIn,
  // location) via the apollo-enrich Edge Function. Returns the refreshed record.
  enrichContact: async (contactId, { force = false } = {}) => {
    const data = await invokeEnrich({ kind: 'person', contactId, force });
    if (data.skipped) return api.getContact(contactId); // already enriched, no credit spent
    if (!data.matched) {
      const e = new Error(data.reason || 'No Apollo match found for this person.');
      e.code = 'no_match';
      throw e;
    }
    return api.getContact(contactId);
  },

  // How many people would spend a credit on "Enrich all": not yet enriched AND
  // have an email or LinkedIn. Mirrors the function's credit guards.
  enrichableContactCount: async () => {
    const rows = unwrap(await supabase.from('lead_contacts').select('id, email, linkedin, enriched_at'));
    return rows.filter((c) => isEnrichableContact(c)).length;
  },

  // Enrich every eligible person sequentially (stops on a rate-limit hit).
  enrichAllContacts: async ({ onProgress } = {}) => {
    const rows = unwrap(await supabase.from('lead_contacts').select('id, email, linkedin, enriched_at'));
    const eligible = rows.filter((c) => isEnrichableContact(c));
    const summary = { total: eligible.length, done: 0, enriched: 0, noMatch: 0, failed: 0, stopped: false };
    for (const c of eligible) {
      try {
        await api.enrichContact(c.id); // no force
        summary.enriched += 1;
      } catch (e) {
        if (e.code === 'rate_limited') { summary.stopped = true; break; }
        if (e.code === 'no_match') summary.noMatch += 1;
        else summary.failed += 1;
      }
      summary.done += 1;
      onProgress?.({ ...summary });
    }
    return summary;
  },

  // ---- Verticals ----
  listVerticals: async () => {
    const verticals = unwrap(
      await supabase.from('verticals').select('*').order('position', { ascending: true }).order('name'),
    );
    const leads = unwrap(await supabase.from('leads').select('vertical_id'));
    const counts = new Map();
    for (const l of leads) if (l.vertical_id != null) counts.set(l.vertical_id, (counts.get(l.vertical_id) ?? 0) + 1);
    return verticals.map((v) => ({ ...v, lead_count: counts.get(v.id) ?? 0 }));
  },

  createVertical: async (name) => {
    const n = (name ?? '').toString().trim();
    if (!n) throw new Error('name is required');
    const id = await resolveVertical(n);
    return unwrap(await supabase.from('verticals').select('*').eq('id', id).single());
  },

  updateVertical: async (id, { name } = {}) => {
    const n = (name ?? '').toString().trim();
    if (!n) throw new Error('name is required');
    unwrap(await supabase.from('verticals').update({ name: n }).eq('id', id));
    return unwrap(await supabase.from('verticals').select('*').eq('id', id).single());
  },

  // Companies keep their rows — the leads.vertical_id FK is ON DELETE SET NULL,
  // so they fall back to "Unsorted" rather than being deleted.
  deleteVertical: async (id) => {
    unwrap(await supabase.from('verticals').delete().eq('id', id));
  },

  // Persist a manual vertical order: each id's index becomes its position.
  reorderVerticals: async (orderedIds) => {
    for (let i = 0; i < orderedIds.length; i++) {
      unwrap(await supabase.from('verticals').update({ position: i }).eq('id', orderedIds[i]));
    }
  },

  // ---- Scoring config ----
  getScoringConfig: async () => {
    const rows = unwrap(
      await supabase.from('scoring_config').select('*').order('sort_order').order('id'),
    );
    return { categories: CATEGORY_ORDER, signals: rows.map(enrichConfig) };
  },

  saveScoringConfig: async (updates) => {
    if (!Array.isArray(updates)) throw new Error('updates array is required');
    const now = nowIso();
    await Promise.all(
      updates.map((u) => {
        const patch = { updated_at: now };
        if (u.max_points != null && Number.isFinite(Number(u.max_points)))
          patch.max_points = Math.max(0, Math.round(Number(u.max_points)));
        if (u.options !== undefined) patch.options = u.options;
        return supabase
          .from('scoring_config')
          .update(patch)
          .eq('signal_key', u.signal_key)
          .then(({ error }) => {
            if (error) throw new Error(error.message);
          });
      }),
    );
    const rescored = await rescoreAllLeadsInternal();
    return { saved: true, rescored };
  },

  rescoreAllLeads: async () => ({ rescored: await rescoreAllLeadsInternal() }),

  // ---- Ad tracker (per-client creator-ad pipeline) ----
  // current_stage is trigger-synced from ad_item_stage_history inserts (see
  // migration 0030); ad_item_summaries exposes current_stage_entered_at +
  // approved_at (SLA clock start) so the client never recomputes those from
  // full history unless editing a past date.
  listAdItems: async (leadId) => {
    return unwrap(
      await supabase
        .from('ad_item_summaries')
        .select('*')
        .eq('lead_id', leadId)
        .order('created_at', { ascending: false }),
    );
  },

  addAdItem: async (leadId, body = {}) => {
    if (!body.creator_link || !String(body.creator_link).trim()) {
      throw new Error('Creator link is required');
    }
    const now = nowIso();
    const id = unwrap(
      await supabase
        .from('ad_items')
        .insert({
          lead_id: leadId,
          creator_link: normalizeCreatorLink(body.creator_link),
          platform: PLATFORMS.includes(body.platform) ? body.platform : null,
          creator_owner: OWNERS.includes(body.creator_owner) ? body.creator_owner : null,
          brand_owner: OWNERS.includes(body.brand_owner) ? body.brand_owner : null,
          notes: body.notes ? String(body.notes).trim() : null,
          current_stage: 'submitted',
          created_at: now,
          updated_at: now,
        })
        .select('id')
        .single(),
    ).id;
    unwrap(
      await supabase
        .from('ad_item_stage_history')
        .insert({ ad_item_id: id, stage: 'submitted', entered_at: now }),
    );
    return fetchAdItemSummary(id);
  },

  updateAdItem: async (id, body = {}) => {
    const patch = { updated_at: nowIso() };
    if (body.creator_link !== undefined) patch.creator_link = normalizeCreatorLink(body.creator_link);
    if (body.platform !== undefined)
      patch.platform = PLATFORMS.includes(body.platform) ? body.platform : null;
    if (body.creator_owner !== undefined)
      patch.creator_owner = OWNERS.includes(body.creator_owner) ? body.creator_owner : null;
    if (body.brand_owner !== undefined)
      patch.brand_owner = OWNERS.includes(body.brand_owner) ? body.brand_owner : null;
    if (body.notes !== undefined) patch.notes = body.notes ? String(body.notes).trim() : null;
    unwrap(await supabase.from('ad_items').update(patch).eq('id', id));
    return fetchAdItemSummary(id);
  },

  setAdItemStage: async (id, stage) => {
    if (!AD_STAGE_CODES.includes(stage)) throw new Error('Invalid ad stage code');
    unwrap(
      await supabase.from('ad_item_stage_history').insert({ ad_item_id: id, stage, entered_at: nowIso() }),
    );
    return fetchAdItemSummary(id);
  },

  getAdItemHistory: async (id) => {
    return unwrap(
      await supabase
        .from('ad_item_stage_history')
        .select('id,stage,entered_at')
        .eq('ad_item_id', id)
        .order('id'),
    );
  },

  updateAdStageDate: async (id, historyId, entered_at) => {
    if (!entered_at) throw new Error('entered_at is required');
    unwrap(
      await supabase
        .from('ad_item_stage_history')
        .update({ entered_at: normalizeDateInput(entered_at) })
        .eq('id', historyId)
        .eq('ad_item_id', id),
    );
    unwrap(await supabase.from('ad_items').update({ updated_at: nowIso() }).eq('id', id));
    return fetchAdItemSummary(id);
  },

  deleteAdItem: async (id) => {
    unwrap(await supabase.from('ad_items').delete().eq('id', id));
  },

  // ---- Spend & Goals (Everflow) ----
  listSpendGoals: async (leadId) => {
    return unwrap(
      await supabase
        .from('client_spend_goals')
        .select('*')
        .eq('lead_id', leadId)
        .order('month', { ascending: false }),
    );
  },

  // One row per (lead, month) — upsert on the unique constraint.
  upsertSpendGoal: async (leadId, month, goalAmount) => {
    const n = Number(goalAmount);
    unwrap(
      await supabase.from('client_spend_goals').upsert(
        {
          lead_id: leadId,
          month,
          goal_amount: Number.isFinite(n) ? Math.round(n) : 0,
          updated_at: nowIso(),
        },
        { onConflict: 'lead_id,month' },
      ),
    );
    return api.listSpendGoals(leadId);
  },

  listSpendActuals: async (leadId) => {
    return unwrap(
      await supabase
        .from('client_spend_actuals')
        .select('*')
        .eq('lead_id', leadId)
        .order('month', { ascending: false }),
    );
  },

  // Sync one month (default: current) from Everflow via the everflow-sync
  // Edge Function, which holds the API key server-side — mirrors enrichLead.
  syncSpendActuals: async (leadId, { month, force = false } = {}) => {
    const data = await invokeEverflowSync({ leadId, month, force });
    if (!data.matched) {
      const e = new Error(data.reason || 'No Everflow data returned.');
      e.code = 'no_match';
      throw e;
    }
    return api.listSpendActuals(leadId);
  },
};

// Invoke the apollo-enrich Edge Function and normalize its response. Throws a
// readable Error for transport failures and handled Apollo conditions
// (rate-limited, plan-gated, auth); returns the { matched, ... } payload on ok.
async function invokeEnrich(body) {
  const { data, error } = await supabase.functions.invoke('apollo-enrich', { body });
  if (error) {
    // The function returns { ok:false, error, message } in `data` even on a
    // non-2xx; prefer that message when present.
    const e = new Error(data?.message || 'Enrichment service unavailable.');
    e.code = data?.error || 'transport';
    throw e;
  }
  if (!data?.ok) {
    const map = {
      rate_limited: 'Apollo rate limit reached — try again shortly.',
      plan_gated: "This enrichment isn't available on your Apollo plan.",
    };
    const e = new Error(data?.message || map[data?.error] || 'Enrichment failed.');
    e.code = data?.error || 'enrich_failed';
    throw e;
  }
  return data;
}

// Invoke the everflow-sync Edge Function and normalize its response, same
// shape as invokeEnrich.
async function invokeEverflowSync(body) {
  const { data, error } = await supabase.functions.invoke('everflow-sync', { body });
  if (error) {
    const e = new Error(data?.message || 'Everflow sync service unavailable.');
    e.code = data?.error || 'transport';
    throw e;
  }
  if (!data?.ok) {
    const map = { rate_limited: 'Everflow rate limit reached — try again shortly.' };
    const e = new Error(data?.message || map[data?.error] || 'Everflow sync failed.');
    e.code = data?.error || 'sync_failed';
    throw e;
  }
  return data;
}

// Eligibility for bulk enrich — mirrors the Edge Function's credit guards so we
// never queue a call that would be skipped or rejected server-side.
const notEmpty = (v) => v != null && String(v).trim() !== '';
function isEnrichableLead(l) {
  return !l.enriched_at && (notEmpty(l.domain) || notEmpty(l.website));
}
function isEnrichableContact(c) {
  return !c.enriched_at && (notEmpty(c.email) || notEmpty(c.linkedin));
}

// Create-or-get a vertical by name, returning its id.
async function resolveVertical(name) {
  const existing = unwrap(await supabase.from('verticals').select('id').eq('name', name).maybeSingle());
  if (existing) return existing.id;
  return unwrap(
    await supabase.from('verticals').insert({ name, created_at: nowIso() }).select('id').single(),
  ).id;
}
