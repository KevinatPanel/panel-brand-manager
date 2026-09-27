// classify-verticals: called by the authenticated client (the Companies board's
// auto-sort) with { lead_ids?, checked_before? }. Sends the unsorted companies the
// keyword rules couldn't place to Claude, in batches, with the workspace's
// verticals and a few companies already in each as examples. Claude picks an
// existing vertical, proposes a new one when several companies share an
// industry none of them covers, or leaves the company unsorted when it can't
// tell. Writes vertical_id / vertical_source 'ai' / vertical_reason and stamps
// vertical_checked_at so a company Claude couldn't place isn't re-sent on the
// next page load. Returns { placed, created, skipped, more }; the client calls
// again while more is true.
import Anthropic from "npm:@anthropic-ai/sdk@0.128";
import { zodOutputFormat } from "npm:@anthropic-ai/sdk@0.128/helpers/zod";
import { z } from "npm:zod@4";
import { serviceClient, userFromRequest } from "../_shared/supabase.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MODEL = "claude-sonnet-5";
const BATCH = 60; // companies per Claude call
const PER_RUN = 120; // companies per invocation, to stay inside the function time limit
const NEW_VERTICAL_MIN = 2; // a proposed vertical is created once this many companies share it

type Db = ReturnType<typeof serviceClient>;

interface Lead {
  id: number;
  company_name: string;
  domain: string | null;
  website: string | null;
  industry: string | null;
  description: string | null;
  apollo_keywords?: unknown;
}
interface Vertical {
  id: number;
  name: string;
}

const Result = z.object({
  results: z.array(z.object({
    id: z.number().int().describe("The company's id, exactly as given."),
    vertical: z.string().nullable().describe("An existing vertical's name, spelled exactly as listed, or null."),
    new_vertical: z.string().nullable().describe(
      "Only when vertical is null: a short, broad industry name for a new vertical (for example 'Travel', 'Education', 'Food & Beverage'). Null when the company can't be identified.",
    ),
    why: z.string().describe("One short line: what the company does and why it belongs there."),
  })),
});

const SYSTEM = `You sort companies into verticals for Panel, a creator user-acquisition company whose sales team keeps a CRM of brands (prospects and clients) grouped by vertical.

For every company you get, pick the vertical it belongs to by what the company actually sells to consumers. Use the example companies listed under each vertical to understand how this team draws the lines. Where two verticals overlap, follow the examples; when there are none, these are the usual lines:
- Fintech is consumer money apps (neobanks, cash advance, BNPL, investing and crypto apps, credit building). Financial services is traditional financial products (insurance, lending, banks, tax, debt relief).
- Healthtech is digital health products (telehealth, online pharmacy, GLP-1 programs, health apps). Health & Wellness is supplements, nutrition, mental wellbeing and self-care products.
- Sports betting is sportsbooks, casinos and daily fantasy. Prediction markets are event-contract exchanges. Gaming is video and mobile games.
- Rewarded UA is apps that pay users to play, shop or complete offers.

Rules:
- Use an existing vertical whenever one reasonably fits. Spell it exactly as listed.
- If none fits, leave vertical null and propose new_vertical: a broad industry name another company could share (not the company's own name, not a niche). Reuse the same wording for companies of the same kind in this batch, and reuse any vertical you see listed rather than inventing a synonym.
- Agencies, vendors, investors, media outlets, recruiters and other companies that aren't a brand Panel would sell to still get a vertical by what they do (for example 'Agencies & Partners').
- If you can't tell what the company does from what's given and don't recognize it, leave both null and say so in why.`;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const clip = (s: string | null | undefined, n: number) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

function describeLead(l: Lead): string {
  const parts = [`id ${l.id}: ${l.company_name}`];
  const site = l.domain || l.website;
  if (site) parts.push(`site ${site}`);
  if (l.industry) parts.push(`industry ${l.industry}`);
  const kw = Array.isArray(l.apollo_keywords) ? l.apollo_keywords.slice(0, 8).join(", ") : "";
  if (kw) parts.push(`keywords ${clip(kw, 160)}`);
  if (l.description) parts.push(`about: ${clip(l.description, 280)}`);
  return parts.join(" · ");
}

// Existing verticals with up to five companies already in each.
async function verticalGuide(db: Db, verticals: Vertical[]): Promise<string> {
  const { data } = await db
    .from("leads")
    .select("company_name, vertical_id")
    .not("vertical_id", "is", null)
    .order("is_client", { ascending: false })
    .limit(2000);
  const examples = new Map<number, string[]>();
  for (const l of data ?? []) {
    const list = examples.get(l.vertical_id) ?? [];
    if (list.length < 5) list.push(l.company_name);
    examples.set(l.vertical_id, list);
  }
  return verticals
    .map((v) => {
      const ex = examples.get(v.id);
      return `- ${v.name}${ex?.length ? ` (e.g. ${ex.join(", ")})` : ""}`;
    })
    .join("\n");
}

// Unsorted companies not placed by a person and not already checked by Claude
// (or checked before checked_before, for a re-check). Falls back to plain
// unsorted before migration 0054.
async function loadUnsorted(db: Db, leadIds: number[] | null, checkedBefore: string | null) {
  const cols = "id, company_name, domain, website, industry, description, apollo_keywords:apollo_raw->keywords";
  const base = (extra = "") => {
    let q = db.from("leads").select(cols + extra).is("vertical_id", null).order("id");
    if (leadIds?.length) q = q.in("id", leadIds);
    return q;
  };
  const q = base(", vertical_source");
  const first = await (checkedBefore
    ? q.or(`vertical_checked_at.is.null,vertical_checked_at.lt."${checkedBefore}"`)
    : q.is("vertical_checked_at", null)
  ).limit(500);
  if (!first.error) {
    // A person left these Unsorted on purpose.
    const rows = (first.data ?? []).filter((l) => (l as { vertical_source?: string }).vertical_source !== "manual");
    return { rows: rows as unknown as Lead[], tracked: true };
  }
  if (!["42703", "PGRST204"].includes(first.error.code ?? "")) throw new Error(first.error.message);
  const plain = await base().limit(PER_RUN + 1);
  if (plain.error) throw new Error(plain.error.message);
  return { rows: (plain.data ?? []) as unknown as Lead[], tracked: false };
}

