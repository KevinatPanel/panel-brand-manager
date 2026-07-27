// Hand-rolled SVG line chart for the Quality percentage trend — no charting
// library in this codebase (matches the hand-rolled bar/animation style
// elsewhere, e.g. SpendGoalWidget.jsx/AnimatedNumber.jsx). Shared by
// QualityMetricWidget.jsx (compact) and QualityMetricModal.jsx (full year)
// rather than duplicated per-file like the old bar rows were — a real chart
// (scaling math, path generation, hover) is a different complexity class
// than a CSS bar and is worth keeping in sync in one place.
//
// Deliberately NOT a 0-100% scale: the Y-domain is the min/max of whatever
// months are currently displayed (plus padding), so a 7-10% swing reads as a
// real trend instead of a rounding error against a fixed 100% ceiling. This
// is the same idea as a stat tile's non-zero-based sparkline — relative
// month-to-month comparison, not absolute magnitude.
const DEFAULT_WIDTH = 400;
const DEFAULT_HEIGHT = 120;
const PAD_LEFT = 30;
const PAD_RIGHT = 10;
const PAD_TOP = 24;
const PAD_BOTTOM = 20;

// Catmull-Rom → cubic Bezier smoothing through every point in a segment
// (rather than straight `L` segments) — the user asked for a smooth line.
// Missing neighbors (segment ends) duplicate the nearest real point, the
// standard Catmull-Rom boundary handling.
function smoothPathD(pts) {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`;
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${p2.x} ${p2.y}`;
  }
  return d;
}

// Break a series into segments at gaps (null pct) so the line doesn't
// interpolate through a no-data month, mapped to plot coordinates.
function toSegments(series, xAt, yAt) {
  const segments = [];
  let current = [];
  series.forEach((p, i) => {
    if (p.pct == null) {
      if (current.length) segments.push(current);
      current = [];
      return;
    }
    current.push({ x: xAt(i), y: yAt(p.pct) });
  });
  if (current.length) segments.push(current);
  return segments;
}

