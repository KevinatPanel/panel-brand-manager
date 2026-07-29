// Everflow Network Reporting API client shared by everflow-sync. Holds the
// X-Eflow-Api-Key auth (the key lives only in Edge Function secrets, never
// the browser) and normalizes responses + errors.
//
// Verified against Everflow's public docs (developers.everflow.io,
// docs/network/reporting/aggregated_data) and against live calls with
// Kevin's real API key + real advertiser IDs:
//   - filter_id_value must be a STRING even for numeric advertiser IDs
//     (confirmed by Everflow's own schema-validation error message).
//   - timezone_id is REQUIRED (an earlier docs page implied it was optional
//     with a network-default fallback; omitting it produced an opaque 400
//     "Internal error" against two real advertisers).
// Response field names (reporting.revenue / .payout) confirmed.

const BASE = "https://api.eflow.team/v1";

export type EverflowErrorCode = "rate_limited" | "unauthorized" | "http";

export class EverflowError extends Error {
  status: number;
  code: EverflowErrorCode;
  constructor(message: string, status: number, code: EverflowErrorCode) {
    super(message);
    this.name = "EverflowError";
    this.status = status;
    this.code = code;
  }
}

function apiKey(): string {
  const k = Deno.env.get("EVERFLOW_API_KEY");
  if (!k) throw new Error("EVERFLOW_API_KEY not set");
  return k;
}

async function call(path: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Eflow-Api-Key": apiKey(),
    },
    body: JSON.stringify(body),
  });

  if (res.status === 429) {
    throw new EverflowError("Everflow rate limit reached — try again shortly.", 429, "rate_limited");
  }
  if (res.status === 401 || res.status === 403) {
    throw new EverflowError("Everflow API key rejected.", res.status, "unauthorized");
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new EverflowError(`Everflow HTTP ${res.status}: ${text.slice(0, 300)}`, res.status, "http");
  }
  return await res.json();
}

export interface AdvertiserRevenue {
  revenue: number | null;
  payout: number | null;
  raw: unknown;
}

export interface AdvertiserQualityEvent {
  eventCount: number | null;
  eventRevenue: number | null;
  billedEventCount: number | null;
  raw: unknown;
}

export interface AdvertiserOffer {
  offerId: string;
  offerName: string | null;
  revenue: number | null;
  payout: number | null;
  raw: unknown;
}

// Everflow's UTC timezone_id (confirmed via their metadata docs). timezone_id
// is a REQUIRED field on this endpoint despite some docs pages implying it
// falls back to a network default when omitted — omitting it produced an
// opaque 400 "Internal error" in practice. UTC keeps month-boundary
// aggregation unambiguous rather than depending on the network's configured
// reporting timezone.
const UTC_TIMEZONE_ID = 67;

// Aggregated revenue/payout for one advertiser over [from, to] (YYYY-MM-DD,
// inclusive). Returns null if the advertiser has no rows in range (not an
// error — just nothing tracked yet).
export async function fetchAdvertiserRevenue(
  advertiserId: string,
  from: string,
  to: string,
): Promise<AdvertiserRevenue | null> {
  const data = await call("/networks/reporting/entity/table", {
    from,
    to,
    timezone_id: UTC_TIMEZONE_ID,
    currency_id: "USD",
    columns: [{ column: "advertiser" }],
    query: {
      filters: [{ resource_type: "advertiser", filter_id_value: String(advertiserId) }],
    },
  });

  const row = Array.isArray(data?.table) ? data.table[0] : null;
  if (!row) return null;
  const reporting = row.reporting ?? {};
  return {
    revenue: typeof reporting.revenue === "number" ? Math.round(reporting.revenue) : null,
    payout: typeof reporting.payout === "number" ? Math.round(reporting.payout) : null,
    raw: row,
  };
}

