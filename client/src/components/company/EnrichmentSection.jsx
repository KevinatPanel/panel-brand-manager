import { api } from '../../lib/api.js';
import { relativeTime } from '../../lib/leads.js';
import { Field, Input, Button, Eyebrow } from '../ui.jsx';

// Apollo enrichment: a one-click "Enrich from Apollo" action plus the enriched
// firmographic fields (editable so a user can correct them). Needs a domain or
// website to match on. Fields are keyed by enriched_at so a fresh enrichment
// replaces the uncontrolled inputs' DOM values on reload.
function fmtRevenue(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return '';
  if (v >= 1e9) return `$${+(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${+(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${+(v / 1e3).toFixed(0)}K`;
  return `$${v}`;
}

export default function EnrichmentSection({ lead, busy, after }) {
  const canEnrich = !!(lead.website || lead.domain);
  const techs = Array.isArray(lead.technologies) ? lead.technologies : [];

  return (
    <div className="px-5 py-4 border-b border-hairline">
      <div className="flex items-center justify-between mb-3">
        <Eyebrow>Enrichment</Eyebrow>
        {lead.enriched_at ? (
          <Button
            variant="ghost"
            disabled={busy || !canEnrich}
            title="Re-fetch from Apollo (uses a credit)"
            onClick={() => after(() => api.enrichLead(lead.id, { force: true }))}
          >
            ↻ Re-enrich
          </Button>
        ) : (
          <Button
            variant="secondary"
            disabled={busy || !canEnrich}
            title={canEnrich ? 'Pull firmographics from Apollo' : 'Add a website or domain first'}
            onClick={() => after(() => api.enrichLead(lead.id))}
          >
            ↻ Enrich from Apollo
          </Button>
        )}
      </div>

      <div key={`enrich-${lead.enriched_at ?? '0'}`} className="grid grid-cols-2 gap-3">
        <Field label="Industry">
          <Input
            defaultValue={lead.industry ?? ''}
            onBlur={(e) => after(() => api.updateLead(lead.id, { industry: e.target.value }))}
            placeholder="e.g. Fintech"
          />
        </Field>
        <Field label="Est. Revenue (USD)">
          <Input
            type="number"
            defaultValue={lead.estimated_revenue ?? ''}
            onBlur={(e) => after(() => api.updateLead(lead.id, { estimated_revenue: e.target.value }))}
            placeholder="45000000"
          />
        </Field>
        <Field label="Founded">
          <Input
            type="number"
            defaultValue={lead.founded_year ?? ''}
            onBlur={(e) => after(() => api.updateLead(lead.id, { founded_year: e.target.value }))}
            placeholder="2015"
          />
        </Field>
        <div className="flex flex-col justify-end">
          {lead.estimated_revenue ? (
            <span className="text-text-muted text-[11px]">≈ {fmtRevenue(lead.estimated_revenue)} / yr</span>
          ) : null}
        </div>
      </div>

      {techs.length > 0 && (
        <div className="mt-3">
          <Eyebrow className="mb-1.5">Tech Stack</Eyebrow>
          <div className="flex flex-wrap gap-1.5">
            {techs.slice(0, 12).map((t) => (
              <span key={t} className="eyebrow text-text-secondary border border-hairline px-1.5 py-0.5">
                {t}
              </span>
            ))}
            {techs.length > 12 && (
              <span className="text-text-disabled text-[11px]">+{techs.length - 12} more</span>
            )}
          </div>
        </div>
      )}

      <div className="text-text-disabled text-[11px] mt-3">
        {lead.enriched_at
          ? `Last enriched ${relativeTime(lead.enriched_at)}`
          : 'Not yet enriched.'}
      </div>
    </div>
  );
}
