// analyze-transcript: called by the authenticated client with
// { attachment_id } after a meeting transcript is uploaded (or from the Calls
// view's Analyze button). Marks the call_insights row 'pending', returns
// immediately, and finishes the work in the background: download the file from
// the deal-attachments bucket, have Claude read it, and write the structured
// call data (sides, minutes, questions, objections, buy-in moment, payout,
// action items) onto the row as 'done' — or 'error' with a reason. The client
// polls call_insights for the result.
import Anthropic from "npm:@anthropic-ai/sdk@0.128";
import { zodOutputFormat } from "npm:@anthropic-ai/sdk@0.128/helpers/zod";
import { z } from "npm:zod@4";
import { unzipSync, strFromU8 } from "npm:fflate@0.8";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";
import { serviceClient, userFromRequest } from "../_shared/supabase.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MODEL = "claude-opus-5";

// Panel's side of every call (mirrors OWNERS in client lib/stages.js).
const TEAM = ["Raven", "Tom", "Andrew", "Kevin"];

// What a brand's pushback is about — the columns of the Calls view's heatmap.
const THEMES = ["quality", "control", "mechanics", "scripts", "proof", "price", "supply", "tracking", "launch"] as const;
const THEME_GUIDE =
  "quality: user quality, retention, fraud, LTV. control: approval over creators or content, brand safety. " +
  "mechanics: how the model works, who pays whom, how Panel makes money. scripts: scripts, authenticity, creative. " +
  "proof: case studies, examples, other clients. price: CPA, payout, budget, fees. " +
  "supply: creator pool, niche, geography, audience fit. tracking: attribution, MMP, postbacks, reporting. " +
  "launch: contracts, legal, compliance, timelines, setup.";

const CallSchema = z.object({
  call_date: z.string().nullable().describe("Date of the call as YYYY-MM-DD, only if stated in the transcript."),
  brand_side: z.string().nullable().describe("Brand-side attendees, e.g. 'Harrison, head of marketing; Brian'."),
  panel_side: z.string().nullable().describe("Panel attendees by first name, e.g. 'Raven, Tom'."),
  minutes: z.number().int().nullable().describe("Call length in whole minutes, from timestamps or stated duration."),
  questions_count: z.number().int().nullable().describe("Number of distinct questions the brand side asked."),
  result: z.enum(["yes", "follow_up", "no", "unclear"]).describe(
    "yes = brand agreed to a pilot/test/deal; follow_up = open with a concrete next step; no = declined or no fit; unclear = cannot tell.",
  ),
  outcome: z.string().describe("One line on what the call ended on, e.g. 'Yes. $35 on account creation, $10K cap.'"),
  summary: z.string().describe("Two or three plain sentences on what was discussed."),
  next_step: z.string().nullable().describe("The single agreed next step, if any."),
  action_items: z.array(z.object({
    owner: z.string().describe("Who owns it: a Panel first name, the brand contact's name, or 'Brand' / 'Panel'."),
    task: z.string().describe("The concrete thing to do."),
    due: z.string().nullable().describe("When, if a date or timeframe was said."),
  })).describe("Every follow-up someone committed to on the call."),
  pushback: z.array(z.object({
    theme: z.enum(THEMES).describe(THEME_GUIDE),
    text: z.string().describe("The objection or hard question, close to the brand's own words."),
  })).describe("One entry per objection, concern or hard question the brand raised."),
  decision_layers: z.array(z.string()).describe(
    "People or teams the brand said must sign off between this call and a signature, e.g. 'legal', 'manager', 'founder', 'agency', 'IT'.",
  ),
  profile: z.object({
    kpi_owner_on_call: z.boolean().nullable().describe("Someone accountable for a cost-per-user KPI was on the call."),
    named_flat_fee_pain: z.boolean().nullable().describe("The brand described flat-fee creator spend as a problem in their own words."),
    can_sign_alone: z.boolean().nullable().describe("The brand-side person can approve the deal without anyone else."),
    cheap_frequent_event: z.boolean().nullable().describe("The brand has a cheap, frequent event to pay on (signup, install, onboard)."),
    tracking_ready: z.boolean().nullable().describe("Their tracking stack (MMP, affiliate platform, postbacks) can report that event."),
    ok_with_ad_approval: z.boolean().nullable().describe("They're fine approving at the ad level rather than vetting every creator first."),
    supply_restriction: z.boolean().nullable().describe("They restrict which creators can work on it (geography, niche, look, audience)."),
  }).describe("Buyer profile checks: true or false only when the call establishes it, otherwise null."),
  buy_in_quote: z.string().nullable().describe("The brand's own words at the moment they bought in, verbatim if possible."),
  buy_in_at: z.string().nullable().describe("Timestamp of that moment in the call, e.g. '27:11', if the transcript has timestamps."),
  buy_in_before: z.string().nullable().describe("What was said or shown right before the buy-in."),
  payout: z.string().nullable().describe("CPA / payout discussed, e.g. '$35 on account creation'."),
  budget_cap: z.string().nullable().describe("Budget or cap discussed, e.g. '$10K'."),
  payable_event: z.string().nullable().describe("The event the brand pays on: signup, install, deposit, etc."),
});
type CallData = z.infer<typeof CallSchema>;

const SYSTEM = `You read sales call transcripts for Panel, a performance creator-marketing platform: brands pay per verified event (signup, install, deposit…) instead of flat creator fees. Panel's team on calls: ${TEAM.join(", ")}.

Extract what actually happened on the call. Report facts from the transcript only. Leave a field null (or a list empty) when the transcript doesn't establish it — never guess or recommend. Keep quotes close to the speaker's words.`;