// Aggregated count/revenue for one advertiser's named secondary conversion
// event (e.g. "Payroll" for Current — distinct from their base "download"
// event) over [from, to] (YYYY-MM-DD, inclusive).
//
// Verified against a live call for Current (advertiser 60): grouping by the
// "advertiser_event_name" column breaks the same entity/table report out by
// named event, one row per event ("N/A" for the base/unnamed conversion, plus
// one row per named additional event like "Payroll") — no offer_id needed,
// advertiser-level filtering alone is sufficient. This is a DIFFERENT column
// from "event_name", which instead groups by internal payout-rule id and does
// not correspond to the human-facing event names shown in Everflow's UI.
// reporting.event is the post-conversion event count; reporting.event_revenue
// is revenue attributed to events specifically (distinct from
// reporting.revenue, which is base-conversion revenue) — 0/absent for event
// types that aren't monetized directly (e.g. Payroll had 0 in the test call).
//
// Matches the event name case-insensitively since it's free text a rep types
// in on the client profile, and must match whatever label Everflow shows.
// Returns null if no row matches the given event name in range (not an
// error — just nothing tracked yet, or a misspelled/misconfigured name).
//
// Also returns billedEventCount: the base/untagged bucket's approved
// conversion count (advertiser_event_name id "0", label "N/A" — the same
// bucket whose revenue matches what client_spend_actuals already tracks),
// pulled from the same response with no extra Everflow call. This is the
// "we billed the advertiser for N revenue events" denominator for
// quality-as-a-percentage (eventCount / billedEventCount). Uses reporting.cv
// (approved/valid conversions), not total_cv (includes scrubbed/invalid
// attempts that never actually bill) — confirmed live that cv's row is the
// one whose revenue lines up with spend tracking. null (not 0) if the base
// row is missing from the response — treat null/0 identically as "no
// percentage available," never divide by zero.
export async function fetchAdvertiserQualityEvent(
  advertiserId: string,
  eventName: string,
  from: string,
  to: string,
): Promise<AdvertiserQualityEvent | null> {
  const data = await call("/networks/reporting/entity/table", {
    from,
    to,
    timezone_id: UTC_TIMEZONE_ID,
    currency_id: "USD",
    columns: [{ column: "advertiser" }, { column: "advertiser_event_name" }],
    query: {
      filters: [{ resource_type: "advertiser", filter_id_value: String(advertiserId) }],
    },
  });

  const rows: any[] = Array.isArray(data?.table) ? data.table : [];
  const target = eventName.trim().toLowerCase();
  const row = rows.find((r) => {
    const label = r?.columns?.find((c: any) => c?.column_type === "advertiser_event_name")?.label;
    return typeof label === "string" && label.trim().toLowerCase() === target;
  });
  if (!row) return null;

  const baseRow = rows.find((r) => {
    const col = r?.columns?.find((c: any) => c?.column_type === "advertiser_event_name");
    return col?.id === "0" || col?.label === "N/A";
  });
  const baseReporting = baseRow?.reporting ?? {};
  const billedEventCount = typeof baseReporting.cv === "number" ? Math.round(baseReporting.cv) : null;

  const reporting = row.reporting ?? {};
  return {
    eventCount: typeof reporting.event === "number" ? Math.round(reporting.event) : null,
    eventRevenue: typeof reporting.event_revenue === "number" ? Math.round(reporting.event_revenue) : null,
    billedEventCount,
    raw: row,
  };
}

// Per-offer revenue/payout breakdown for one advertiser over [from, to] —
// some advertisers run several simultaneous Everflow offers under one
// account (e.g. tiered payouts T1/T2/T3/T4 for the same property). Grouping
// by the "offer" column breaks the same entity/table report out one row per
// offer, mirroring how fetchAdvertiserQualityEvent breaks it out by
// "advertiser_event_name" — same endpoint, same advertiser-only filter, just
// a different grouping column.
//
// UNLIKE its neighbors above, this has NOT been confirmed against a live
// Everflow response — the "offer" column name and each row's
// column_type/id/label shape are inferred from Everflow's reporting-API
// pattern (documented at developers.everflow.io under
// network/reporting/aggregated_data) rather than verified with a real
// advertiser/offer id. Sanity-check the first live sync's raw response
// (client_offer_spend_actuals.everflow_raw) against what this expects before
// trusting it unattended.
//
// Returns [] (not null) if the advertiser has no offer rows in range — an
// empty result set here just means nothing to sync, not an error, and lets
// callers iterate without a null check.
export async function fetchAdvertiserOfferBreakdown(
  advertiserId: string,
  from: string,
  to: string,
): Promise<AdvertiserOffer[]> {
  const data = await call("/networks/reporting/entity/table", {
    from,
    to,
    timezone_id: UTC_TIMEZONE_ID,
    currency_id: "USD",
    columns: [{ column: "advertiser" }, { column: "offer" }],
    query: {
      filters: [{ resource_type: "advertiser", filter_id_value: String(advertiserId) }],
    },
  });

  const rows: any[] = Array.isArray(data?.table) ? data.table : [];
  const offers: AdvertiserOffer[] = [];
  for (const row of rows) {
    const col = row?.columns?.find((c: any) => c?.column_type === "offer");
    // Skip the no-offer/"N/A" bucket, same way the quality-event lookup
    // skips its own base bucket — nothing meaningful to track per-offer there.
    if (!col?.id || col.id === "0" || col.label === "N/A") continue;

    const reporting = row.reporting ?? {};
    offers.push({
      offerId: String(col.id),
      offerName: typeof col.label === "string" ? col.label : null,
      revenue: typeof reporting.revenue === "number" ? Math.round(reporting.revenue) : null,
      payout: typeof reporting.payout === "number" ? Math.round(reporting.payout) : null,
      raw: row,
    });
  }
  return offers;
}
