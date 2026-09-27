// Match an email domain to a company already in the CRM: by its domain or
// website, or by the company name in the address (chris@udemy.com -> Udemy,
// help@mail.paysend.com -> Paysend, hi@getdave.com -> Dave). Only an
// unambiguous match counts. Mirrors client/src/lib/companyMatch.js, which the
// Review Queue uses to sort what's already queued; keep the two in step.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

const TWO_PART_TLDS = new Set(["co.uk", "com.au", "co.nz", "co.in", "com.br", "co.za", "com.mx", "co.jp", "org.uk"]);
const NAME_PREFIXES = ["get", "try", "join", "use", "go", "hello", "my", "the", "with", "meet"];
const NAME_SUFFIXES = ["app", "hq", "inc", "io", "official", "team", "usa", "us", "group", "mail", "email"];
const COMPANY_WORDS = /\b(inc|llc|l\.l\.c|ltd|limited|corp|corporation|co|company|technologies|technology|labs|holdings|group|app|hq|the)\b\.?/g;

export function normalizeDomain(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#:]/)[0];
}

// "mail.udemy.com" -> "udemy"; "shop.brand.co.uk" -> "brand".
export function domainKey(domain: string): string {
  const labels = normalizeDomain(domain).split(".").filter(Boolean);
  if (labels.length < 2) return labels[0] ?? "";
  const lastTwo = labels.slice(-2).join(".");
  const cut = TWO_PART_TLDS.has(lastTwo) && labels.length > 2 ? 2 : 1;
  return labels[labels.length - 1 - cut].replace(/[^a-z0-9]/g, "");
}

// "Udemy, Inc." -> "udemy"; "The Farmer's Dog" -> "farmersdog".
export function nameKey(name: unknown): string {
  return String(name ?? "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(COMPANY_WORDS, " ")
    .replace(/[^a-z0-9]/g, "");
}

// The ways a domain's name part might spell a company name.
function keyVariants(key: string): Set<string> {
  const out = new Set<string>([key]);
  for (const p of NAME_PREFIXES) if (key.startsWith(p) && key.length - p.length >= 3) out.add(key.slice(p.length));
  for (const v of [...out]) {
    for (const s of NAME_SUFFIXES) if (v.endsWith(s) && v.length - s.length >= 3) out.add(v.slice(0, -s.length));
  }
  return out;
}

export interface CompanyRow {
  id: number;
  company_name: string | null;
  domain: string | null;
  website: string | null;
  deal_id: number | null;
  in_pipeline?: boolean | null;
}
export interface CompanyIndex {
  byDomain: Map<string, CompanyRow>;
  byName: Map<string, CompanyRow[]>;
  names: [string, CompanyRow][];
}

// Build once per list of companies.
export function buildCompanyIndex(leads: CompanyRow[]): CompanyIndex {
  const byDomain = new Map<string, CompanyRow>();
  const byName = new Map<string, CompanyRow[]>();
  const names: [string, CompanyRow][] = [];
  for (const l of leads) {
    for (const d of [l.domain, l.website]) {
      const n = normalizeDomain(d);
      if (n && n.includes(".") && !byDomain.has(n)) byDomain.set(n, l);
    }
    const k = nameKey(l.company_name);
    if (k.length >= 3) {
      byName.set(k, [...(byName.get(k) ?? []), l]);
      names.push([k, l]);
    }
  }
  return { byDomain, byName, names };
}

// The company an email domain belongs to, with how it matched, or null.
export function matchCompany(index: CompanyIndex, domain: string): { lead: CompanyRow; how: "domain" | "name" } | null {
  const d = normalizeDomain(domain);
  if (!d) return null;
  // Exact domain, including a subdomain of a company's domain (mail.udemy.com).
  const labels = d.split(".");
  for (let i = 0; i < labels.length - 1; i++) {
    const hit = index.byDomain.get(labels.slice(i).join("."));
    if (hit) return { lead: hit, how: "domain" as const };
  }
  const key = domainKey(d);
  if (key.length < 3) return null;
  // Name part equals a company name.
  const exact = new Map<number, CompanyRow>();
  for (const v of keyVariants(key)) for (const l of index.byName.get(v) ?? []) exact.set(l.id, l);
  if (exact.size === 1) return { lead: [...exact.values()][0], how: "name" as const };
  if (exact.size > 1) return null;
  // Name part starts with a longer company name.
  const contained = index.names.filter(([k]) => k.length >= 5 && key.startsWith(k));
  const ids = new Set(contained.map(([, l]) => l.id));
  if (ids.size === 1) return { lead: contained[0][1], how: "name" as const };
  return null;
}

// Every company, indexed for matching. Loaded once per poll or backfill run.
export async function loadCompanyIndex(db: SupabaseClient): Promise<CompanyIndex> {
  const { data } = await db.from("leads").select("id, company_name, domain, website, deal_id, in_pipeline");
  return buildCompanyIndex((data ?? []) as CompanyRow[]);
}

// Give a matched company its email domain when it has none, so later mail
// from there matches by domain directly.
export async function fillCompanyDomain(db: SupabaseClient, lead: CompanyRow, domain: string): Promise<void> {
  if (lead.domain || !domain) return;
  const { error } = await db.from("leads").update({ domain }).eq("id", lead.id).is("domain", null);
  if (!error) lead.domain = domain;
}
