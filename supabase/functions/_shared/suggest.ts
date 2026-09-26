// Shared person/company engine: turn a single email (sent OR received) into
// people on company profiles, de-duped against the CRM. Used identically by the
// one-time backfill and the go-forward poller so both behave the same.
//
// Every external address on the message counts: From, To, Cc and — on the rep's
// own sent copy, the only place Gmail keeps it — Bcc. People are grouped by
// their email domain:
//   - domain already belongs to a company in the CRM -> the people are added
//     straight onto that company's profile (lead_contacts);
//   - brand-new domain -> one pending company_suggestion with every person as a
//     contact_suggestion under it, so the rep approves the company once.
// two_way flags people on threads where someone outside the team replied.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type { Connection } from "./connections.ts";
import {
  domainOf,
  isFreeMail,
  isInternal,
  isRoleAddress,
  normalizeDomain,
  parseAddress,
} from "./match.ts";
import { extractPeople, Participant, ParticipantRole, plaintextFromPayload } from "./extract.ts";

export interface GmailHeader {
  name: string;
  value: string;
}
export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  payload?: { headers?: GmailHeader[]; body?: { data?: string }; parts?: unknown[] };
}

export function header(headers: GmailHeader[], name: string): string | undefined {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;
}

// Headers the go-forward poller must request in its metadata fetch so this
// module sees everything it needs (Bcc + the bulk-mail markers).
export const SUGGEST_METADATA_HEADERS = [
  "From", "To", "Cc", "Bcc", "Subject", "Date", "Message-ID", "List-Unsubscribe", "Precedence",
];

// Split an address header into { email, displayName } entries, e.g.
// `Jane Doe <jane@acme.io>, bob@acme.io`. Splits on commas outside quotes so
// `"Doe, Jane" <jane@acme.io>` stays one entry.
function parseParticipants(raw: string | undefined, role: ParticipantRole): Participant[] {
  if (!raw) return [];
  const parts = raw.match(/(?:"[^"]*"|[^,])+/g) ?? [];
  const out: Participant[] = [];
  for (const part of parts) {
    const email = parseAddress(part);
    if (!email) continue;
    const m = part.match(/^\s*"?([^"<]+?)"?\s*</);
    out.push({ email, role, displayName: m ? m[1].trim() : "" });
  }
  return out;
}

// Spam, newsletters, marketing blasts and mailing lists aren't relationships
// (Gmail's category tabs + list headers). Only applied to received mail — anything the rep sent is always kept.
const SKIP_LABELS = [
  "SPAM", "TRASH", "CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CATEGORY_UPDATES", "CATEGORY_FORUMS",
];

function isBulkMail(headers: GmailHeader[], labels: string[]): boolean {
  if (labels.some((l) => SKIP_LABELS.includes(l))) return true;
  if (header(headers, "List-Unsubscribe")) return true;
  const precedence = (header(headers, "Precedence") ?? "").toLowerCase();
  return precedence === "bulk" || precedence === "list" || precedence === "junk";
}

function brandFromDomain(domain: string): string {
  const base = domain.split(".")[0] ?? "";
  return base ? base[0].toUpperCase() + base.slice(1) : "";
}

function hasBody(msg: GmailMessage): boolean {
  return !!(msg.payload?.parts?.length || msg.payload?.body?.data);
}

