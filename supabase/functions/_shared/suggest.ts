// Shared person/company suggestion engine: turn a single OUTBOUND (sent) email
// into pending company_suggestions + contact_suggestions, de-duped against the
// CRM. Used identically by the one-time backfill and the go-forward poller so
// both behave the same.
//
// Cold-outreach model: we only suggest people the rep *emailed* (To/Cc of sent
// mail). We additionally flag two_way when the prospect replied on the thread,
// so two-way relationships can be prioritized later without re-scanning.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type { Connection } from "./connections.ts";
import {
  domainOf,
  externalParties,
  isFreeMail,
  isRoleAddress,
  normalizeDomain,
  parseAddress,
  parseAddressList,
} from "./match.ts";
import { extractContact, plaintextFromPayload } from "./extract.ts";

export interface GmailHeader {
  name: string;
  value: string;
}
export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  payload?: { headers?: GmailHeader[] };
}

export function header(headers: GmailHeader[], name: string): string | undefined {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;
}

// Map a recipient email -> its display name from a raw header like
// `Jane Doe <jane@acme.io>, bob@acme.io`. Returns "" when no display name.
function displayNames(raw: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!raw) return out;
  for (const part of raw.split(",")) {
    const email = parseAddress(part);
    if (!email) continue;
    const m = part.match(/^\s*"?([^"<]+?)"?\s*</);
    const name = m ? m[1].trim() : "";
    if (name) out.set(email, name);
  }
  return out;
}

function brandFromDomain(domain: string): string {
  const base = domain.split(".")[0] ?? "";
  return base ? base[0].toUpperCase() + base.slice(1) : "";
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
      if (from && from !== self) return true;
    }
    return false;
  } catch {
    return false;
  }
}

// Process one sent message. Returns true if a NEW contact suggestion was filed.
// `ignoredDomains` is the rep's (+ workspace) ignore set, passed in once per run.
export async function suggestFromSentMessage(
  db: SupabaseClient,
  conn: Connection,
  msg: GmailMessage,
  gapi: (path: string) => Promise<Response>,
  ignoredDomains: Set<string>,
): Promise<boolean> {
  const headers = msg.payload?.headers ?? [];
  const toRaw = header(headers, "To");
  const ccRaw = header(headers, "Cc");
  const recipients = [...parseAddressList(toRaw), ...parseAddressList(ccRaw)];
  const counterparties = externalParties(recipients, conn.google_email);
  if (counterparties.length === 0) return false;

  const primary = counterparties[0];
  const dom = normalizeDomain(domainOf(primary));
  // Cold-outreach prospects only: skip free-mail, transactional/role addresses
  // (no-reply@, receipts@, support@…), and ignored domains.
  if (!dom || isFreeMail(primary) || isRoleAddress(primary) || ignoredDomains.has(dom)) return false;

  // --- Person dedup: already in the CRM? then nothing to suggest. ---
  const existingContact = await db
    .from("lead_contacts")
    .select("id")
    .ilike("email", primary)
    .limit(1)
    .maybeSingle();
  if (existingContact.data) return false;

  // Already queued / already decided on this person? don't re-surface.
  const existingSug = await db
    .from("contact_suggestions")
    .select("id")
    .eq("user_id", conn.user_id)
    .eq("email", primary)
    .limit(1)
    .maybeSingle();
  if (existingSug.data) return false;

  // --- Company match: normalized domain -> existing lead (exact, indexed). ---
  const matchedLead = await db
    .from("leads")
    .select("id, company_name")
    .eq("domain", dom)
    .limit(1)
    .maybeSingle();
  const matchedLeadId: number | null = matchedLead.data?.id ?? null;

  // --- Extract richer person/company detail from the body + signature. ---
  const body = plaintextFromPayload(msg.payload);
  const extracted = await extractContact({
    from: header(headers, "From") ?? conn.google_email,
    to: counterparties,
    subject: header(headers, "Subject") ?? null,
    body,
  });

  const displayName = displayNames(toRaw).get(primary) ?? displayNames(ccRaw).get(primary) ?? "";
  const personName = extracted?.person.name ?? (displayName || null);
  const companyName = matchedLead.data?.company_name ??
    extracted?.company_name ??
    brandFromDomain(dom) ??
    null;

  // --- Get-or-create the company suggestion (respect prior dismissal). ---
  const companySugExisting = await db
    .from("company_suggestions")
    .select("id, status")
    .eq("user_id", conn.user_id)
    .eq("domain", dom)
    .limit(1)
    .maybeSingle();

  let companySuggestionId: number;
  if (companySugExisting.data) {
    // Rep already rejected this company — don't resurrect it (or its people).
    if (companySugExisting.data.status === "dismissed") return false;
    companySuggestionId = companySugExisting.data.id;
    // The bucket was already accepted, but a NEW person showed up — reopen it so
    // the review queue surfaces "add these people to <existing company>".
    if (companySugExisting.data.status === "accepted") {
      await db
        .from("company_suggestions")
        .update({ status: "pending", resolved_at: null })
        .eq("id", companySuggestionId);
    }
  } else {
    const ins = await db
      .from("company_suggestions")
      .insert({
        user_id: conn.user_id,
        proposed_company_name: companyName,
        domain: dom,
        matched_lead_id: matchedLeadId,
        confidence: extracted?.confidence ?? null,
        status: "pending",
      })
      .select("id")
      .single();
    if (ins.error || !ins.data) return false;
    companySuggestionId = ins.data.id;
  }

  const twoWay = await threadHasReply(gapi, msg.threadId, conn.google_email);

  const insContact = await db
    .from("contact_suggestions")
    .insert({
      user_id: conn.user_id,
      company_suggestion_id: companySuggestionId,
      name: personName,
      email: primary,
      title: extracted?.person.title ?? null,
      phone: extracted?.person.phone ?? null,
      linkedin: extracted?.person.linkedin ?? null,
      location: extracted?.person.location ?? null,
      seniority: extracted?.person.seniority ?? null,
      source_thread_id: msg.threadId,
      source_message_id: header(headers, "Message-ID") ?? `gmail:${msg.id}`,
      subject: header(headers, "Subject") ?? null,
      two_way: twoWay,
      status: "pending",
    });
  // Unique (user_id, email) guards against a race; treat conflict as "already done".
  return !insContact.error;
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
