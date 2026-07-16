// gmail-poll: invoked by pg_cron (~every 2 min) with the service-role bearer.
// For each active connection it walks the Gmail History API since the stored
// historyId. For messages on a thread that resolves to a deal, it logs a
// touch_log entry (deduped on Message-ID). For an OUTBOUND email to a brand-new
// external contact (no matching deal), it creates a *pending* email_suggestion
// — never an auto-created deal (Phase 2 review queue). No stage moves (Phase 3).
//
// Deal matching: (a) thread already linked in deal_email_links, or (b) an
// external counterparty matches a lead_contacts.email whose lead is in pipeline
// (also records a deal_email_links row so the thread matches directly next time).
import { serviceClient } from "../_shared/supabase.ts";
import {
  Connection,
  getValidAccessToken,
  markSynced,
  requireServiceRole,
} from "../_shared/connections.ts";
import { domainOf, externalParties, isFreeMail, parseAddress, parseAddressList } from "../_shared/match.ts";
import { GmailMessage, loadIgnoredDomains, suggestFromSentMessage } from "../_shared/suggest.ts";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const MAX_MESSAGES_PER_CONN = 100; // safety cap per run

// Team members an owner can be attributed to (mirrors client OWNERS in
// lib/stages.js). A connection's google_email local-part is matched here so a
// Gmail-logged touch records who sent it; unknown senders get a null owner.
const OWNERS = ["Tom", "Raven", "Andrew", "Kevin"];

// "kevin@panel.local" -> "Kevin" when that maps to a known owner, else null.
// Same rule the suggestion RPCs use (initcap(split_part(google_email,'@',1))).
function ownerFromEmail(googleEmail: string): string | null {
  const local = (googleEmail.split("@")[0] ?? "").trim();
  if (!local) return null;
  const name = local.charAt(0).toUpperCase() + local.slice(1).toLowerCase();
  return OWNERS.includes(name) ? name : null;
}