// points: [{ label, isCurrent, pct, eventCount }], pct/eventCount null for a
// month with no synced row or a zero/missing billed_event_count — same
// "no percentage available" semantics the bar rows used.
//
// avgPoints (optional): same shape, aligned by index — the vertical-average
// benchmark line. When present, the Y-domain spans both series, a legend
// appears (per the dataviz skill: 2+ series always gets one), and the
// benchmark line renders in the `benchmark` blue with both a hover tooltip
// AND a permanent per-point label, same as the client's own line. At each
// index, whichever of the two points sits higher on the chart gets its
// label placed above the dot and the other gets it placed below, so the two
// labels never collide — labels stay neutral text-color either way (never
// the series hue), with the colored dot beside them carrying identity.
// `legend` = { selfLabel, avgLabel }.
export default function QualityLineChart({ points, avgPoints, legend, width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT }) {
  const plotLeft = PAD_LEFT;
  const plotRight = width - PAD_RIGHT;
  const plotTop = PAD_TOP;
  const plotBottom = height - PAD_BOTTOM;
  const plotWidth = plotRight - plotLeft;
  const plotHeight = plotBottom - plotTop;

  const selfValues = points.map((p) => p.pct).filter((v) => v != null);
  const avgValues = (avgPoints ?? []).map((p) => p.pct).filter((v) => v != null);
  const allValues = [...selfValues, ...avgValues];

  if (allValues.length === 0) {
    return (
      <div className="flex items-center justify-center text-text-disabled text-[12px]" style={{ height }}>
        Not enough data yet.
      </div>
    );
  }

  const rawMin = Math.min(...allValues);
  const rawMax = Math.max(...allValues);
  const range = rawMax - rawMin;
  const pad = Math.max(range * 0.15, 2);
  const domainMin = Math.max(0, rawMin - pad);
  const domainMax = rawMax + pad;
  const domainRange = domainMax - domainMin || 1;

  const count = Math.max(points.length, avgPoints?.length ?? 0);
  const xAt = (i) => plotLeft + (count > 1 ? (i / (count - 1)) * plotWidth : plotWidth / 2);
  const yAt = (v) => plotTop + (1 - (v - domainMin) / domainRange) * plotHeight;

  const selfSegments = toSegments(points, xAt, yAt);
  const avgSegments = avgPoints ? toSegments(avgPoints, xAt, yAt) : [];

  const yTicks = [domainMin, (domainMin + domainMax) / 2, domainMax];
  // Fallback flip (used only when a point has no same-index counterpart to
  // compare against): each series' own peak gets its label pushed below
  // instead of above, so it doesn't clip past the top tick row.
  const selfMax = selfValues.length ? Math.max(...selfValues) : null;
  const avgMax = avgValues.length ? Math.max(...avgValues) : null;

  // Label placement for one series' point at index i, aware of the other
  // series' point at the same index (if any) so the two labels never land
  // on top of each other: whichever point sits higher on the chart (smaller
  // pixel y) gets its label above; the other gets it below. On an exact tie,
  // `self` wins "above" and `avg` falls to "below" — a fixed, deterministic
  // tie-break rather than both landing in the same spot.
  function labelY(pct, otherPct, ownMax, tieWinsAbove) {
    const py = yAt(pct);
    if (otherPct != null) {
      const otherY = yAt(otherPct);
      const above = tieWinsAbove ? py <= otherY : py < otherY;
      return above ? py - 10 : py + 14;
    }
    return pct === ownMax ? py + 14 : py - 10;
  }

  return (
    <div>
      {legend && avgPoints && (
        <div className="flex items-center gap-4 mb-1.5">
          <span className="flex items-center gap-1.5 text-[11px] text-text-secondary">
            <span className="inline-block w-2 h-2 rounded-full bg-signal" />
            {legend.selfLabel}
          </span>
          <span className="flex items-center gap-1.5 text-[11px] text-text-secondary">
            <span className="inline-block w-2 h-2 rounded-full bg-benchmark" />
            {legend.avgLabel}
          </span>
        </div>
      )}
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" role="img" aria-label="Quality percentage trend">
        {yTicks.map((v, idx) => (
          <g key={idx}>
            <line
              x1={plotLeft}
              x2={plotRight}
              y1={yAt(v)}
              y2={yAt(v)}
              className="stroke-hairline"
              strokeWidth="1"
            />
            <text
              x={plotLeft - 6}
              y={yAt(v)}
              dy="0.32em"
              textAnchor="end"
              className="fill-text-muted font-mono text-[9px]"
            >
              {Math.round(v)}%
            </text>
          </g>
        ))}

        {avgSegments.map((seg, si) => (
          <path
            key={`avg-${si}`}
            d={smoothPathD(seg)}
            className="fill-none stroke-benchmark"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {(avgPoints ?? []).map((p, i) =>
          p.pct == null ? null : (
            <circle
              key={`avg-dot-${i}`}
              cx={xAt(i)}
              cy={yAt(p.pct)}
              r="4"
              className="fill-benchmark stroke-space"
              strokeWidth="2"
            >
              <title>{`${p.label}: ${p.pct}% avg`}</title>
            </circle>
          ),
        )}

        {selfSegments.map((seg, si) => (
          <path
            key={si}
            d={smoothPathD(seg)}
            className="fill-none stroke-signal"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}

        {points.map((p, i) =>
          p.pct == null ? null : (
            <circle key={i} cx={xAt(i)} cy={yAt(p.pct)} r="4" className="fill-signal stroke-space" strokeWidth="2">
              <title>{`${p.label}: ${p.pct}%${p.eventCount != null ? ` (${p.eventCount} events)` : ''}`}</title>
            </circle>
          ),
        )}

        {/* Every point on the client's own line gets its value labeled (not
            just the current one). The current month's label stays visually
            emphasized (larger, brighter) so it still reads as the headline
            number. Placement is collision-aware against the avg line's
            point at the same index — see labelY above. */}
        {points.map((p, i) => {
          if (p.pct == null) return null;
          return (
            <text
              key={i}
              x={xAt(i)}
              y={labelY(p.pct, avgPoints?.[i]?.pct, selfMax, true)}
              textAnchor="middle"
              className={
                p.isCurrent
                  ? 'fill-text-primary font-mono font-medium text-[12px]'
                  : 'fill-text-secondary font-mono text-[10px]'
              }
            >
              {p.pct}%
            </text>
          );
        })}

        {/* The benchmark line's points are labeled too, same collision-aware
            placement — kept in a neutral text color (never the series hue),
            with the blue dot beside it carrying identity. */}
        {(avgPoints ?? []).map((p, i) => {
          if (p.pct == null) return null;
          return (
            <text
              key={`avg-label-${i}`}
              x={xAt(i)}
              y={labelY(p.pct, points[i]?.pct, avgMax, false)}
              textAnchor="middle"
              className="fill-text-secondary font-mono text-[10px]"
            >
              {p.pct}%
            </text>
          );
        })}

        {points.map((p, i) => (
          <text
            key={i}
            x={xAt(i)}
            y={height - 4}
            textAnchor="middle"
            className={`text-[10px] ${p.isCurrent ? 'fill-text-primary font-semibold' : 'fill-text-secondary'}`}
          >
            {p.label}
          </text>
        ))}
      </svg>
    </div>
  );
}
