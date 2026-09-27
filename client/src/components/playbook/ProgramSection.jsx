import { useCallback, useEffect, useState } from 'react';
import { Eyebrow, Input, Select, TextArea } from '../ui.jsx';
import { useDeals } from '../../state/DealsContext.jsx';
import { useEconomics } from '../../lib/useEconomics.js';
import { playbook } from '../../lib/playbookApi.js';
import { loadPrograms } from '../../lib/programs.js';
import { VERDICTS } from '../../lib/economics.js';
import { fmtDateOnly } from '../../lib/dates.js';
import { money, wholeMoney, ZoneChip } from './Zone.jsx';
import { HealthChip } from './HealthChip.jsx';

const pct = (v) => (v == null ? '—' : `${v.toFixed(v < 10 ? 1 : 0)}%`);

// The client's program on its profile: lifecycle phase and health (G), last
// month read like the RPM diagnostic (A, clients), spend in profit terms (H),
// and the inputs Everflow can't provide (tracking, views, creators).
export default function ProgramSection({ lead }) {
  const { deals } = useDeals();
  const settings = useEconomics();
  const [row, setRow] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    loadPrograms([lead], deals, settings)
      .then(([r]) => setRow(r))
      .catch((e) => setError(e.message));
  }, [lead, deals, settings]);
  useEffect(() => {
    load();
  }, [load]);

  async function save(patch) {
    try {
      await playbook.saveClientProgram(lead.id, patch);
      setError(null);
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  if (!row) return null;
  const d = row.diagnosis;
  const verdict = d?.verdict ? VERDICTS[d.verdict] : null;

  return (
    <section className="px-5 py-4 border-b border-hairline">
      <div className="flex items-center justify-between mb-3">
        <Eyebrow>Program</Eyebrow>
        <HealthChip health={row.health} />
      </div>

      <div className="text-[13px] text-text-primary">
        {row.phase ? (
          <>
            {row.phase.label} · day {row.phase.day}
            <span className="text-text-muted"> · live {fmtDateOnly(row.liveDate)}{row.liveSource === 'everflow' ? ' (first revenue month)' : ''}</span>
          </>
        ) : (
          <span className="text-text-muted">Not live yet</span>
        )}
      </div>
      {row.phase && <p className="text-text-muted text-[12px] mt-0.5">{row.phase.goal}</p>}
      <p className="text-text-secondary text-[12px] mt-2">{row.health.note}</p>

      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[12px]">
        <dt className="text-text-muted">Spend ({row.spendMonth ?? 'no data'})</dt>
        <dd className="font-mono text-text-primary text-right">
          {row.spend != null ? wholeMoney(row.spend) : '—'}
          {row.trend && <span className="text-text-muted"> · {row.trend.trend} ({Math.round(row.trend.change * 100)}%)</span>}
        </dd>
        <dt className="text-text-muted">Panel profit</dt>
        <dd className="font-mono text-text-primary text-right">{row.spend != null ? wholeMoney(row.profit.profit) : '—'}</dd>
        {settings.show_commission && (
          <>
            <dt className="text-text-muted">Commission</dt>
            <dd className="font-mono text-text-primary text-right">{row.spend != null ? wholeMoney(row.profit.commission) : '—'}</dd>
          </>
        )}
      </dl>

      <div className="mt-4">
        <div className="flex items-center justify-between mb-1.5">
          <span className="eyebrow text-text-muted">Last month’s traffic</span>
          {d?.zone && <ZoneChip zone={d.zone} />}
        </div>
        {d && d.clicks != null ? (
          <>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[12px]">
              <dt className="text-text-muted">Clicks → conversions</dt>
              <dd className="font-mono text-text-primary text-right">{d.clicks.toLocaleString()} → {(d.conversions ?? 0).toLocaleString()}</dd>
              <dt className="text-text-muted">Conversion rate</dt>
              <dd className="font-mono text-text-primary text-right">{pct(d.cvr)}</dd>
              <dt className="text-text-muted">Click-through</dt>
              <dd className="font-mono text-text-primary text-right">{pct(d.ctr)}</dd>
              <dt className="text-text-muted">Creator payout per conversion</dt>
              <dd className="font-mono text-text-primary text-right">{money(d.payoutPerConv)}</dd>
              <dt className="text-text-muted">Creator eCPM</dt>
              <dd className="font-mono text-text-primary text-right">{money(d.ecpm)}</dd>
            </dl>
            {verdict && (
              <p className="mt-2 text-[12px]">
                <span className="text-text-primary">{verdict.label}.</span> <span className="text-text-secondary">{verdict.note}</span>
              </p>
            )}
          </>
        ) : (
          <p className="text-text-muted text-[12px]">No Everflow clicks for last month yet. Sync Spend vs. goal to pull them.</p>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <label className="block">
          <span className="eyebrow text-text-muted block mb-1">Tracking</span>
          <Select
            value={row.program.tracking_live == null ? '' : String(row.program.tracking_live)}
            onChange={(e) => save({ tracking_live: e.target.value === '' ? null : e.target.value === 'true' })}
          >
            <option value="">{row.tracking === true ? 'Auto: conversions seen' : 'Not confirmed'}</option>
            <option value="true">Live and stable</option>
            <option value="false">Not live / broken</option>
          </Select>
        </label>
        <label className="block">
          <span className="eyebrow text-text-muted block mb-1">Last month’s views</span>
          <Input
            type="number"
            min="0"
            key={`v-${row.program.monthly_views}`}
            defaultValue={row.program.monthly_views ?? ''}
            placeholder="for CTR and eCPM"
            onBlur={(e) => e.target.value !== String(row.program.monthly_views ?? '') && save({ monthly_views: e.target.value === '' ? null : Number(e.target.value) })}
          />
        </label>
        <label className="block">
          <span className="eyebrow text-text-muted block mb-1">Active creators</span>
          <Input
            type="number"
            min="0"
            key={`c-${row.program.active_creators}`}
            defaultValue={row.program.active_creators ?? ''}
            placeholder={row.creators != null ? `${row.creators} live in Ad Tracker` : 'count'}
            onBlur={(e) => e.target.value !== String(row.program.active_creators ?? '') && save({ active_creators: e.target.value === '' ? null : Number(e.target.value) })}
          />
        </label>
      </div>
      <TextArea
        rows={2}
        key={`n-${row.program.notes}`}
        defaultValue={row.program.notes ?? ''}
        placeholder="Program notes"
        className="mt-3"
        onBlur={(e) => e.target.value !== (row.program.notes ?? '') && save({ notes: e.target.value })}
      />
      {error && <div className="mt-2 text-red-400 text-[12px]">{error}</div>}
    </section>
  );
}
