// apollo-enrich: called by the authenticated client (functions.invoke). Verifies
// the rep's JWT, then enriches one company (leads) or one person (lead_contacts)
// from Apollo and writes the mapped fields back via the service-role client.
//
// For a company it also upserts the `lead_signals` the scoring rubric already
// understands (revenue, recent_funding) so the lead's score picks them up — the
// client triggers the client-side rescore after this returns (api.enrichLead).
//
// Response contract (so the client stays simple): handled outcomes return HTTP
// 200 with { ok, matched, ... }; only auth/bad-input/unexpected use non-2xx.
//   - matched:   { ok:true, matched:true, fields:{...}, signals:[...] }
//   - no match:  { ok:true, matched:false, reason }
//   - apollo err:{ ok:false, error:'rate_limited'|'plan_gated'|'apollo_error', message }
import { serviceClient, userFromRequest } from "../_shared/supabase.ts";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  ApolloError,
  domainFromWebsite,
  enrichOrganization,
  enrichPerson,
} from "../_shared/apollo.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// nullish/empty string -> treat as "field not set" so we don't clobber manual
// edits with blanks, but still fill empty fields from Apollo.
function isEmpty(v: unknown): boolean {
  return v == null || (typeof v === "string" && v.trim() === "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const user = await userFromRequest(req);
  if (!user) return json({ ok: false, error: "unauthorized" }, 401);

  let payload: { kind?: string; leadId?: number; contactId?: number; force?: boolean };
  try {
    payload = await req.json();
  } catch {
    return json({ ok: false, error: "bad_request", message: "Invalid JSON body." }, 400);
  }

  // force=true is a deliberate "Re-enrich" — without it, an already-enriched
  // record is skipped so we never re-spend a credit on it.
  const force = payload.force === true;

  const db = serviceClient();
  try {
    if (payload.kind === "company") {
      if (payload.leadId == null) return json({ ok: false, error: "bad_request", message: "leadId required" }, 400);
      return await enrichCompany(db, payload.leadId, force);
    }
    if (payload.kind === "person") {
      if (payload.contactId == null) return json({ ok: false, error: "bad_request", message: "contactId required" }, 400);
      return await enrichContact(db, payload.contactId, force);
    }
    return json({ ok: false, error: "bad_request", message: "kind must be 'company' or 'person'." }, 400);
  } catch (e) {
    if (e instanceof ApolloError) {
      const error = e.code === "rate_limited" ? "rate_limited"
        : e.code === "plan_gated" ? "plan_gated"
        : "apollo_error";
      // Handled provider conditions -> 200 with a structured message.
      return json({ ok: false, error, message: e.message });
    }
    return json({ ok: false, error: "enrich_failed", message: String((e as Error)?.message ?? e) }, 500);
  }
});

// ===== Company =====
async function enrichCompany(db: SupabaseClient, leadId: number, force: boolean): Promise<Response> {
  const { data: lead, error } = await db
    .from("leads")
    .select("id, company_name, website, domain, hq_location, headcount, description, enriched_at")
    .eq("id", leadId)
    .single();
  if (error || !lead) return json({ ok: false, error: "not_found", message: "Lead not found." }, 404);

  // Credit guard: already enriched -> skip (no Apollo call) unless this is an
  // explicit Re-enrich (force).
  if (lead.enriched_at && !force) {
    return json({ ok: true, matched: false, skipped: true, reason: "Already enriched. Use Re-enrich to refresh.", enriched_at: lead.enriched_at });
  }

  // Credit guard: require a domain or website. We never match on company name
  // alone — too broad, wastes credits on the wrong company.
  if (isEmpty(lead.domain) && isEmpty(lead.website)) {
    return json({ ok: true, matched: false, reason: "Add a domain or website before enriching — Apollo won't match on company name alone." });
  }

  const org = await enrichOrganization({
    domain: lead.domain,
    website: lead.website,
    name: lead.company_name,
  });
  if (!org) return json({ ok: true, matched: false, reason: "No Apollo match for this company." });

  // Map Apollo org -> our columns. Always refresh the firmographic + raw fields;
  // only fill the free-text fields a user might have hand-edited when empty.
  const employees = org.estimated_num_employees ?? null;
  const revenue = numericRevenue(org);
  const hq = composeLocation(org);

  const patch: Record<string, unknown> = {
    apollo_org_id: org.id ?? null,
    industry: org.industry ?? null,
    estimated_revenue: revenue,
    founded_year: org.founded_year ?? null,
    technologies: Array.isArray(org.technology_names) ? org.technology_names : null,
    apollo_raw: org,
    enriched_at: new Date().toISOString(),
    enriched_source: "apollo",
    updated_at: new Date().toISOString(),
  };
  if (isEmpty(lead.domain) && org.primary_domain) patch.domain = org.primary_domain;
  if (isEmpty(lead.website) && (org.website_url || org.primary_domain)) {
    patch.website = org.website_url ?? org.primary_domain;
  }
  if (isEmpty(lead.headcount) && employees != null) patch.headcount = String(employees);
  if (isEmpty(lead.hq_location) && hq) patch.hq_location = hq;
  if (isEmpty(lead.description) && org.short_description) patch.description = org.short_description;

  const { error: upErr } = await db.from("leads").update(patch).eq("id", leadId);
  if (upErr) {
    // Apollo found a domain that another lead already owns (leads_domain_unique) —
    // that's an existing-duplicate-company problem, not an enrichment failure.
    if (upErr.code === "23505" && String(upErr.message).includes("leads_domain_unique")) {
      return json({
        ok: false,
        error: "duplicate_domain",
        message:
          "Another company in the CRM already has this domain. Use Find Duplicates on the Companies board to merge them.",
      }, 409);
    }
    return json({ ok: false, error: "enrich_failed", message: upErr.message }, 500);
  }

  // Feed the scoring rubric (only when Apollo gave us a usable value).
  const signals: string[] = [];
  if (revenue != null) {
    await upsertSignal(db, leadId, "revenue", String(revenue));
    signals.push("revenue");
  }
  const fundingDate = latestFundingDate(org);
  if (fundingDate) {
    // recent_funding stores the funding DATE as its value (scores when recent).
    await upsertSignal(db, leadId, "recent_funding", fundingDate);
    signals.push("recent_funding");
  }

  return json({
    ok: true,
    matched: true,
    fields: {
      industry: patch.industry,
      estimated_revenue: patch.estimated_revenue,
      founded_year: patch.founded_year,
      headcount: patch.headcount ?? lead.headcount,
      hq_location: patch.hq_location ?? lead.hq_location,
      technologies: patch.technologies,
    },
    signals,
  });
}

