// Claude-powered extraction of the external people + their companies from a
// single email (sent OR received). The pollers/backfill feed in every
// participant (From/To/Cc/Bcc) + subject + decoded plaintext body (signature
// included); Claude returns one structured record per external person we're
// asking about, which we turn into contact/company suggestions.
//
// Defensive by design: a bad email, a timeout, or an API hiccup returns null so
// one message never kills a backfill batch. Uses a forced tool call so the model
// must answer in our schema (no free-text parsing).

const ANTHROPIC = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-4-5-20251001"; // cheap + fast for backfill scale
const TIMEOUT_MS = 20_000;
const MAX_BODY_CHARS = 6_000; // signatures live near the top; cap tokens/cost

export type ParticipantRole = "from" | "to" | "cc" | "bcc";

export interface Participant {
  email: string;
  role: ParticipantRole;
  displayName: string; // "" when the header had no display name
}

export interface ExtractInput {
  direction: "outbound" | "inbound";
  rep: string; // the connected rep's own address
  participants: Participant[]; // everyone on the message
  people: string[]; // the external addresses we want records for
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
  company_name: string | null;
}

export interface Extracted {
  people: Map<string, ExtractedPerson>; // keyed by lowercase email
  confidence: "high" | "medium" | "low";
}

const TOOL = {
  name: "record_contacts",
  description:
    "Record each requested external person and their company, inferred from the email. " +
    "Return exactly one entry per requested email address. Pull name/title/phone/LinkedIn/" +
    "location from signature blocks, greetings or the body only when they clearly belong " +
    "to THAT person (a signature usually belongs to the sender). Use null for anything not " +
    "stated — never guess, and never copy one person's details onto another. Set confidence " +
    "to how sure you are these are real business contacts at real companies.",
  input_schema: {
    type: "object",
    properties: {
      people: {
        type: "array",
        items: {
          type: "object",
          properties: {
            email: { type: "string", description: "One of the requested addresses, verbatim." },
            name: { type: ["string", "null"] },
            title: { type: ["string", "null"], description: "Job title, e.g. 'VP Growth'." },
            phone: { type: ["string", "null"] },
            linkedin: { type: ["string", "null"], description: "LinkedIn profile URL." },
            location: { type: ["string", "null"], description: "City / region, e.g. 'San Francisco, CA'." },
            seniority: { type: ["string", "null"], description: "Role level / department, e.g. 'Director, Marketing'." },
            company_name: { type: ["string", "null"], description: "This person's company / brand name." },
          },
          required: ["email", "name", "title", "phone", "linkedin", "location", "seniority", "company_name"],
        },
      },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
    },
    required: ["people", "confidence"],
  },
} as const;

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export async function extractPeople(input: ExtractInput): Promise<Extracted | null> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey || input.people.length === 0) return null;

  const body = (input.body ?? "").slice(0, MAX_BODY_CHARS);
  const fmt = (p: Participant) => (p.displayName ? `${p.displayName} <${p.email}>` : p.email);
  const byRole = (role: ParticipantRole) =>
    input.participants.filter((p) => p.role === role).map(fmt).join(", ");
  const userText = [
    `Our rep (ignore — not an external contact): ${input.rep}`,
    `Direction: ${input.direction === "outbound" ? "sent by our rep" : "received by our rep"}`,
    `From: ${byRole("from")}`,
    `To: ${byRole("to")}`,
    `Cc: ${byRole("cc")}`,
    `Bcc: ${byRole("bcc")}`,
    `Subject: ${input.subject ?? ""}`,
    "",
    `Record these external people: ${input.people.join(", ")}`,
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
        max_tokens: 400 + 200 * input.people.length,
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
    const out = block?.input as { people?: unknown[]; confidence?: string } | undefined;
    if (!out || !Array.isArray(out.people)) return null;

    // Normalize shape so callers can rely on it; drop anything we didn't ask for.
    const wanted = new Set(input.people);
    const people = new Map<string, ExtractedPerson>();
    for (const raw of out.people) {
      const p = raw as Record<string, unknown>;
      const email = str(p.email)?.toLowerCase();
      if (!email || !wanted.has(email)) continue;
      people.set(email, {
        name: str(p.name),
        title: str(p.title),
        phone: str(p.phone),
        linkedin: str(p.linkedin),
        location: str(p.location),
        seniority: str(p.seniority),
        company_name: str(p.company_name),
      });
    }
    const confidence = out.confidence === "high" || out.confidence === "low" ? out.confidence : "medium";
    return { people, confidence };
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
