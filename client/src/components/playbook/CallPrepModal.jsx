import { useEffect, useState } from 'react';
import { Modal } from '../Overlay.jsx';
import { Button, Eyebrow } from '../ui.jsx';
import { api } from '../../lib/api.js';
import { playbook } from '../../lib/playbookApi.js';
import { dealEconomics } from '../../lib/economics.js';
import { useEconomics } from '../../lib/useEconomics.js';
import { classifyBrand, qualifierInputs, MODE_GUIDE } from '../../lib/qualifier.js';
import { TIERS, TIER_ORDER, tierOf } from '../../lib/buyerTiers.js';
import { CADENCE_STEPS } from '../../lib/cadence.js';
import { THEMES } from '../../lib/callStats.js';
import { fmtDate, fmtDateOnly } from '../../lib/dates.js';
import { money, ZoneChip } from './Zone.jsx';
import { QualifierChip } from './QualifierSection.jsx';
import { ThreadStatus } from './BuyerTier.jsx';
import { adLibraryUrl } from './AdLibrarySection.jsx';

function Block({ title, children }) {
  return (
    <section className="py-4 border-b border-hairline break-inside-avoid">
      <Eyebrow className="mb-2">{title}</Eyebrow>
      {children}
    </section>
  );
}
const Muted = ({ children }) => <p className="text-text-muted text-[12px]">{children}</p>;