// Has anyone other than our rep sent a message on this thread? (i.e. a reply.)
async function threadHasReply(
  gapi: (path: string) => Promise<Response>,
  threadId: string,
  selfEmail: string,
): Promise<boolean> {
  try {
    const res = await gapi(`/threads/${threadId}?format=metadata&metadataHeaders=From`);
    if (!res.ok) return false;
    const data = await res.json();
    const self = selfEmail.toLowerCase();
    for (const m of data.messages ?? []) {
      const labels: string[] = m.labelIds ?? [];
      if (labels.includes("SENT")) continue; // our rep's own message
      const from = parseAddress(header(m.payload?.headers ?? [], "From") ?? "");
      if (from && from !== self && !isInternal(from)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

export interface SuggestResult {
  added: number; // people added straight onto an existing company's profile
  suggested: number; // people queued under a (new) company suggestion
}

interface Candidate {
  email: string;
  domain: string;
  displayName: string;
}

// Process one message. `msg` may be a metadata-only fetch (the poller) — the
// full body is fetched here only when there's someone new worth extracting.
// `ignoredDomains` is the rep's (+ workspace) ignore set, passed in once per run.
export async function suggestFromMessage(
  db: SupabaseClient,
  conn: Connection,
  msg: GmailMessage,
  gapi: (path: string) => Promise<Response>,
  ignoredDomains: Set<string>,
): Promise<SuggestResult> {
  const result: SuggestResult = { added: 0, suggested: 0 };
  const headers = msg.payload?.headers ?? [];
  const labels = msg.labelIds ?? [];
  const isOutbound = labels.includes("SENT");
  if (!isOutbound && isBulkMail(headers, labels)) return result;

  const participants = [
    ...parseParticipants(header(headers, "From"), "from"),
    ...parseParticipants(header(headers, "To"), "to"),
    ...parseParticipants(header(headers, "Cc"), "cc"),
    ...parseParticipants(header(headers, "Bcc"), "bcc"),
  ];

  // External people worth a profile: not the rep, not a teammate, not free-mail,
  // not a transactional/role inbox (no-reply@, receipts@…), not an ignored domain.
  const self = conn.google_email.toLowerCase();
  const seen = new Set<string>();
  let candidates: Candidate[] = [];
  for (const p of participants) {
    if (seen.has(p.email)) continue;
    seen.add(p.email);
    if (p.email === self || isInternal(p.email)) continue;
    const domain = normalizeDomain(domainOf(p.email));
    if (!domain || isFreeMail(p.email) || isRoleAddress(p.email) || ignoredDomains.has(domain)) continue;
    candidates.push({ email: p.email, domain, displayName: p.displayName });
  }
  if (candidates.length === 0) return result;

  // --- Person dedup: already in the CRM, or already queued / decided? ---
  const emails = candidates.map((c) => c.email);
  const [inCrm, queued] = await Promise.all([
    db.from("lead_contacts").select("email").in("email", emails),
    db.from("contact_suggestions").select("email").eq("user_id", conn.user_id).in("email", emails),
  ]);
  const known = new Set(
    [...(inCrm.data ?? []), ...(queued.data ?? [])].map((r) => String(r.email ?? "").toLowerCase()),
  );
  // lead_contacts.email isn't guaranteed lowercase; catch mixed-case stragglers.
  for (const c of candidates) {
    if (known.has(c.email)) continue;
    const ci = await db.from("lead_contacts").select("id").ilike("email", c.email).limit(1).maybeSingle();
    if (ci.data) known.add(c.email);
  }
  candidates = candidates.filter((c) => !known.has(c.email));
  if (candidates.length === 0) return result;

  // --- Group by company domain; resolve each to a lead or a suggestion. ---
  const domains = [...new Set(candidates.map((c) => c.domain))];
  const [leadRows, sugRows] = await Promise.all([
    db.from("leads").select("id, domain").in("domain", domains),
    db
      .from("company_suggestions")
      .select("id, domain, status, matched_lead_id")
      .eq("user_id", conn.user_id)
      .in("domain", domains),
  ]);
  const leadByDomain = new Map<string, number>();
  for (const l of leadRows.data ?? []) {
    if (!leadByDomain.has(l.domain)) leadByDomain.set(l.domain, l.id);
  }
  const sugByDomain = new Map<string, { id: number; status: string; matched_lead_id: number | null }>();
  for (const cs of sugRows.data ?? []) sugByDomain.set(cs.domain, cs);

  // Rep already rejected this company (and it isn't in the CRM) — leave it be.
  candidates = candidates.filter(
    (c) => leadByDomain.has(c.domain) || sugByDomain.get(c.domain)?.status !== "dismissed",
  );
  if (candidates.length === 0) return result;

  // --- Extract richer person/company detail from the body + signatures. ---
  let full = msg;
  if (!hasBody(msg)) {
    try {
      const res = await gapi(`/messages/${msg.id}?format=full`);
      if (res.ok) full = (await res.json()) as GmailMessage;
    } catch {
      // extraction is best-effort; header names still work without it
    }
  }
  const subject = header(headers, "Subject") ?? null;
  const extracted = await extractPeople({
    direction: isOutbound ? "outbound" : "inbound",
    rep: conn.google_email,
    participants,
    people: candidates.map((c) => c.email),
    subject,
    body: plaintextFromPayload(full.payload),
  });

  // Inbound mail is itself the reply; for sent mail check the thread.
  const twoWay = isOutbound ? await threadHasReply(gapi, msg.threadId, conn.google_email) : true;
  const messageId = header(headers, "Message-ID") ?? `gmail:${msg.id}`;
  const now = new Date().toISOString();

  for (const domain of domains) {
    const people = candidates.filter((c) => c.domain === domain);
    if (people.length === 0) continue;
    const leadId = leadByDomain.get(domain) ?? null;

    if (leadId != null) {
      // Existing company: add everyone straight onto its profile.
      for (const c of people) {
        const x = extracted?.people.get(c.email);
        const ins = await db.from("lead_contacts").insert({
          lead_id: leadId,
          name: x?.name ?? (c.displayName || c.email),
          email: c.email,
          title: x?.title ?? null,
          phone: x?.phone ?? null,
          linkedin: x?.linkedin ?? null,
          location: x?.location ?? null,
          seniority: x?.seniority ?? null,
          created_at: now,
        });
        if (!ins.error) result.added++;
      }
      continue;
    }

    // New company: get-or-create one suggestion and queue every person under it.
    let companySuggestionId: number;
    const existing = sugByDomain.get(domain);
    if (existing) {
      companySuggestionId = existing.id;
      // The bucket was already accepted, but NEW people showed up (and the lead
      // it created is gone) — reopen it so the review queue surfaces them.
      if (existing.status === "accepted") {
        await db
          .from("company_suggestions")
          .update({ status: "pending", resolved_at: null })
          .eq("id", companySuggestionId);
      }
    } else {
      const companyName = people.map((c) => extracted?.people.get(c.email)?.company_name).find(Boolean) ??
        brandFromDomain(domain);
      const ins = await db
        .from("company_suggestions")
        .insert({
          user_id: conn.user_id,
          proposed_company_name: companyName || null,
          domain,
          matched_lead_id: null,
          confidence: extracted?.confidence ?? null,
          status: "pending",
        })
        .select("id")
        .single();
      if (ins.error || !ins.data) continue;
      companySuggestionId = ins.data.id;
    }

    for (const c of people) {
      const x = extracted?.people.get(c.email);
      const insContact = await db.from("contact_suggestions").insert({
        user_id: conn.user_id,
        company_suggestion_id: companySuggestionId,
        name: x?.name ?? (c.displayName || null),
        email: c.email,
        title: x?.title ?? null,
        phone: x?.phone ?? null,
        linkedin: x?.linkedin ?? null,
        location: x?.location ?? null,
        seniority: x?.seniority ?? null,
        source_thread_id: msg.threadId,
        source_message_id: messageId,
        subject,
        two_way: twoWay,
        status: "pending",
      });
      // Unique (user_id, email) guards against a race; conflict = already done.
      if (!insContact.error) result.suggested++;
    }
  }

  return result;
}

// The rep's ignored domains (own rules + workspace-wide), as a normalized set.
export async function loadIgnoredDomains(
  db: SupabaseClient,
  userId: string,
): Promise<Set<string>> {
  const rules = await db
    .from("email_domain_rules")
    .select("domain")
    .eq("rule", "ignore")
    .or(`user_id.eq.${userId},user_id.is.null`);
  return new Set((rules.data ?? []).map((r) => normalizeDomain(String(r.domain))).filter(Boolean));
}
