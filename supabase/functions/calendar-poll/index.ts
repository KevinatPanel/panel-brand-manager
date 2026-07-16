// calendar-poll: invoked by pg_cron with the service-role bearer. Incrementally
// syncs primary-calendar events (stored syncToken) and, for events whose
// external attendees resolve to a deal, upserts a `meetings` row + a "Booked"
// touch (deduped). Phase 1: surfacing only — no deal creation.
//
// Matching uses an in-memory email->deal map, built at most once per run and
// only if some event actually needs it (see makeEmailDealLoader) — NOT a
// per-event DB lookup — so a busy calendar stays cheap.
//
// Meeting rows are bounded to MAX_MEETING_HORIZON_DAYS out and cancellations/
// upserts are batched per page (NOT one DB round trip per event) — see the
// comments on MAX_PAGES/MAX_MEETING_HORIZON_DAYS below. A cancelled recurring
// series with no end date can otherwise flood both Google's delta stream and
// this table with hundreds of far-future instances.
import { serviceClient } from "../_shared/supabase.ts";
import {
  Connection,
  getValidAccessToken,
  markSynced,
  requireServiceRole,
} from "../_shared/connections.ts";
import { externalParties } from "../_shared/match.ts";

const CAL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
// 40 pages * 250 results = 10,000 events/run — high enough that a large
// cancellation backlog (see MAX_MEETING_HORIZON_DAYS below) can fully drain
// within one invocation. If a run can't reach the last page, `newSyncToken`
// never gets set and the next run restarts from the same syncToken, re-doing
// the same work forever — cheap per-page batching (below) is what makes a
// higher cap affordable.
const MAX_PAGES = 40;
const WINDOW_DAYS = 90; // initial full sync only spans the next N days (bounds
//                         recurring-event expansion so we reach nextSyncToken)
// A recurring event with no end date can materialize (and, on cancellation,
// emit per-instance cancellation deltas for) instances decades out — Google
// has been observed capping expansion around ~2050. Nothing in this CRM needs
// a meeting further out than next year, so instances beyond this horizon are
// simply skipped rather than written to `meetings` at all.
const MAX_MEETING_HORIZON_DAYS = 400;

async function calapi(token: string, qs: URLSearchParams): Promise<Response> {
  return await fetch(`${CAL}?${qs.toString()}`, { headers: { Authorization: `Bearer ${token}` } });
}

function eventTime(t: { dateTime?: string; date?: string } | undefined): string | null {
  if (!t) return null;
  const v = t.dateTime ?? t.date;
  return v && !isNaN(Date.parse(v)) ? new Date(v).toISOString() : null;
}

// Build a lowercase email -> deal_id map. Both source tables are small
// (explicit thread links + people on pipelined leads), so one read each beats
// thousands of per-attendee lookups. Callers should go through
// makeEmailDealLoader() rather than calling this directly — see there for why.
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

// Lazily builds + memoizes the email->deal map for one invocation, across all
// connections. Most ticks have zero events with external attendees to
// resolve (steady state after the initial sync), so building this
// unconditionally was two full-table reads on every single ~2-minute cron
// tick forever, for nothing. Deferring until first actual need drops that to
// zero on quiet ticks.
function makeEmailDealLoader(
  db: ReturnType<typeof serviceClient>,
): () => Promise<Map<string, number>> {
  let cached: Promise<Map<string, number>> | null = null;
  return () => {
    if (!cached) cached = buildEmailDealMap(db);
    return cached;
  };
}

async function syncConnection(
  db: ReturnType<typeof serviceClient>,
  conn: Connection,
  getEmailDeal: () => Promise<Map<string, number>>,
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

    // Batched per page rather than one DB round trip per event — a single
    // cancelled recurring series can carry hundreds of instances in one page
    // (see MAX_MEETING_HORIZON_DAYS above for the other half of that fix).
    const cancelledIds: string[] = [];
    const meetingRows: Record<string, unknown>[] = [];
    const touchRows: Record<string, unknown>[] = [];
    const horizonMs = Date.now() + MAX_MEETING_HORIZON_DAYS * 86400_000;

    for (const ev of data.items ?? []) {
      if (ev.status === "cancelled") {
        cancelledIds.push(ev.id);
        continue;
      }

      const startsAt = eventTime(ev.start);
      if (startsAt && new Date(startsAt).getTime() > horizonMs) continue; // far-future recurring instance — not worth tracking

      const attendeeEmails = (ev.attendees ?? [])
        .map((a: { email?: string }) => (a.email ?? "").toLowerCase())
        .filter(Boolean);
      const external = externalParties(attendeeEmails, conn.google_email);
      if (external.length === 0) continue;

      const emailDeal = await getEmailDeal();
      let dealId: number | undefined;
      for (const e of external) {
        const d = emailDeal.get(e);
        if (d) { dealId = d; break; }
      }
      if (!dealId) continue;

      meetingRows.push({
        deal_id: dealId,
        user_id: conn.user_id,
        google_event_id: ev.id,
        title: ev.summary ?? null,
        starts_at: startsAt,
        ends_at: eventTime(ev.end),
        attendees: ev.attendees ?? null,
        status: ev.status ?? null,
      });
      touchRows.push({
        deal_id: dealId,
        touch_date: startsAt ?? new Date().toISOString(),
        touch_type: "Call",
        outcome: "Booked",
        notes: ev.summary ?? "Meeting",
        source: "gmail",
        external_id: `gcal:${ev.id}`,
        created_at: new Date().toISOString(),
      });
      upserts++;
    }

    if (cancelledIds.length > 0) {
      await db.from("meetings").delete().eq("user_id", conn.user_id).in("google_event_id", cancelledIds);
    }
    if (meetingRows.length > 0) {
      await db.from("meetings").upsert(meetingRows, { onConflict: "user_id,google_event_id" });
    }
    if (touchRows.length > 0) {
      await db.from("touch_log").upsert(touchRows, { onConflict: "external_id", ignoreDuplicates: true });
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

  const getEmailDeal = makeEmailDealLoader(db);
  const results = [];
  for (const conn of conns ?? []) {
    try {
      results.push(await syncConnection(db, conn as Connection, getEmailDeal));
    } catch (e) {
      results.push({ user: (conn as Connection).google_email, error: String(e) });
    }
  }
  return new Response(JSON.stringify({ synced: results.length, results }), {
    headers: { "Content-Type": "application/json" },
  });
});
