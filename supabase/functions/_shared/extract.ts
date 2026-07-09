// Claude-powered extraction of the external person + their company from a single
// (sent) email. The pollers/backfill feed in the From/To/Cc + subject + decoded
// plaintext body (signature included); Claude returns one structured record we
// turn into a contact/company suggestion.
//
// Defensive by design: a bad email, a timeout, or an API hiccup returns null so
// one message never kills a backfill batch. Uses a forced tool call so the model
// must answer in our schema (no free-text parsing).

const ANTHROPIC = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-4-5-20251001"; // cheap + fast for backfill scale
const TIMEOUT_MS = 20_000;
const MAX_BODY_CHARS = 6_000; // signatures live near the top; cap tokens/cost

export interface ExtractInput {
  from: string; // raw From header (may be "Name <email>")
  to: string[]; // recipient addresses (the external counterparties)
  subject: string | null;
  body: string; // decoded plaintext, quoted reply chain already stripped
}

export interface ExtractedPerson {
  name: string | null;
  title: string | null;
  phone: string | null;
  linkedin: string | null;
  location: string | null;
  seniority: string | null;
}

export interface Extracted {
  company_name: string | null;
  person: ExtractedPerson;
  confidence: "high" | "medium" | "low";
}

const TOOL = {
  name: "record_contact",
  description:
    "Record the external person and their company inferred from the email. " +
    "The external person is the recipient (To/Cc), NOT the sender (the sender is " +
    "our own rep). Pull title/phone/LinkedIn/location from the signature block or " +
    "body when present. Use null for anything not stated — never guess. Set " +
    "confidence to how sure you are this is a real business contact at a real company.",
  input_schema: {
    type: "object",
    properties: {
      company_name: { type: ["string", "null"], description: "The recipient's company / brand name." },
      person: {
        type: "object",
        properties: {
          name: { type: ["string", "null"] },
          title: { type: ["string", "null"], description: "Job title, e.g. 'VP Growth'." },
          phone: { type: ["string", "null"] },
          linkedin: { type: ["string", "null"], description: "LinkedIn profile URL." },
          location: { type: ["string", "null"], description: "City / region, e.g. 'San Francisco, CA'." },
          seniority: { type: ["string", "null"], description: "Role level / department, e.g. 'Director, Marketing'." },
        },
        required: ["name", "title", "phone", "linkedin", "location", "seniority"],
      },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
    },
    required: ["company_name", "person", "confidence"],
  },
} as const;

export async function extractContact(input: ExtractInput): Promise<Extracted | null> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return null;

  const body = (input.body ?? "").slice(0, MAX_BODY_CHARS);
  const userText = [
    `From (our rep): ${input.from}`,
    `To/Cc (external contact): ${input.to.join(", ")}`,
    `Subject: ${input.subject ?? ""}`,
    "",
    "Email body:",
    body,
  ].join("\n");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(ANTHROPIC, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 512,
        tools: [TOOL],
        tool_choice: { type: "tool", name: TOOL.name },
        messages: [{ role: "user", content: userText }],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const block = (data.content ?? []).find(
      (b: { type: string; name?: string }) => b.type === "tool_use" && b.name === TOOL.name,
    );
    const out = block?.input as Extracted | undefined;
    if (!out || typeof out !== "object") return null;
    // Normalize shape so callers can rely on it.
    return {
      company_name: out.company_name ?? null,
      person: {
        name: out.person?.name ?? null,
        title: out.person?.title ?? null,
        phone: out.person?.phone ?? null,
        linkedin: out.person?.linkedin ?? null,
        location: out.person?.location ?? null,
        seniority: out.person?.seniority ?? null,
      },
      confidence: out.confidence === "high" || out.confidence === "low" ? out.confidence : "medium",
    };
  } catch {
    return null; // timeout / network / parse — skip this message
  } finally {
    clearTimeout(timer);
  }
}

// Decode a Gmail message payload (format=full) into plaintext, preferring
// text/plain parts, falling back to a crude HTML strip, then drop the quoted
// reply chain so the model focuses on the new message + signature.
export function plaintextFromPayload(payload: unknown): string {
  const text = collectText(payload);
  return stripQuoted(text);
}

function b64urlDecode(data: string): string {
  try {
    const norm = data.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(norm);
    // Gmail bodies are UTF-8; decode bytes properly.
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return "";
  }
}

interface Part {
  mimeType?: string;
  body?: { data?: string };
  parts?: Part[];
}

function collectText(payload: unknown): string {
  const p = payload as Part | undefined;
  if (!p) return "";
  // Walk parts: take the first text/plain we find; else stash HTML as fallback.
  let plain = "";
  let html = "";
  const walk = (node: Part) => {
    if (node.mimeType === "text/plain" && node.body?.data && !plain) {
      plain = b64urlDecode(node.body.data);
    } else if (node.mimeType === "text/html" && node.body?.data && !html) {
      html = b64urlDecode(node.body.data);
    }
    for (const child of node.parts ?? []) walk(child);
  };
  walk(p);
  if (plain) return plain;
  if (html) {
    return html
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n");
  }
  return "";
}

// Trim the quoted reply chain ("On <date> X wrote:", leading ">" lines, Outlook
// "From:" separators) so we keep the new message + signature only.
function stripQuoted(text: string): string {
  if (!text) return "";
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    if (/^\s*On .+ wrote:\s*$/.test(line)) break;
    if (/^\s*-{2,}\s*Original Message\s*-{2,}/i.test(line)) break;
    if (/^\s*From:\s.+@/i.test(line) && out.length > 0) break;
    if (/^\s*>/.test(line)) continue;
    out.push(line);
  }
  return out.join("\n").trim();
}
