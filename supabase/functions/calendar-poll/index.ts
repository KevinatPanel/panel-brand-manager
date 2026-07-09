// calendar-poll: invoked by pg_cron with the service-role bearer. Incrementally
// syncs primary-calendar events (stored syncToken) and, for events whose
// external attendees resolve to a deal, upserts a `meetings` row + a "Booked"
// touch (deduped). Phase 1: surfacing only — no deal creation.
//
// Matching uses a single in-memory email->deal map built once per run (NOT a
// per-event DB lookup) so the initial full sync of a busy calendar stays cheap.
import { serviceClient } from "../_shared/supabase.ts";
import {
  Connection,
  getValidAccessToken,
  markSynced,
  requireServiceRole,
} from "../_shared/connections.ts";
import { externalParties } from "../_shared/match.ts";

const CAL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const MAX_PAGES = 12;
const WINDOW_DAYS = 90; // initial full sync only spans the next N days (bounds
//                         recurring-event expansion so we reach nextSyncToken)

async function calapi(token: string, qs: URLSearchParams): Promise<Response> {
  return await fetch(`${CAL}?${qs.toString()}`, { headers: { Authorization: `Bearer ${token}` } });
}

function eventTime(t: { dateTime?: string; date?: string } | undefined): string | null {
  if (!t) return null;
  const v = t.dateTime ?? t.date;
  return v && !isNaN(Date.parse(v)) ? new Date(v).toISOString() : null;
}

// Build a lowercase email -> deal_id map once. Both source tables are small
// (explicit thread links + people on pipelined leads), so one read each beats
// thousands of per-attendee lookups during the initial sync.
async function buildEmailDealMap(
  db: ReturnType<typeof serviceClient>,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();

  const links = await db.from("deal_email_links").select("contact_email, deal_id");
  for (const l of links.data ?? []) {
    if (l.contact_email) map.set(l.contact_email.toLowerCase(), l.deal_id);
  }

  // lead_contacts.email -> its lead (if in pipeline) -> deal_id
  const contacts = await db
    .from("lead_contacts")
    .select("email, leads(deal_id, in_pipeline)")
    .not("email", "is", null);
  for (const c of contacts.data ?? []) {
    const lead = (c as { leads?: { deal_id: number | null; in_pipeline: boolean } }).leads;
    const email = (c as { email?: string }).email?.toLowerCase();
    if (email && !map.has(email) && lead?.in_pipeline && lead.deal_id) {
      map.set(email, lead.deal_id);
    }
  }
  return map;
}

async function syncConnection(
  db: ReturnType<typeof serviceClient>,
  conn: Connection,
  emailDeal: Map<string, number>,
): Promise<{ user: string; meetings: number; reauth?: boolean }> {
  const token = await getValidAccessToken(db, conn);
  if (!token) return { user: conn.google_email, meetings: 0, reauth: true };

  let pageToken: string | undefined;
  const syncToken = conn.calendar_sync_token ?? undefined;
  let newSyncToken: string | null = null;
  let upserts = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const qs = new URLSearchParams({ singleEvents: "true", maxResults: "250" });
    if (syncToken) {
      qs.set("syncToken", syncToken);
    } else {
      const now = new Date();
      qs.set("timeMin", now.toISOString());
      qs.set("timeMax", new Date(now.getTime() + WINDOW_DAYS * 86400_000).toISOString());
    }
    if (pageToken) qs.set("pageToken", pageToken);

    const res = await calapi(token, qs);
    if (res.status === 410) {
      // syncToken expired — drop it, full-resync next run.
      await db.from("gmail_connections").update({ calendar_sync_token: null }).eq(
        "user_id",
        conn.user_id,
      );
      return { user: conn.google_email, meetings: 0 };
    }
    if (!res.ok) break;
    const data = await res.json();

    for (const ev of data.items ?? []) {
      if (ev.status === "cancelled") {
        await db.from("meetings").delete().eq("user_id", conn.user_id).eq("google_event_id", ev.id);
        continue;
      }
      const attendeeEmails = (ev.attendees ?? [])
        .map((a: { email?: string }) => (a.email ?? "").toLowerCase())
        .filter(Boolean);
      const external = externalParties(attendeeEmails, conn.google_email);

      let dealId: number | undefined;
      for (const e of external) {
        const d = emailDeal.get(e);
        if (d) { dealId = d; break; }
      }
      if (!dealId) continue;

      const startsAt = eventTime(ev.start);
      await db.from("meetings").upsert(
        {
          deal_id: dealId,
          user_id: conn.user_id,
          google_event_id: ev.id,
          title: ev.summary ?? null,
          starts_at: startsAt,
          ends_at: eventTime(ev.end),
          attendees: ev.attendees ?? null,
          status: ev.status ?? null,
        },
        { onConflict: "user_id,google_event_id" },
      );
      await db.from("touch_log").upsert(
        {
          deal_id: dealId,
          touch_date: startsAt ?? new Date().toISOString(),
          touch_type: "Call",
          outcome: "Booked",
          notes: ev.summary ?? "Meeting",
          source: "gmail",
          external_id: `gcal:${ev.id}`,
          created_at: new Date().toISOString(),
        },
        { onConflict: "external_id", ignoreDuplicates: true },
      );
      upserts++;
    }

    pageToken = data.nextPageToken;
    if (!pageToken) { newSyncToken = data.nextSyncToken ?? null; break; }
  }

  await db
    .from("gmail_connections")
    .update({
      calendar_sync_token: newSyncToken ?? conn.calendar_sync_token,
      last_synced_at: new Date().toISOString(),
    })
    .eq("user_id", conn.user_id);
  await markSynced(db, conn.user_id);
  return { user: conn.google_email, meetings: upserts };
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
      "user_id, google_email, refresh_token_enc, access_token_enc, access_token_exp, history_id, calendar_sync_token, status",
    )
    .eq("status", "active");
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const emailDeal = await buildEmailDealMap(db);
  const results = [];
  for (const conn of conns ?? []) {
    try {
      results.push(await syncConnection(db, conn as Connection, emailDeal));
    } catch (e) {
      results.push({ user: (conn as Connection).google_email, error: String(e) });
    }
  }
  return new Response(JSON.stringify({ synced: results.length, results }), {
    headers: { "Content-Type": "application/json" },
  });
});
