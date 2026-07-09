// Email parsing + deal-matching helpers shared by the pollers (and later the
// Phase 2 suggestion engine).

// Internal domain(s) — emails to/from these are never treated as a prospect.
export const INTERNAL_DOMAINS = ["panelforcreators.com"];

// Free / personal mail — never auto-suggested as an opportunity (still loggable
// when a thread is already linked to a deal).
export const FREE_MAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "yahoo.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
]);

// Transactional / automated mailbox local-parts that are never a real prospect.
// Conservative on purpose: we KEEP generic business inboxes (sales@, info@,
// hello@, contact@, partnerships@, marketing@) since those can be legit
// cold-outreach targets — only no-one-reads-this-as-a-person addresses go here.
export const ROLE_ADDRESS_LOCALPARTS = new Set([
  "noreply", "no-reply", "donotreply", "do-not-reply", "do_not_reply",
  "mailer-daemon", "mailerdaemon", "postmaster", "bounce", "bounces", "mailer",
  "notifications", "notification", "notify", "alerts", "alert",
  "receipts", "receipt", "billing", "invoice", "invoices", "payments", "payment",
  "updates", "news", "newsletter", "newsletters", "digest",
  "unsubscribe", "automated", "system", "daemon",
  "support", "help", "helpdesk", "customercare",
  "security", "abuse",
]);

// Is this a transactional / automated address (vs a real person/prospect)?
export function isRoleAddress(email: string): boolean {
  const local = (email.split("@")[0] ?? "").toLowerCase().split("+")[0];
  if (ROLE_ADDRESS_LOCALPARTS.has(local)) return true;
  // Suffixed variants: noreply-123@, bounce+tag@, mailer-daemon-x@.
  const prefixes = ["noreply", "no-reply", "donotreply", "do-not-reply", "bounce", "mailer-daemon", "mailerdaemon"];
  return prefixes.some((p) => local.startsWith(p));
}

// Pull a bare address out of a header value like `Name <a@b.com>` or `a@b.com`.
export function parseAddress(raw: string): string | null {
  if (!raw) return null;
  const m = raw.match(/<([^>]+)>/);
  const addr = (m ? m[1] : raw).trim().toLowerCase();
  return addr.includes("@") ? addr : null;
}

// Split a header that may hold multiple comma-separated addresses.
export function parseAddressList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((p) => parseAddress(p))
    .filter((a): a is string => !!a);
}

export function domainOf(email: string): string {
  return email.split("@")[1] ?? "";
}

// Normalize a domain for matching: lowercase, strip protocol / leading "www." /
// any path. "https://www.Acme.io/careers" and "acme.io" both -> "acme.io". Used
// to match an email's domain against leads.domain (and to store it consistently
// on company_suggestions). Returns "" when there is nothing usable.
export function normalizeDomain(raw: string | null | undefined): string {
  if (!raw) return "";
  let d = raw.trim().toLowerCase();
  d = d.replace(/^https?:\/\//, "");
  d = d.replace(/^www\./, "");
  d = d.split("/")[0];
  return d.includes(".") ? d : "";
}

export function isInternal(email: string): boolean {
  return INTERNAL_DOMAINS.includes(domainOf(email));
}

export function isFreeMail(email: string): boolean {
  return FREE_MAIL_DOMAINS.has(domainOf(email));
}

// The external counterparties on a message: everyone who isn't internal and
// isn't the connected rep themselves.
export function externalParties(addrs: string[], selfEmail: string): string[] {
  const self = selfEmail.toLowerCase();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of addrs) {
    if (a === self || isInternal(a)) continue;
    if (!seen.has(a)) {
      seen.add(a);
      out.push(a);
    }
  }
  return out;
}