type Db = ReturnType<typeof serviceClient>;

interface Attachment {
  id: number;
  deal_id: number;
  filename: string;
  storage_path: string;
  content_type: string | null;
  created_at: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Word .docx is a zip; the body text lives in word/document.xml.
function docxText(bytes: Uint8Array): string {
  const files = unzipSync(bytes, { filter: (f) => f.name === "word/document.xml" });
  const xml = files["word/document.xml"];
  if (!xml) throw new Error("Could not read this .docx file.");
  return strFromU8(xml)
    .replace(/<\/w:p>/g, "\n")
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

// The transcript as Claude message content: PDFs go in as a document block,
// everything readable as text goes in as text.
async function transcriptContent(
  att: Attachment,
  blob: Blob,
): Promise<Anthropic.ContentBlockParam[]> {
  const name = att.filename.toLowerCase();
  const type = (att.content_type ?? "").toLowerCase();

  if (type === "application/pdf" || name.endsWith(".pdf")) {
    const data = encodeBase64(new Uint8Array(await blob.arrayBuffer()));
    return [{ type: "document", source: { type: "base64", media_type: "application/pdf", data } }];
  }
  if (name.endsWith(".docx") || type.includes("wordprocessingml")) {
    return [{ type: "text", text: docxText(new Uint8Array(await blob.arrayBuffer())) }];
  }
  if (name.endsWith(".doc") || type === "application/msword") {
    throw new Error("Old .doc files can't be read. Re-save the transcript as .docx, .pdf or .txt and upload it again.");
  }
  return [{ type: "text", text: await blob.text() }];
}

function validDate(s: string | null): string | null {
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s)) ? s : null;
}

async function analyze(db: Db, att: Attachment): Promise<void> {
  const deal = await db
    .from("deal_summaries")
    .select("company_name")
    .eq("id", att.deal_id)
    .maybeSingle();
  const brand = deal.data?.company_name ?? "the brand";

  const file = await db.storage.from("deal-attachments").download(att.storage_path);
  if (file.error || !file.data) throw new Error("Could not download the transcript file.");
  const transcript = await transcriptContent(att, file.data);

  const client = new Anthropic();
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: SYSTEM,
    output_config: { effort: "medium", format: zodOutputFormat(CallSchema) },
    messages: [{
      role: "user",
      content: [
        ...transcript,
        {
          type: "text",
          text: `Brand: ${brand}\nFile: ${att.filename}\nUploaded: ${att.created_at.slice(0, 10)}\n\nExtract the call data from the transcript above.`,
        },
      ],
    }],
  });

  if (response.stop_reason === "refusal") throw new Error("Claude declined to analyze this transcript.");
  if (response.stop_reason === "max_tokens") throw new Error("The analysis was cut off. Try again.");
  const out: CallData | null = response.parsed_output;
  if (!out) throw new Error("Could not read the analysis result. Try again.");

  const upd = await db.from("call_insights").update({
    status: "done",
    error: null,
    call_date: validDate(out.call_date),
    brand_side: out.brand_side,
    panel_side: out.panel_side,
    minutes: out.minutes,
    questions_count: out.questions_count,
    result: out.result,
    outcome: out.outcome,
    summary: out.summary,
    next_step: out.next_step,
    action_items: out.action_items,
    objections: out.pushback.map((p) => p.text),
    pushback: out.pushback,
    decision_layers: out.decision_layers,
    // Keep only the checks the call actually established.
    profile: Object.fromEntries(Object.entries(out.profile).filter(([, v]) => v != null)),
    buy_in_quote: out.buy_in_quote,
    buy_in_at: out.buy_in_at,
    buy_in_before: out.buy_in_before,
    payout: out.payout,
    budget_cap: out.budget_cap,
    payable_event: out.payable_event,
    analyzed_at: new Date().toISOString(),
  }).eq("attachment_id", att.id);
  if (upd.error) throw new Error(upd.error.message);
}

async function runAnalysis(db: Db, att: Attachment): Promise<void> {
  try {
    await analyze(db, att);
  } catch (e) {
    let message = e instanceof Error ? e.message : String(e);
    if (e instanceof Anthropic.RateLimitError) message = "Claude is busy right now. Try again in a minute.";
    else if (e instanceof Anthropic.AuthenticationError) message = "The Anthropic API key isn't set up for this function.";
    else if (e instanceof Anthropic.APIError) message = `Claude API error ${e.status ?? ""}: ${e.message}`;
    await db.from("call_insights").update({ status: "error", error: message }).eq("attachment_id", att.id);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const user = await userFromRequest(req);
  if (!user) return json({ error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  const attachmentId = Number(body?.attachment_id);
  if (!attachmentId) return json({ error: "attachment_id is required" }, 400);

  const db = serviceClient();
  const { data: att } = await db
    .from("deal_attachments")
    .select("id, deal_id, filename, storage_path, content_type, created_at")
    .eq("id", attachmentId)
    .eq("kind", "transcript")
    .maybeSingle();
  if (!att) return json({ error: "Transcript not found" }, 404);

  const up = await db.from("call_insights").upsert(
    {
      attachment_id: att.id,
      deal_id: att.deal_id,
      status: "pending",
      error: null,
      requested_at: new Date().toISOString(),
    },
    { onConflict: "attachment_id" },
  );
  if (up.error) return json({ error: up.error.message }, 500);

  // Reading a long transcript takes a while — finish after responding.
  const work = runAnalysis(db, att as Attachment);
  const rt = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(work);
  else await work;

  return json({ status: "pending" }, 202);
});
