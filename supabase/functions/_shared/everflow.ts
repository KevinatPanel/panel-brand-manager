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