async function classifyBatch(client: Anthropic, guide: string, batch: Lead[]) {
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: SYSTEM,
    output_config: { effort: "low", format: zodOutputFormat(Result) },
    messages: [{
      role: "user",
      content: `Verticals:\n${guide}\n\nCompanies to sort (${batch.length}):\n${batch.map(describeLead).join("\n")}`,
    }],
  });
  if (response.stop_reason === "refusal") throw new Error("Claude declined to sort this batch.");
  if (!response.parsed_output) throw new Error("Could not read Claude's sorting result.");
  return response.parsed_output.results;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const user = await userFromRequest(req);
  if (!user) return json({ error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  const leadIds = Array.isArray(body?.lead_ids) ? body.lead_ids.map(Number).filter(Boolean) : null;
  const cb = typeof body?.checked_before === "string" ? body.checked_before : null;
  const checkedBefore = cb && !isNaN(Date.parse(cb)) ? new Date(cb).toISOString() : null;

  const db = serviceClient();
  try {
    const { rows, tracked } = await loadUnsorted(db, leadIds, checkedBefore);
    const todo = rows.slice(0, PER_RUN);
    if (!todo.length) return json({ placed: 0, created: [], skipped: 0, more: false });

    const vres = await db.from("verticals").select("id, name").order("position").order("name");
    if (vres.error) throw new Error(vres.error.message);
    const verticals: Vertical[] = vres.data ?? [];
    const byName = new Map(verticals.map((v) => [v.name.toLowerCase(), v]));

    const client = new Anthropic();
    const decided: { lead: Lead; verticalName: string | null; proposed: string | null; why: string }[] = [];
    for (let i = 0; i < todo.length; i += BATCH) {
      const batch = todo.slice(i, i + BATCH);
      // Rebuild the guide each batch so new verticals from the last one are reused.
      const guide = await verticalGuide(db, verticals);
      const results = await classifyBatch(client, guide, batch);
      const byId = new Map(results.map((r) => [r.id, r]));
      for (const lead of batch) {
        const r = byId.get(lead.id);
        decided.push({
          lead,
          verticalName: r?.vertical ?? null,
          proposed: r?.new_vertical?.trim() || null,
          why: r?.why ?? "Claude didn't return a result for this company.",
        });
      }
      // Create proposed verticals that enough companies share, so the next
      // batch sees them as existing.
      const counts = new Map<string, number>();
      for (const d of decided) {
        if (!d.verticalName && d.proposed && !byName.has(d.proposed.toLowerCase())) {
          counts.set(d.proposed, (counts.get(d.proposed) ?? 0) + 1);
        }
      }
      for (const [name, n] of counts) {
        if (n < NEW_VERTICAL_MIN) continue;
        const ins = await db
          .from("verticals")
          .insert({ name, position: verticals.length, created_at: new Date().toISOString() })
          .select("id, name")
          .single();
        // Already there under different casing, or created meanwhile: reuse it.
        const row = ins.error
          ? (await db.from("verticals").select("id, name").ilike("name", name).maybeSingle()).data
          : ins.data;
        if (!row) continue;
        if (!verticals.some((v) => v.id === row.id)) verticals.push(row);
        byName.set(name.toLowerCase(), row);
      }
    }

    // Group writes by vertical: one update per vertical, one for the rest.
    const created = verticals.filter((v) => !vres.data?.some((x) => x.id === v.id)).map((v) => v.name);
    const now = new Date().toISOString();
    let placed = 0;
    let skipped = 0;
    for (const d of decided) {
      const v = byName.get((d.verticalName ?? d.proposed ?? "").toLowerCase()) ?? null;
      const why = v
        ? d.why
        : d.proposed
          ? `Suggested a new vertical "${d.proposed}", not created because no other company shares it yet. ${d.why}`
          : d.why;
      const patch: Record<string, unknown> = { vertical_id: v?.id ?? null, updated_at: now };
      if (tracked) Object.assign(patch, { vertical_source: v ? "ai" : null, vertical_reason: clip(why, 400), vertical_checked_at: now });
      if (!v && !tracked) { skipped++; continue; }
      // Only fill companies that are still unsorted (a person may have moved one meanwhile).
      const up = await db.from("leads").update(patch).eq("id", d.lead.id).is("vertical_id", null);
      if (up.error) throw new Error(up.error.message);
      if (v) placed++;
      else skipped++;
    }

    // Before 0054 nothing marks a company as checked, so stop after one pass
    // rather than resending the ones Claude couldn't place.
    const more = tracked && rows.length > todo.length;
    return json({ placed, created, skipped, more });
  } catch (e) {
    let message = e instanceof Error ? e.message : String(e);
    if (e instanceof Anthropic.RateLimitError) message = "Claude is busy right now. Try again in a minute.";
    else if (e instanceof Anthropic.AuthenticationError) message = "The Anthropic API key isn't set up for this function.";
    else if (e instanceof Anthropic.APIError) message = `Claude API error ${e.status ?? ""}: ${e.message}`;
    return json({ error: message }, 500);
  }
});