async function gapi(token: string, path: string): Promise<Response> {
  return await fetch(`${GMAIL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function currentHistoryId(token: string): Promise<string | null> {
  const res = await gapi(token, "/profile");
  if (!res.ok) return null;
  return (await res.json()).historyId ?? null;
}

// Walk history pages, collecting added message ids + the latest historyId.
async function collectAddedMessages(
  token: string,
  startHistoryId: string,
): Promise<{ ids: string[]; newHistoryId: string | null; tooOld: boolean }> {
  const ids = new Set<string>();
  let pageToken: string | undefined;
  let newHistoryId: string | null = null;

  do {
    const q = new URLSearchParams({
      startHistoryId,
      historyTypes: "messageAdded",
    });
    if (pageToken) q.set("pageToken", pageToken);

    const res = await gapi(token, `/history?${q.toString()}`);
    if (res.status === 404) return { ids: [], newHistoryId: null, tooOld: true };
    if (!res.ok) break;

    const data = await res.json();
    newHistoryId = data.historyId ?? newHistoryId;
    for (const h of data.history ?? []) {
      for (const m of h.messagesAdded ?? []) {
        if (m.message?.id) ids.add(m.message.id);
      }
    }
    pageToken = data.nextPageToken;
  } while (pageToken && ids.size < MAX_MESSAGES_PER_CONN);

  return { ids: [...ids].slice(0, MAX_MESSAGES_PER_CONN), newHistoryId, tooOld: false };
}

function header(headers: { name: string; value: string }[], name: string): string | undefined {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;
}

// Resolve a deal for this message. Returns { dealId, viaThread } or null.
async function resolveDeal(
  db: ReturnType<typeof serviceClient>,
  threadId: string,
  counterparties: string[],
): Promise<{ dealId: number; matchedEmail: string | null } | null> {
  // (a) thread already linked
  const linked = await db
    .from("deal_email_links")
    .select("deal_id")
    .eq("thread_id", threadId)
    .limit(1)
    .maybeSingle();
  if (linked.data) return { dealId: linked.data.deal_id, matchedEmail: null };

  // (b) counterparty email -> lead_contacts.email -> lead in pipeline -> deal
  for (const email of counterparties) {
    const contact = await db
      .from("lead_contacts")
      .select("lead_id")
      .ilike("email", email)
      .limit(1)
      .maybeSingle();
    if (!contact.data) continue;
    const lead = await db
      .from("leads")
      .select("deal_id, in_pipeline")
      .eq("id", contact.data.lead_id)
      .maybeSingle();
    if (lead.data?.in_pipeline && lead.data.deal_id) {
      return { dealId: lead.data.deal_id, matchedEmail: email };
    }
  }
  return null;
}

async function pollConnection(
  db: ReturnType<typeof serviceClient>,
  conn: Connection,
): Promise<{ user: string; logged: number; personLogged?: number; suggested?: number; advanced?: number; seeded?: boolean; reauth?: boolean }> {
  const token = await getValidAccessToken(db, conn);
  if (!token) return { user: conn.google_email, logged: 0, reauth: true };

  // First ever poll: seed the cursor, process nothing this round.
  if (!conn.history_id) {
    const hid = await currentHistoryId(token);
    if (hid) {
      await db.from("gmail_connections").update({ history_id: hid }).eq("user_id", conn.user_id);
    }
    await markSynced(db, conn.user_id);
    return { user: conn.google_email, logged: 0, seeded: true };
  }

  let { ids, newHistoryId, tooOld } = await collectAddedMessages(token, conn.history_id);

  // Cursor too old (404): reseed and bail — we'll catch up from here next time.
  if (tooOld) {
    const hid = await currentHistoryId(token);
    if (hid) {
      await db.from("gmail_connections").update({ history_id: hid }).eq("user_id", conn.user_id);
    }
    await markSynced(db, conn.user_id);
    return { user: conn.google_email, logged: 0, seeded: true };
  }

  // Noise control for new-deal suggestions: this rep's (or workspace) ignored
  // domains, and contacts we've already surfaced (any status) so we don't nag.
  const rules = await db
    .from("email_domain_rules")
    .select("domain")
    .eq("rule", "ignore")
    .or(`user_id.eq.${conn.user_id},user_id.is.null`);
  const ignoredDomains = new Set((rules.data ?? []).map((r) => String(r.domain).toLowerCase()));
  const sugRows = await db
    .from("email_suggestions")
    .select("contact_email")
    .eq("user_id", conn.user_id)
    .limit(500);
  const suggestedContacts = new Set(
    (sugRows.data ?? []).map((r) => (r.contact_email ?? "").toLowerCase()).filter(Boolean),
  );
  // Normalized ignore set for the people/company suggestion path (Phase 4).
  const ignoredNormalized = await loadIgnoredDomains(db, conn.user_id);
  const gapiBound = (path: string) => gapi(token, path);

  const ownerName = ownerFromEmail(conn.google_email);

  let logged = 0;
  let suggested = 0;
  let advanced = 0;
  let personLogged = 0;
  for (const id of ids) {
    const res = await gapi(
      token,
      `/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Date&metadataHeaders=Message-ID`,
    );
    if (!res.ok) continue; // deleted/inaccessible — skip
    const msg = await res.json();
    const headers = msg.payload?.headers ?? [];
    const labelIds: string[] = msg.labelIds ?? [];
    const threadId: string = msg.threadId;

    const isOutbound = labelIds.includes("SENT");
    const from = parseAddress(header(headers, "From") ?? "");
    const recipients = [
      ...parseAddressList(header(headers, "To")),
      ...parseAddressList(header(headers, "Cc")),
    ];
    const counterparties = isOutbound
      ? externalParties(recipients, conn.google_email)
      : externalParties(from ? [from] : [], conn.google_email);
    if (counterparties.length === 0) continue;

    // Message date + id, used by both person- and deal-level logging below.
    const dateHeader = header(headers, "Date");
    const touchDate = dateHeader && !isNaN(Date.parse(dateHeader))
      ? new Date(dateHeader).toISOString()
      : new Date().toISOString();
    const messageId = header(headers, "Message-ID") ?? `gmail:${id}`;
    const subject = header(headers, "Subject") ?? null;

    // Person-level auto-log: every counterparty that matches an existing
    // contact gets a contact_touches row, regardless of whether a deal matches.
    // Deduped per (contact, message); outcome inferred from direction.
    for (const email of counterparties) {
      const contacts = await db.from("lead_contacts").select("id").ilike("email", email);
      for (const c of contacts.data ?? []) {
        const pins = await db.from("contact_touches").upsert(
          {
            contact_id: c.id,
            touch_date: touchDate,
            touch_type: "Email",
            outcome: isOutbound ? "No Response" : "Responded",
            owner: ownerName,
            notes: subject,
            source: "gmail",
            external_id: messageId,
            created_at: new Date().toISOString(),
          },
          { onConflict: "contact_id,external_id", ignoreDuplicates: true },
        );
        if (!pins.error) personLogged++;
      }
    }

    const match = await resolveDeal(db, threadId, counterparties);
    if (!match) {
      // Phase 2: an outbound email to a brand-new external contact becomes a
      // *pending suggestion* (never an auto-created deal). Skip free-mail,
      // ignored domains, and contacts we've already surfaced.
      if (isOutbound) {
        const primary = counterparties[0];
        const dom = domainOf(primary);
        if (!isFreeMail(primary) && !ignoredDomains.has(dom) && !suggestedContacts.has(primary)) {
          const ins = await db.from("email_suggestions").upsert(
            {
              user_id: conn.user_id,
              thread_id: threadId,
              contact_email: primary,
              contact_domain: dom,
              subject: header(headers, "Subject") ?? null,
              direction: "outbound",
              proposed_action: "create_deal",
              status: "pending",
            },
            { onConflict: "user_id,thread_id,proposed_action", ignoreDuplicates: true },
          );
          if (!ins.error) {
            suggestedContacts.add(primary);
            suggested++;
          }
        }
        // Phase 4: the same new outbound contact also seeds a person/company
        // suggestion. Re-fetch the message in full so the extractor sees the
        // body + signature (the metadata fetch above has no body).
        try {
          const fullRes = await gapi(token, `/messages/${id}?format=full`);
          if (fullRes.ok) {
            const fullMsg = (await fullRes.json()) as GmailMessage;
            await suggestFromSentMessage(db, conn, fullMsg, gapiBound, ignoredNormalized);
          }
        } catch {
          // non-fatal: deal suggestion above still stands
        }
      }
      continue;
    }

    // Record the thread link if we matched via contact email (so the rest of
    // the thread resolves by thread going forward).
    if (match.matchedEmail) {
      await db.from("deal_email_links").upsert(
        {
          deal_id: match.dealId,
          thread_id: threadId,
          contact_email: match.matchedEmail,
          contact_domain: domainOf(match.matchedEmail),
          created_by: conn.user_id,
        },
        { onConflict: "deal_id,thread_id", ignoreDuplicates: true },
      );
    }

    const ins = await db.from("touch_log").upsert(
      {
        deal_id: match.dealId,
        touch_date: touchDate,
        touch_type: "Email",
        outcome: isOutbound ? "No Response" : "Responded",
        notes: subject,
        source: "gmail",
        external_id: messageId,
        created_at: new Date().toISOString(),
      },
      { onConflict: "external_id", ignoreDuplicates: true },
    );
    if (!ins.error) logged++;

    // Phase 3: an inbound reply on an S1 deal means the conversation is open.
    // Auto-advance S1->S2 if the rep opted in, else file a stage-move suggestion.
    if (!isOutbound) {
      const dealRow = await db
        .from("deals")
        .select("current_stage")
        .eq("id", match.dealId)
        .maybeSingle();
      if (dealRow.data?.current_stage === "S1") {
        if (conn.auto_advance_s1_s2) {
          const adv = await db
            .from("stage_history")
            .insert({ deal_id: match.dealId, stage: "S2", entered_at: new Date().toISOString() });
          if (!adv.error) advanced++;
        } else {
          await db.from("email_suggestions").upsert(
            {
              user_id: conn.user_id,
              thread_id: threadId,
              contact_email: counterparties[0],
              contact_domain: domainOf(counterparties[0]),
              subject: header(headers, "Subject") ?? null,
              direction: "inbound",
              proposed_action: "stage_move",
              proposed_deal_id: match.dealId,
              proposed_stage: "S2",
              status: "pending",
            },
            { onConflict: "user_id,thread_id,proposed_action", ignoreDuplicates: true },
          );
        }
      }
    }
  }

  await db
    .from("gmail_connections")
    .update({
      history_id: newHistoryId ?? conn.history_id,
      last_synced_at: new Date().toISOString(),
    })
    .eq("user_id", conn.user_id);

  return { user: conn.google_email, logged, personLogged, suggested, advanced };
}

Deno.serve(async (req) => {
  if (!requireServiceRole(req)) {
    return new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const db = serviceClient();
  const { data: conns, error } = await db
    .from("gmail_connections")
    .select(
      "user_id, google_email, refresh_token_enc, access_token_enc, access_token_exp, history_id, calendar_sync_token, auto_advance_s1_s2, status",
    )
    .eq("status", "active");
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const results = [];
  for (const conn of conns ?? []) {
    try {
      results.push(await pollConnection(db, conn as Connection));
    } catch (e) {
      results.push({ user: (conn as Connection).google_email, error: String(e) });
    }
  }

  return new Response(JSON.stringify({ polled: results.length, results }), {
    headers: { "Content-Type": "application/json" },
  });
});