// ===== Person =====
async function enrichContact(db: SupabaseClient, contactId: number, force: boolean): Promise<Response> {
  const { data: contact, error } = await db
    .from("lead_contacts")
    .select("id, lead_id, name, email, linkedin, title, phone, location, seniority, enriched_at, lead:leads(domain, website, company_name)")
    .eq("id", contactId)
    .single();
  if (error || !contact) return json({ ok: false, error: "not_found", message: "Contact not found." }, 404);

  // Credit guard: already enriched -> skip (no Apollo call) unless Re-enrich.
  if (contact.enriched_at && !force) {
    return json({ ok: true, matched: false, skipped: true, reason: "Already enriched. Use Re-enrich to refresh.", enriched_at: contact.enriched_at });
  }

  const lead = (contact as { lead?: { domain?: string; website?: string; company_name?: string } }).lead;
  const domain = lead?.domain || domainFromWebsite(lead?.website);

  // Credit guard: require an email or LinkedIn URL. Name + company/domain alone
  // is too broad and wastes credits on the wrong person.
  if (isEmpty(contact.email) && isEmpty(contact.linkedin)) {
    return json({ ok: true, matched: false, reason: "Add a work email or LinkedIn URL before enriching — name + company alone isn't enough to match." });
  }

  const person = await enrichPerson({
    email: contact.email,
    name: contact.name,
    linkedinUrl: contact.linkedin,
    domain,
    organizationName: lead?.company_name,
  });
  if (!person) return json({ ok: true, matched: false, reason: "No Apollo match for this person." });

  const phone = firstPhone(person);
  const location = composeLocation(person);

  const patch: Record<string, unknown> = {
    apollo_person_id: person.id ?? null,
    apollo_raw: person,
    enriched_at: new Date().toISOString(),
  };
  // Title/seniority are safe to refresh; identifiers only fill when empty.
  if (person.title) patch.title = person.title;
  if (person.seniority) patch.seniority = person.seniority;
  if (isEmpty(contact.email) && person.email) patch.email = person.email;
  if (isEmpty(contact.linkedin) && person.linkedin_url) patch.linkedin = person.linkedin_url;
  if (isEmpty(contact.phone) && phone) patch.phone = phone;
  if (isEmpty(contact.location) && location) patch.location = location;

  const { error: upErr } = await db.from("lead_contacts").update(patch).eq("id", contactId);
  if (upErr) return json({ ok: false, error: "enrich_failed", message: upErr.message }, 500);

  return json({
    ok: true,
    matched: true,
    fields: {
      title: patch.title ?? contact.title,
      seniority: patch.seniority ?? contact.seniority,
      email: patch.email ?? contact.email,
      phone: patch.phone ?? contact.phone,
      linkedin: patch.linkedin ?? contact.linkedin,
      location: patch.location ?? contact.location,
    },
  });
}

// ===== mapping helpers =====
async function upsertSignal(db: SupabaseClient, leadId: number, key: string, value: string): Promise<void> {
  await db.from("lead_signals").upsert(
    { lead_id: leadId, signal_key: key, value, updated_at: new Date().toISOString() },
    { onConflict: "lead_id,signal_key" },
  );
}

function numericRevenue(org: Record<string, unknown>): number | null {
  const raw = (org.annual_revenue ?? org.organization_revenue) as unknown;
  const n = typeof raw === "string" ? Number(raw.replace(/[^0-9.]/g, "")) : Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function composeLocation(o: Record<string, unknown>): string | null {
  const parts = [o.city, o.state, o.country].filter((p) => typeof p === "string" && p.trim() !== "");
  return parts.length ? parts.join(", ") : null;
}

function latestFundingDate(org: Record<string, unknown>): string | null {
  if (typeof org.latest_funding_round_date === "string") return org.latest_funding_round_date;
  const events = org.funding_events as Array<{ date?: string }> | undefined;
  if (Array.isArray(events) && events.length) {
    const dates = events.map((e) => e.date).filter((d): d is string => !!d).sort();
    if (dates.length) return dates[dates.length - 1];
  }
  return null;
}

function firstPhone(person: Record<string, unknown>): string | null {
  const nums = person.phone_numbers as Array<{ raw_number?: string; sanitized_number?: string }> | undefined;
  if (Array.isArray(nums) && nums.length) return nums[0].sanitized_number ?? nums[0].raw_number ?? null;
  return null;
}
