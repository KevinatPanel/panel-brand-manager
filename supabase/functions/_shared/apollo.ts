// Apollo.io API client shared by the enrichment function(s). Holds the
// X-Api-Key auth (the key lives only in Edge Function secrets, never the
// browser) and normalizes responses + errors so callers can tell apart:
//   - a clean "no match" (returns null) from
//   - a transient rate limit (429 -> ApolloError code 'rate_limited') from
//   - an endpoint gated by the plan tier (403 -> code 'plan_gated'; News/Jobs
//     are limited on Professional) from
//   - a hard auth failure (401 -> 'unauthorized').
//
// Endpoint names mirror the documented v1 API. If your Apollo plan exposes
// different paths, they are centralized here in BASE + the call() helpers.

const BASE = "https://api.apollo.io/api/v1";

export type ApolloErrorCode =
  | "rate_limited"
  | "unauthorized"
  | "plan_gated"
  | "http";

export class ApolloError extends Error {
  status: number;
  code: ApolloErrorCode;
  constructor(message: string, status: number, code: ApolloErrorCode) {
    super(message);
    this.name = "ApolloError";
    this.status = status;
    this.code = code;
  }
}

function apiKey(): string {
  const k = Deno.env.get("APOLLO_API_KEY");
  if (!k) throw new Error("APOLLO_API_KEY not set");
  return k;
}

interface CallOpts {
  method?: "GET" | "POST";
  query?: Record<string, string | number | undefined | null>;
  body?: Record<string, unknown>;
}

async function call(path: string, opts: CallOpts = {}): Promise<any> {
  const { method = "POST", query, body } = opts;
  const url = new URL(`${BASE}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v != null && v !== "") url.searchParams.set(k, String(v));
    }
  }

  const res = await fetch(url.toString(), {
    method,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
      "X-Api-Key": apiKey(),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 429) {
    throw new ApolloError("Apollo rate limit reached — try again shortly.", 429, "rate_limited");
  }
  if (res.status === 401) {
    throw new ApolloError("Apollo API key rejected (401).", 401, "unauthorized");
  }
  if (res.status === 403) {
    // 403 on a valid key means the endpoint/feature isn't on this plan tier.
    throw new ApolloError("This Apollo endpoint isn't available on your plan.", 403, "plan_gated");
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ApolloError(`Apollo HTTP ${res.status}: ${text.slice(0, 300)}`, res.status, "http");
  }
  return await res.json();
}

// example.com from "https://www.example.com/path" — null if nothing usable.
export function domainFromWebsite(website?: string | null): string | null {
  if (!website) return null;
  const cleaned = website
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0];
  return cleaned || null;
}

// ===== Enrichment =====

export interface OrgInput {
  domain?: string | null;
  website?: string | null;
  name?: string | null;
}

// Organization Enrichment — match a company by domain. CREDIT GUARD: a domain
// (from the domain column or derived from the website) is REQUIRED. We never
// match on company name alone — it's too broad and burns credits on the wrong
// company. Name is passed only as a secondary hint alongside the domain.
export async function enrichOrganization(input: OrgInput): Promise<any | null> {
  const domain = input.domain || domainFromWebsite(input.website);
  if (!domain) return null; // no Apollo call, no credit spent
  const data = await call("/organizations/enrich", {
    query: { domain, organization_name: input.name ?? undefined },
  });
  return data?.organization ?? null;
}

export interface PersonInput {
  email?: string | null;
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  domain?: string | null;
  organizationName?: string | null;
  linkedinUrl?: string | null;
}

// People Enrichment (people/match) — match a person by a STRONG unique
// identifier. CREDIT GUARD: an email or a LinkedIn URL is REQUIRED. Name +
// company/domain alone is too broad and wastes credits on the wrong person, so
// those are passed only as secondary hints. Returns the raw `person`, or null.
export async function enrichPerson(input: PersonInput): Promise<any | null> {
  const hasStrongId = !!(input.email || input.linkedinUrl);
  if (!hasStrongId) return null; // no Apollo call, no credit spent

  const body: Record<string, unknown> = {};
  if (input.email) body.email = input.email;
  if (input.linkedinUrl) body.linkedin_url = input.linkedinUrl;
  if (input.firstName) body.first_name = input.firstName;
  if (input.lastName) body.last_name = input.lastName;
  if (input.name && !input.firstName && !input.lastName) body.name = input.name;
  if (input.domain) body.domain = input.domain;
  if (input.organizationName) body.organization_name = input.organizationName;

  const data = await call("/people/match", { body });
  return data?.person ?? null;
}

// ===== Phase 2 stubs: intent signals (capability-gated) =====
// These wrap plan_gated errors as { available: false } instead of throwing, so
// the caller can degrade gracefully on Professional (News/Jobs are limited).

export interface CapabilityResult<T> {
  available: boolean;
  data: T | null;
  reason?: string;
}

export async function searchNews(
  organizationId: string,
  opts: { categories?: string[]; perPage?: number } = {},
): Promise<CapabilityResult<any[]>> {
  try {
    const data = await call("/news_articles/search", {
      body: {
        organization_ids: [organizationId],
        categories: opts.categories,
        per_page: opts.perPage ?? 25,
      },
    });
    return { available: true, data: data?.news_articles ?? [] };
  } catch (e) {
    if (e instanceof ApolloError && e.code === "plan_gated") {
      return { available: false, data: null, reason: e.message };
    }
    throw e;
  }
}

export async function jobPostings(
  organizationId: string,
  opts: { perPage?: number } = {},
): Promise<CapabilityResult<any[]>> {
  try {
    const data = await call(`/organizations/${organizationId}/job_postings`, {
      method: "GET",
      query: { per_page: opts.perPage ?? 25 },
    });
    return { available: true, data: data?.organization_job_postings ?? [] };
  } catch (e) {
    if (e instanceof ApolloError && e.code === "plan_gated") {
      return { available: false, data: null, reason: e.message };
    }
    throw e;
  }
}
