import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useLeads } from '../../state/LeadsContext.jsx';
import { isConvertedClient, nextStageCode, STAGE_LABELS, snoozeStatus } from '../../lib/stages.js';
import { addMonthsToDateInput, fmtDateOnly, todayInput } from '../../lib/dates.js';
import { Button, Input, Eyebrow } from '../ui.jsx';

// Snooze quick-picks, in months from today. "Custom" isn't a separate mode —
// picking a preset just prefills the date input below it.
const SNOOZE_PRESETS = [
  { label: '1 month', months: 1 },
  { label: '1 quarter', months: 3 },
  { label: '6 months', months: 6 },
];

// Shared stage-transition controls: advance along FORWARD_PATH (this is how
// a deal reaches Closed Won once it's at S4 — no separate "Won" button
// needed), mark lost (with the required reason prompt), and — only at S4 —
// send the deal back to Meeting Booked when a second meeting is needed.
// Also home to Snooze: parking a deal until a future date is a stage-adjacent
// decision ("we're not working this right now"), it needs the same inline
// confirm panel as Mark as Lost, and living here gets it onto all three
// surfaces from one file.
//
// One copy instead of duplicating this in DealDetailPanel, DealView, and the
// Meetings page.
//
// `after(fn)` is the caller's own mutate-then-reload wrapper: run the async
// fn, then reload whatever state the caller owns.
export default function StageActions({ deal, busy, after }) {
  const navigate = useNavigate();
  // The caller's after() refreshes deals; converting also flips a *lead* flag,
  // which the sidebar's client list and CompanyView's header read from here.
  const { refresh: refreshLeads } = useLeads();
  const [showLost, setShowLost] = useState(false);
  const [showConvert, setShowConvert] = useState(false);
  const [lostReason, setLostReason] = useState('');
  const [showSnooze, setShowSnooze] = useState(false);
  const [snoozeDate, setSnoozeDate] = useState('');
  const [snoozeNote, setSnoozeNote] = useState('');

  const next = nextStageCode(deal.current_stage);
  const isLost = deal.current_stage === 'LOST';
  const isWon = deal.current_stage === 'WON';
  const isTerminal = isLost || isWon;
  const isConverted = isConvertedClient(deal);
  const snooze = snoozeStatus(deal); // null | 'active' | 'ended'
  const today = todayInput();

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        {next && !isTerminal ? (
          <Button variant="primary" disabled={busy} onClick={() => after(() => api.advanceDeal(deal.id))}>
            Move to {next} · {STAGE_LABELS[next]}
          </Button>
        ) : isWon ? (
          /* Closed Won is where the sale ends and the account begins: the one
             action left is handing the company over to Clients. Once converted
             the deal is off the board, so all that's left here is the way back
             to the client page. */
          isConverted ? (
            <>
              <span className="text-text-secondary text-[12px]">Closed Won — moved to Clients</span>
              <Button variant="ghost" onClick={() => navigate(`/clients/${deal.lead_id}`)}>
                View client page →
              </Button>
            </>
          ) : (
            <Button variant="primary" disabled={busy} onClick={() => setShowConvert((s) => !s)}>
              ★ Move to Clients
            </Button>
          )
        ) : (
          <span className="text-text-secondary text-[12px]">
            {isLost ? 'Closed Lost — terminal' : 'No further stage action'}
          </span>
        )}

        {/* A second meeting is needed — send back to Meeting Booked instead
            of advancing to Closed Won. */}
        {deal.current_stage === 'S4' && (
          <Button variant="secondary" disabled={busy} onClick={() => after(() => api.setStage(deal.id, 'S3'))}>
            ← Back to {STAGE_LABELS.S3}
          </Button>
        )}

        {!isTerminal && !snooze && (
          <Button variant="secondary" disabled={busy} onClick={() => setShowSnooze((s) => !s)}>
            Snooze
          </Button>
        )}

        {!isTerminal && (
          <Button variant="danger" disabled={busy} onClick={() => setShowLost((s) => !s)}>
            Mark as Lost
          </Button>
        )}
      </div>

      {showLost && (
        <div className="border border-red-500/30 p-3 space-y-2">
          <Eyebrow className="text-red-400">Lost reason (required)</Eyebrow>
          <Input
            value={lostReason}
            onChange={(e) => setLostReason(e.target.value)}
            placeholder="e.g. Budget frozen, chose competitor…"
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setShowLost(false)}>Cancel</Button>
            <Button
              variant="danger"
              disabled={busy || !lostReason.trim()}
              onClick={() => after(() => api.markLost(deal.id, lostReason)).then(() => setShowLost(false))}
            >
              Confirm Lost
            </Button>
          </div>
        </div>
      )}

      {/* Move to Clients — confirmed rather than one-click because it takes the
          deal off the Pipeline board and there's no un-client button anywhere
          in the app to walk it back with. */}
      {showConvert && (
        <div className="border border-hairline p-3 space-y-2">
          <Eyebrow>Move to Clients</Eyebrow>
          <p className="text-[12px] text-text-secondary">
            Marks {deal.company_name} as a client — it gets its own client page, with spend
            goals and the Ad Tracker — and takes this deal off the Pipeline board. The deal,
            its stage history and its Closed Won outcome are all kept.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setShowConvert(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() =>
                after(() => api.convertDealToClient(deal.id))
                  .then(() => refreshLeads())
                  .then(() => {
                    setShowConvert(false);
                    navigate(`/clients/${deal.lead_id}`);
                  })
              }
            >
              Move to Clients
            </Button>
          </div>
        </div>
      )}

      {/* Snooze until — quick-picks prefill the date input, which stays
          editable for any other date. The note is optional. */}
      {showSnooze && (
        <div className="border border-hairline p-3 space-y-2">
          <Eyebrow>Snooze until</Eyebrow>
          <div className="flex items-center gap-2 flex-wrap">
            {SNOOZE_PRESETS.map((p) => {
              const value = addMonthsToDateInput(today, p.months);
              const active = snoozeDate === value;
              return (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => setSnoozeDate(value)}
                  className={`px-2 py-1 text-[12px] border transition-colors ${
                    active
                      ? 'border-signal/50 text-signal'
                      : 'border-hairline text-text-muted hover:text-text-primary hover:bg-card-hover'
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
          <Input
            type="date"
            value={snoozeDate}
            min={today}
            onChange={(e) => setSnoozeDate(e.target.value)}
            style={{ colorScheme: 'dark' }}
            className="font-mono"
          />
          <Input
            value={snoozeNote}
            onChange={(e) => setSnoozeNote(e.target.value)}
            placeholder="Optional — e.g. Revisit after their Q4 planning"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setShowSnooze(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={busy || !snoozeDate || snoozeDate <= today}
              onClick={() =>
                after(() =>
                  api.updateDeal(deal.id, { snoozed_until: snoozeDate, snooze_note: snoozeNote }),
                ).then(() => {
                  setShowSnooze(false);
                  setSnoozeDate('');
                  setSnoozeNote('');
                })
              }
            >
              Snooze
            </Button>
          </div>
        </div>
      )}

      {/* Current snooze state. 'ended' means the wake date has arrived — the
          deal is already back on the board and back in the weighted total, and
          the green chip just flags it as needing a look. */}
      {snooze && (
        <div className="flex items-center gap-2 flex-wrap text-[12px]">
          <span
            className={`eyebrow border px-1.5 py-0.5 ${
              snooze === 'active'
                ? 'text-text-secondary border-hairline'
                : 'text-signal border-signal/40'
            }`}
          >
            {snooze === 'active'
              ? `Snoozed until ${fmtDateOnly(deal.snoozed_until)}`
              : `Snooze ended ${fmtDateOnly(deal.snoozed_until)}`}
          </span>
          {deal.snooze_note && <span className="text-text-secondary">{deal.snooze_note}</span>}
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => after(() => api.updateDeal(deal.id, { snoozed_until: null, snooze_note: null }))}
          >
            {snooze === 'active' ? 'Wake now' : 'Clear'}
          </Button>
        </div>
      )}

      {isLost && deal.closed_lost_reason && (
        <div className="text-[12px] text-text-secondary">
          <span className="text-text-muted">Reason: </span>
          {deal.closed_lost_reason}
        </div>
      )}
    </div>
  );
}
