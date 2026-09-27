// ---------------------------------------------------------------------------
// Review Queue auto-sort: files the suggestions a person would only rubber
// stamp, so the queue holds just the real decisions. Runs each time the queue
// loads (ReviewQueueView). The Gmail poller does the same matching up front
// for new mail (supabase/functions/_shared/companyMatch.ts) once deployed.
//
//   - New people at a company already in the CRM (matched by domain or by the
//     company name in the email address) are added to that company.
//   - "You emailed a new contact" at a company that already has a deal is
//     attached to that deal.
//   - Suggestions from bounces, no-reply and help desk addresses are cleared.
//   - "Reply received" stage moves are accepted when auto-advance is on.
// Brand-new companies, and new contacts at companies with no deal yet, stay
// for a person to decide.
// ---------------------------------------------------------------------------
import { supabase } from './supabaseClient.js';
import { gmail } from './gmail.js';
import { buildCompanyIndex, isAutomatedAddress, matchCompany, normalizeDomain } from './companyMatch.js';

const FREE_MAIL = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com',
  'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com',
]);

async function companyIndex() {
  const { data, error } = await supabase.from('leads').select('id, company_name, domain, website, deal_id');
  if (error) throw new Error(error.message);
  return buildCompanyIndex(data ?? []);
}

// Give a company its email domain when it has none, so the next email from
// there matches by domain straight away.
async function fillDomain(lead, domain) {
  if (lead.domain || !domain) return;
  await supabase.from('leads').update({ domain }).eq('id', lead.id).is('domain', null);
  lead.domain = domain;
}

export async function autoSortQueue({ suggestions, companies, autoAdvance }) {
  const index = await companyIndex();
  const done = { people: [], attached: [], cleared: 0, advanced: [], errors: 0 };

  // New people at companies already in the CRM.
  for (const c of companies) {
    const domain = normalizeDomain(c.domain);
    const hit = c.matched_lead_id ? { lead: { id: c.matched_lead_id } } : matchCompany(index, domain);
    if (!hit) continue;
    try {
      if (!c.matched_lead_id) {
        const up = await supabase.from('company_suggestions').update({ matched_lead_id: hit.lead.id }).eq('id', c.id);
        if (up.error) throw new Error(up.error.message);
      }
      await gmail.acceptCompanySuggestion(c.id, null);
      if (hit.lead.company_name) await fillDomain(hit.lead, domain);
      done.people.push({ id: c.id, company: hit.lead.company_name ?? c.proposed_company_name ?? domain, count: c.contacts.length });
    } catch {
      done.errors++;
    }
  }

  for (const s of suggestions) {
    try {
      // Bounces, no-reply and help desks are never a real contact or reply.
      if (isAutomatedAddress(s.contact_email)) {
        await gmail.dismissSuggestion(s.id);
        done.cleared++;
        continue;
      }
      if (s.proposed_action === 'stage_move') {
        if (!autoAdvance) continue;
        try {
          await gmail.acceptStageMove(s.id);
          done.advanced.push({ id: s.id, email: s.contact_email });
        } catch {
          // The deal already moved past S1: nothing left to do.
          await gmail.dismissSuggestion(s.id);
          done.cleared++;
        }
        continue;
      }
      // A new contact at a company that already has a deal: file the thread there.
      const domain = normalizeDomain(s.contact_domain);
      if (!domain || FREE_MAIL.has(domain)) continue;
      const hit = matchCompany(index, domain);
      if (!hit?.lead.deal_id) continue;
      await gmail.attachSuggestionToDeal(s.id, hit.lead.deal_id);
      await fillDomain(hit.lead, domain);
      done.attached.push({ id: s.id, company: hit.lead.company_name });
    } catch {
      done.errors++;
    }
  }
  return done;
}

// One line for the top of the queue, or null when nothing was filed.
export function describeAutoSort(d) {
  const parts = [];
  const names = (list) => {
    const n = [...new Set(list.map((x) => x.company))];
    return n.length > 3 ? `${n.slice(0, 3).join(', ')} and ${n.length - 3} more` : n.join(', ');
  };
  if (d.attached.length) parts.push(`${d.attached.length} email${d.attached.length > 1 ? 's' : ''} filed to existing deal${d.attached.length > 1 ? 's' : ''} (${names(d.attached)})`);
  if (d.people.length) parts.push(`new people added to ${names(d.people)}`);
  if (d.advanced.length) parts.push(`${d.advanced.length} deal${d.advanced.length > 1 ? 's' : ''} moved to S2 on reply`);
  if (d.cleared) parts.push(`${d.cleared} bounce${d.cleared > 1 ? 's' : ''} or automated email${d.cleared > 1 ? 's' : ''} cleared`);
  return parts.length ? `Sorted for you: ${parts.join(' · ')}.` : null;
}
