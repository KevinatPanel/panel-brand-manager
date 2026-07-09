// ---------------------------------------------------------------------------
// Gmail / Calendar integration data layer. Mirrors api.js conventions: thin
// wrappers over supabase-js that throw on error and return plain data.
//
// Tokens never touch the browser — the OAuth code exchange happens entirely in
// the google-oauth-callback Edge Function. Here we only (a) ask the start
// function for a consent URL, (b) read the token-free status view, and (c) read
// + resolve the per-user suggestion queue / meetings.
// ---------------------------------------------------------------------------
import { supabase } from './supabaseClient.js';

function unwrap({ data, error }) {
  if (error) throw new Error(error.message || 'Request failed');
  return data;
}

const nowIso = () => new Date().toISOString();

export const gmail = {
  // Token-free connection status (gmail_connection_status view). Null if never connected.
  async getStatus() {
    const { data, error } = await supabase
      .from('gmail_connection_status')
      .select('*')
      .maybeSingle();
    if (error) throw new Error(error.message || 'Request failed');
    return data;
  },

  // Kick off OAuth: the Edge Function returns a Google consent URL.
  async startConnect() {
    const { data, error } = await supabase.functions.invoke('google-oauth-start', { method: 'POST' });
    if (error) throw new Error(error.message || 'Could not start Gmail connect');
    if (!data?.url) throw new Error('No consent URL returned');
    return data.url;
  },

  // --- Review queue ---
  async listSuggestions() {
    return unwrap(
      await supabase
        .from('email_suggestions')
        .select('*')
        .eq('status', 'pending')
        .order('first_seen_at', { ascending: false }),
    );
  },

  async pendingCount() {
    // Badge spans both queues: deal suggestions + company (people) suggestions.
    const [deals, companies] = await Promise.all([
      supabase.from('email_suggestions').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('company_suggestions').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    ]);
    if (deals.error) throw new Error(deals.error.message || 'Request failed');
    if (companies.error) throw new Error(companies.error.message || 'Request failed');
    return (deals.count ?? 0) + (companies.count ?? 0);
  },

  // --- Inbox scan (people + companies backfill) ---
  async startInboxScan() {
    const { data, error } = await supabase.functions.invoke('gmail-scan-start', { method: 'POST' });
    if (error) throw new Error(error.message || 'Could not start inbox scan');
    return data; // { status: 'queued' }
  },

  // The rep's scan job row (progress), or null if never scanned.
  async scanStatus() {
    const { data, error } = await supabase
      .from('gmail_scan_jobs')
      .select('*')
      .maybeSingle();
    if (error) throw new Error(error.message || 'Request failed');
    return data;
  },

  // Pending company suggestions, each with its (pending) proposed people.
  async listCompanySuggestions() {
    const rows = unwrap(
      await supabase
        .from('company_suggestions')
        .select('*, contacts:contact_suggestions(*)')
        .eq('status', 'pending')
        .order('first_seen_at', { ascending: false }),
    );
    // Keep only still-pending people; surface two-way (replied) relationships first.
    return (rows ?? []).map((c) => ({
      ...c,
      contacts: (c.contacts ?? [])
        .filter((p) => p.status === 'pending')
        .sort((a, b) => Number(b.two_way) - Number(a.two_way)),
    }));
  },

  // Approve a company + the selected people (null = all pending people). Atomic RPC.
  async acceptCompanySuggestion(id, contactIds = null) {
    const { data, error } = await supabase.rpc('accept_company_suggestion', {
      p_company_suggestion_id: id,
      p_contact_ids: contactIds,
    });
    if (error) throw new Error(error.message);
    return data; // lead id
  },

  async rejectCompanySuggestion(id) {
    const { error } = await supabase.rpc('reject_company_suggestion', { p_company_suggestion_id: id });
    if (error) throw new Error(error.message);
  },

  async rejectContactSuggestion(id) {
    const { error } = await supabase.rpc('reject_contact_suggestion', { p_contact_suggestion_id: id });
    if (error) throw new Error(error.message);
  },

  // Accept a suggestion as a brand-new deal (atomic RPC: deal + S1 + thread link).
  async acceptSuggestionAsDeal(id, brandName) {
    const { data, error } = await supabase.rpc('accept_email_suggestion_as_deal', {
      p_suggestion_id: id,
      p_brand_name: brandName ?? null,
    });
    if (error) throw new Error(error.message);
    return data; // new deal id
  },

  // Attach a suggestion's thread to an existing deal.
  async attachSuggestionToDeal(id, dealId) {
    const sug = unwrap(await supabase.from('email_suggestions').select('*').eq('id', id).single());
    unwrap(
      await supabase.from('deal_email_links').upsert(
        {
          deal_id: dealId,
          thread_id: sug.thread_id,
          contact_email: sug.contact_email,
          contact_domain: sug.contact_domain,
          created_by: sug.user_id,
        },
        { onConflict: 'deal_id,thread_id', ignoreDuplicates: true },
      ),
    );
    unwrap(
      await supabase
        .from('email_suggestions')
        .update({ status: 'accepted', resolved_at: nowIso(), proposed_deal_id: dealId })
        .eq('id', id),
    );
    return dealId;
  },

  // Accept a stage-move suggestion (reply received → advance the deal's stage).
  async acceptStageMove(id) {
    const { data, error } = await supabase.rpc('accept_stage_move_suggestion', {
      p_suggestion_id: id,
    });
    if (error) throw new Error(error.message);
    return data; // deal id
  },

  async dismissSuggestion(id) {
    unwrap(
      await supabase
        .from('email_suggestions')
        .update({ status: 'dismissed', resolved_at: nowIso() })
        .eq('id', id),
    );
  },

  // Ignore a domain forever (per-rep) and clear any pending suggestions from it.
  async ignoreDomain(domain) {
    const { data: u } = await supabase.auth.getUser();
    unwrap(
      await supabase
        .from('email_domain_rules')
        .upsert({ user_id: u?.user?.id, domain, rule: 'ignore' }, { onConflict: 'user_id,domain' }),
    );
    unwrap(
      await supabase
        .from('email_suggestions')
        .update({ status: 'dismissed', resolved_at: nowIso() })
        .eq('contact_domain', domain)
        .eq('status', 'pending'),
    );
  },

  // Toggle this rep's "auto-advance S1→S2 on reply" preference.
  async setAutoAdvance(value) {
    const { error } = await supabase.rpc('set_gmail_auto_advance', { p_value: !!value });
    if (error) throw new Error(error.message);
  },

  // Fetch a full Gmail thread (live) for the conversation panel. The body is
  // never stored in our DB and the browser has no Gmail token, so an Edge
  // Function fetches + extracts it. Returns { messages: [{from,to,date,subject,body}] }
  // or { error: 'needs_reauth' } when the connection predates the readonly scope.
  async getThread(threadId) {
    const { data, error } = await supabase.functions.invoke('gmail-thread', {
      method: 'POST',
      body: { thread_id: threadId },
    });
    if (error) throw new Error(error.message || 'Could not load conversation');
    return data;
  },

  // --- Deal-scoped reads for the detail panel ---
  async listDealMeetings(dealId) {
    return unwrap(
      await supabase
        .from('meetings')
        .select('*')
        .eq('deal_id', dealId)
        .order('starts_at', { ascending: false }),
    );
  },
};
