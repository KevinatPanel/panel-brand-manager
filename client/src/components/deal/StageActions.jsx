import { useState } from 'react';
import { api } from '../../lib/api.js';
import { nextStageCode, STAGE_LABELS } from '../../lib/stages.js';
import { Button, Input, Eyebrow } from '../ui.jsx';

// Shared stage-transition controls: advance along FORWARD_PATH (this is how
// a deal reaches Closed Won once it's at S4 — no separate "Won" button
// needed), mark lost (with the required reason prompt), and — only at S4 —
// send the deal back to Meeting Booked when a second meeting is needed.
// One copy instead of duplicating this in DealDetailPanel, DealView, and the
// Meetings page.
//
// `after(fn)` is the caller's own mutate-then-reload wrapper: run the async
// fn, then reload whatever state the caller owns.
export default function StageActions({ deal, busy, after }) {
  const [showLost, setShowLost] = useState(false);
  const [lostReason, setLostReason] = useState('');

  const next = nextStageCode(deal.current_stage);
  const isLost = deal.current_stage === 'LOST';
  const isWon = deal.current_stage === 'WON';
  const isTerminal = isLost || isWon;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        {next && !isTerminal ? (
          <Button variant="primary" disabled={busy} onClick={() => after(() => api.advanceDeal(deal.id))}>
            Move to {next} · {STAGE_LABELS[next]}
          </Button>
        ) : (
          <span className="text-text-secondary text-[12px]">
            {isLost ? 'Closed Lost — terminal' : isWon ? 'Closed Won — terminal' : 'No further stage action'}
          </span>
        )}

        {/* A second meeting is needed — send back to Meeting Booked instead
            of advancing to Closed Won. */}
        {deal.current_stage === 'S4' && (
          <Button variant="secondary" disabled={busy} onClick={() => after(() => api.setStage(deal.id, 'S3'))}>
            ← Back to {STAGE_LABELS.S3}
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

      {isLost && deal.closed_lost_reason && (
        <div className="text-[12px] text-text-secondary">
          <span className="text-text-muted">Reason: </span>
          {deal.closed_lost_reason}
        </div>
      )}
    </div>
  );
}
