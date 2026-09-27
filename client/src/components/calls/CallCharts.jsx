import { useState } from 'react';
import { Eyebrow } from '../ui.jsx';
import { THEMES, PROFILE_CHECKS } from '../../lib/callStats.js';
import { fmtDateOnly } from '../../lib/dates.js';

// The Calls view's analysis charts, hand-rolled like QualityLineChart (no
// charting library in this codebase). Every chart is one series, so color is
// emphasis only: bars in the muted text ink, the standout bar in Signal Green,
// "still open" bars striped. Every bar carries its value as a direct label, so
// nothing is read by color alone, and each has a hover tooltip.

const OPEN_STRIPES = {
  background:
    'repeating-linear-gradient(90deg, rgba(255,255,255,0.35) 0 6px, transparent 6px 10px)',
};

// rows: [{ key, label, value (number for length), display (label text),
//          emphasis?, open?, tip (tooltip text) }]
export function BarChart({ title, caption, rows, empty = 'No data yet.' }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(1, ...rows.map((r) => r.value ?? 0));
  return (
    <figure className="min-w-0">
      <figcaption className="text-text-primary text-[13px] font-medium mb-3">{title}</figcaption>
      {rows.length === 0 ? (
        <div className="text-text-disabled text-[12px]">{empty}</div>
      ) : (
        <ul className="space-y-[2px]">
          {rows.map((r) => (
            <li
              key={r.key}
              className="relative grid grid-cols-[96px_1fr_48px] items-center gap-2.5 py-1 text-[12px]"
              onMouseEnter={() => setHover(r.key)}
              onMouseLeave={() => setHover(null)}
            >
              <span className="text-text-secondary truncate" title={r.label}>{r.label}</span>
              <span className="h-3 flex items-center">
                <span
                  className={r.open ? '' : r.emphasis ? 'bg-signal' : 'bg-text-muted'}
                  style={{
                    width: `${Math.max(2, ((r.value ?? 0) / max) * 100)}%`,
                    height: '100%',
                    ...(r.open ? OPEN_STRIPES : null),
                  }}
                />
              </span>
              <span className="font-mono text-text-primary text-right">{r.display}</span>
              {hover === r.key && r.tip && (
                <span className="absolute left-24 bottom-full mb-1 z-10 px-2 py-1 bg-space border border-hairline text-text-primary text-[11px] whitespace-nowrap pointer-events-none">
                  {r.tip}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {caption && <p className="text-text-muted text-[11px] mt-3 leading-relaxed">{caption}</p>}
    </figure>
  );
}

// Cell fill steps for the heatmap: one hue (Signal Green), more is stronger.
function heatClass(n) {
  if (!n) return '';
  if (n === 1) return 'bg-signal/15';
  if (n === 2) return 'bg-signal/30';
  if (n === 3) return 'bg-signal/55';
  return 'bg-signal text-space';
}

// Brands x themes: how many times each brand pushed on each theme. Clicking a
// theme opens what that pushback actually sounded like, brand by brand.
export function ThemeHeatmap({ brands, answers = {} }) {
  const [theme, setTheme] = useState(THEMES[0].key);
  const withPushback = brands.filter((b) => Object.keys(b.pushback).length);
  if (!withPushback.length) {
    return <div className="text-text-disabled text-[12px]">No pushback recorded yet.</div>;
  }
  const active = THEMES.find((t) => t.key === theme);
  const quotes = withPushback.flatMap((b) => (b.pushback[theme] ?? []).map((p) => ({ ...p, brand: b.brand })));

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px] font-mono">
          <thead>
            <tr className="border-b border-hairline">
              <th className="py-2 pr-3 text-left font-normal eyebrow text-text-muted">Brand</th>
              {THEMES.map((t) => (
                <th key={t.key} className="py-2 px-1 font-normal">
                  <button
                    onClick={() => setTheme(t.key)}
                    className={`eyebrow whitespace-nowrap transition-colors ${
                      theme === t.key ? 'text-text-primary underline underline-offset-4' : 'text-text-muted hover:text-text-secondary'
                    }`}
                  >
                    {t.label}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {withPushback.map((b) => (
              <tr key={b.deal_id} className="border-b border-hairline">
                <td className="py-1.5 pr-3 text-text-primary font-sans whitespace-nowrap">{b.brand}</td>
                {THEMES.map((t) => {
                  const n = b.pushback[t.key]?.length ?? 0;
                  return (
                    <td key={t.key} className="py-1 px-1 text-center">
                      <button
                        onClick={() => setTheme(t.key)}
                        title={`${b.brand} · ${t.label}: ${n}`}
                        className={`inline-block min-w-[32px] py-1 ${heatClass(n)} ${n ? 'text-text-primary' : 'text-text-disabled'}`}
                      >
                        {n || '·'}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-5 pt-4 border-t border-hairline">
        <div className="text-text-primary text-[15px]">{active.label}</div>
        <p className="text-text-muted text-[12px] mt-0.5 mb-3">{active.def}</p>
        {answers[theme] && (
          <div className="mb-4 border-l-2 border-signal pl-3 py-1 max-w-3xl">
            <div className="eyebrow text-signal mb-1">How to handle it{answers[theme].title ? ` · ${answers[theme].title}` : ''}</div>
            {answers[theme].body && <p className="text-text-primary text-[13px]">{answers[theme].body}</p>}
            {answers[theme].say && <p className="text-text-secondary text-[13px] italic mt-1">“{answers[theme].say}”</p>}
          </div>
        )}
        {quotes.length === 0 ? (
          <div className="text-text-disabled text-[12px]">No brand pushed on this yet.</div>
        ) : (
          <ul className="grid gap-x-10 lg:grid-cols-2">
            {quotes.map((q, i) => (
              <li key={i} className="py-2 border-t border-hairline text-[13px] text-text-secondary break-inside-avoid">
                <span className="block eyebrow text-text-muted mb-0.5">{q.brand} · {fmtDateOnly(q.date)}</span>
                {q.text}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// What each brand had on the profile checks, next to how it turned out.
export function ProfileMatrix({ brands, ResultPill }) {
  const rows = brands.filter((b) => Object.keys(b.profile).length);
  if (!rows.length) return <div className="text-text-disabled text-[12px]">No profile checks recorded yet.</div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="border-b border-hairline">
            <th className="py-2 pr-3 text-left font-normal eyebrow text-text-muted">Brand</th>
            {PROFILE_CHECKS.map((c) => (
              <th key={c.key} className="py-2 px-2 font-normal eyebrow text-text-muted text-center">{c.label}</th>
            ))}
            <th className="py-2 px-2 font-normal eyebrow text-text-muted text-left">Result</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((b) => (
            <tr key={b.deal_id} className="border-b border-hairline">
              <td className="py-1.5 pr-3 text-text-primary whitespace-nowrap">{b.brand}</td>
              {PROFILE_CHECKS.map((c) => {
                const v = b.profile[c.key];
                if (v == null) return <td key={c.key} className="px-2 text-center text-text-disabled">·</td>;
                const good = v === c.good;
                return (
                  <td key={c.key} className="px-2 py-1 text-center">
                    <span className={`inline-block min-w-[40px] py-0.5 font-mono ${good ? 'bg-signal/30 text-text-primary' : 'text-text-muted'}`}>
                      {v ? 'Yes' : 'No'}
                    </span>
                  </td>
                );
              })}
              <td className="px-2 py-1"><ResultPill result={b.latestResult} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// The buy-in moment on each yes call.
export function BuyInMoments({ brands }) {
  const rows = brands.filter((b) => b.yesCall?.insight?.buy_in_quote);
  if (!rows.length) return <div className="text-text-disabled text-[12px]">No buy-in moments recorded yet.</div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-hairline">
            {['Brand', 'Minute', 'What they said', 'What came right before it'].map((h) => (
              <th key={h} className="py-2 pr-4 text-left font-normal eyebrow text-text-muted whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((b) => {
            const ins = b.yesCall.insight;
            return (
              <tr key={b.deal_id} className="border-b border-hairline align-top">
                <td className="py-2.5 pr-4 text-text-primary font-medium whitespace-nowrap">{b.brand}</td>
                <td className="py-2.5 pr-4 font-mono text-text-secondary whitespace-nowrap">{ins.buy_in_at ?? '—'}</td>
                <td className="py-2.5 pr-4 text-text-primary italic max-w-md">“{ins.buy_in_quote}”</td>
                <td className="py-2.5 text-text-secondary max-w-md">{ins.buy_in_before ?? '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ChartSection({ eyebrow, title, children }) {
  return (
    <section className="px-6 py-7 border-b border-hairline">
      <Eyebrow className="mb-1">{eyebrow}</Eyebrow>
      {title && <h2 className="text-text-primary text-[18px] mb-5">{title}</h2>}
      {children}
    </section>
  );
}