// One page to read before a call: who they are, how they qualify, the offer
// math, who's who, what they've pushed on before, what they're paying
// creators for now, the latest touches, and the cadence to run.
export default function CallPrepModal({ deal, onClose }) {
  const settings = useEconomics();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    Promise.all([
      api.getLead(deal.lead_id),
      playbook.getQualifier(deal.lead_id),
      playbook.listAdChecks(deal.lead_id),
      playbook.getDealEconomics(deal.id),
      playbook.callsForDeal(deal.id),
      playbook.recentTouches(deal.id),
      playbook.listPlaybook('cadence'),
      playbook.listPlaybook('objection'),
      playbook.listPlaybook('qualifier'),
    ])
      .then(([lead, manual, adChecks, econ, calls, touches, cadence, answers, guide]) => {
        if (live) setData({ lead, manual, adCheck: adChecks[0] ?? null, econ, calls, touches, cadence, answers, guide });
      })
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [deal.id, deal.lead_id]);

  const body = () => {
    if (error) return <div className="text-red-400 text-[13px]">{error}</div>;
    if (!data) return <div className="text-text-secondary text-[13px]">Pulling it together…</div>;
    const { lead, manual, adCheck, econ, calls, touches, cadence, answers } = data;
    const q = classifyBrand(qualifierInputs(lead, manual), new Date(), adCheck);
    const e = econ ? dealEconomics(econ, settings) : null;
    const contacts = [...(lead.contacts ?? [])].sort(
      (a, b) => TIER_ORDER.indexOf(tierOf(a) ?? 'skip') - TIER_ORDER.indexOf(tierOf(b) ?? 'skip'),
    );
    const last = calls[0];
    const openItems = calls.flatMap((c) => (c.action_items ?? []).map((a) => ({ ...a, date: c.call_date })));
    const pushback = {};
    for (const c of calls) for (const p of c.pushback ?? []) (pushback[p.theme] ??= []).push(p.text);

    return (
      <div className="text-[13px]">
        <Block title="The brand">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-text-primary text-[16px] font-medium">{lead.company_name}</span>
            <QualifierChip result={q} />
            {e?.zone && <ZoneChip zone={e.zone} />}
          </div>
          <p className="text-text-secondary mt-1">
            {[lead.vertical_name, lead.headcount && `${lead.headcount} people`, lead.hq_location].filter(Boolean).join(' · ') || '—'}
          </p>
          {lead.description && <p className="text-text-muted text-[12px] mt-1 line-clamp-3">{lead.description}</p>}
          {q && (
            <p className="text-text-primary mt-2">
              <span className="text-text-muted">How to lead: </span>
              {q.mode && (data.guide?.[q.mode]?.body ?? MODE_GUIDE[q.mode])}
            </p>
          )}
          {q?.reasons?.length > 0 && <Muted>{q.reasons.join(' · ')}</Muted>}
        </Block>

        <Block title="The offer math">
          {econ ? (
            <div className="grid grid-cols-2 gap-x-6 gap-y-1">
              <span className="text-text-muted">Payable event</span><span className="text-text-primary">{econ.payable_event || '—'}</span>
              <span className="text-text-muted">Payout</span><span className="font-mono text-text-primary">{money(econ.cpa)}</span>
              <span className="text-text-muted">Creator eCPM</span><span className="font-mono text-text-primary">{money(e.ecpm)}</span>
              <span className="text-text-muted">Bid range</span>
              <span className="font-mono text-text-primary">{money(e.range.floor, 0)} to {e.range.ceiling != null ? money(e.range.ceiling) : 'their CAC'}</span>
              {e.fair && (<><span className="text-text-muted">Fair payout</span><span className="font-mono text-text-primary">{money(e.fair.payout)}</span></>)}
            </div>
          ) : (
            <Muted>No economics yet. Discovery should find the payable event, their CAC and the value of a converted user.</Muted>
          )}
        </Block>

        <Block title="Who's who">
          <div className="mb-2"><ThreadStatus contacts={contacts} /></div>
          {contacts.length === 0 ? (
            <Muted>No contacts on file.</Muted>
          ) : (
            <ul className="space-y-1">
              {contacts.map((c) => (
                <li key={c.id} className="flex gap-2">
                  <span className="eyebrow text-text-muted w-20 shrink-0 pt-0.5">{tierOf(c) ? TIERS[tierOf(c)].short : '—'}</span>
                  <span className="text-text-primary">{c.name}</span>
                  <span className="text-text-muted truncate">{c.title}</span>
                </li>
              ))}
            </ul>
          )}
        </Block>

        <Block title="Where we left it">
          {last ? (
            <div className="space-y-1">
              <p className="text-text-primary">{fmtDateOnly(last.call_date)}: {last.outcome ?? '—'}</p>
              {last.next_step && <p className="text-text-secondary">Next step: {last.next_step}</p>}
            </div>
          ) : (
            <Muted>First call. No earlier calls logged.</Muted>
          )}
          {openItems.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {openItems.slice(0, 8).map((a, i) => (
                <li key={i} className="text-text-secondary">· {a.owner ? `${a.owner}: ` : ''}{a.task}{a.due ? ` (${a.due})` : ''}</li>
              ))}
            </ul>
          )}
        </Block>

        <Block title="What they've pushed on">
          {Object.keys(pushback).length === 0 ? (
            <Muted>Nothing logged yet.</Muted>
          ) : (
            <div className="space-y-3">
              {THEMES.filter((t) => pushback[t.key]).map((t) => (
                <div key={t.key}>
                  <div className="text-text-primary">{t.label}</div>
                  <ul className="text-text-secondary">
                    {pushback[t.key].slice(0, 3).map((x, i) => <li key={i}>· {x}</li>)}
                  </ul>
                  {answers[t.key] && (
                    <p className="text-text-muted text-[12px] mt-0.5">
                      Answer: {answers[t.key].say || answers[t.key].body}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </Block>

        <Block title="Creators they pay now">
          {adCheck ? (
            <div>
              <Muted>Ad Library, {fmtDateOnly(adCheck.checked_on)}{adCheck.active_ads != null ? ` · ${adCheck.active_ads} ads live` : ''}</Muted>
              <ul className="mt-1">
                {(adCheck.creators ?? []).map((c, i) => (
                  <li key={i} className="text-text-secondary">· @{c.handle}{c.angle ? `: ${c.angle}` : ''}</li>
                ))}
              </ul>
              {adCheck.hook && <p className="text-text-primary mt-1">Hook: {adCheck.hook}</p>}
            </div>
          ) : (
            <p className="text-text-muted text-[12px]">
              Not checked.{' '}
              <a href={adLibraryUrl(lead.company_name)} target="_blank" rel="noreferrer" className="text-signal hover:underline">
                Check the Ad Library ↗
              </a>
            </p>
          )}
        </Block>

        <Block title="Latest touches">
          {touches.length === 0 ? (
            <Muted>No touches logged.</Muted>
          ) : (
            <ul className="space-y-0.5">
              {touches.map((t, i) => (
                <li key={i} className="text-text-secondary">
                  <span className="font-mono text-text-muted text-[12px]">{fmtDate(t.touch_date)}</span> · {t.touch_type ?? 'Touch'}
                  {t.outcome ? ` · ${t.outcome}` : ''}{t.notes ? ` · ${t.notes}` : ''}
                </li>
              ))}
            </ul>
          )}
        </Block>

        <Block title="Run the cadence">
          <ol className="space-y-2">
            {CADENCE_STEPS.map((s, i) => (
              <li key={s.key}>
                <span className="text-text-primary">{i + 1}. {cadence[s.key]?.title ?? s.label}</span>
                <p className="text-text-muted text-[12px]">{cadence[s.key]?.say ? `“${cadence[s.key].say}”` : s.check}</p>
              </li>
            ))}
          </ol>
        </Block>
      </div>
    );
  };

  return (
    <Modal title={`Call prep · ${deal.company_name}`} onClose={onClose} width="max-w-2xl">
      {body()}
      <div className="flex justify-end pt-4">
        <Button variant="secondary" onClick={() => window.print()}>Print</Button>
      </div>
    </Modal>
  );
}
