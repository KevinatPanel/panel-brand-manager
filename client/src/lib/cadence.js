// ---------------------------------------------------------------------------
// The discovery-call cadence calls are coached against. call_insights.cadence
// (0053) holds { [key]: { hit, note } } per call, filled by analyze-transcript
// and the Tactiq sync agent. The playbook's exact lines for each step load
// from playbook_entries kind 'cadence' (seeded privately).
// ---------------------------------------------------------------------------

export const CADENCE_STEPS = [
  { key: 'open_light', label: 'Opened light, no pitch', check: 'Did we open by asking about them before pitching Panel?' },
  { key: 'discovery_first', label: 'Discovery before positioning', check: 'Did we learn their model, past creator programs, CPA, LTV and funnel before positioning?' },
  { key: 'payable_event', label: 'Found the payable event', check: 'Did we pin down the event they would pay on and work a payout back from their numbers?' },
  { key: 'flat_fee_contrast', label: 'Positioned against flat fee', check: 'Did we contrast paying per event with flat-fee influencer deals?' },
  { key: 'proof_drop', label: 'Dropped the proof point', check: 'Did we anchor with a client proof point (scale, views, eCPM)?' },
  { key: 'objection_handled', label: 'Handled the objection', check: 'Did we answer their main objection rather than deflect it?' },
  { key: 'the_ask', label: 'Asked for a capped pilot', check: 'Did we ask for a capped test budget (about $10K) framed as a diagnostic?' },
  { key: 'next_steps', label: 'Locked next steps', check: 'Did we leave with a dated next step and what we’d send?' },
];

// Share of the steps a call hit (of the steps it reported on).
export function cadenceScore(cadence) {
  const reported = CADENCE_STEPS.filter((s) => cadence?.[s.key]?.hit != null);
  if (!reported.length) return null;
  const hit = reported.filter((s) => cadence[s.key].hit).length;
  return { hit, of: reported.length, pct: Math.round((hit / reported.length) * 100) };
}
