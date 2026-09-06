/**
 * Sparkline — the performance curve drawn ON the stave line.
 * From docs/08-DESIGN_SYSTEM.md.
 *
 * "A hairline rule spanning the full width with the performance sparkline drawn
 * on it. Above the line is gain, below is loss. The rule is the zero axis. This
 * is where the metaphor and the information coincide."
 *
 * So the rule is not a border under a chart — it IS the chart's zero axis, and
 * the curve crosses it. Negative excursions render in madder; positive stay in
 * plain ink. Never green: docs/08 is explicit that green-for-good is the generic
 * trading-interface convention and that stave position already carries direction.
 */

import type { SparklinePoint } from "@khoros/core";

export type SparklineProps = {
  points: SparklinePoint[];
  label: string;
  height?: number;
};

const VIEW_W = 1000;

export function Sparkline({
  points,
  label,
  height = 28,
}: SparklineProps): React.ReactElement {
  // An empty series still renders the rule. The stave line is structural — the
  // band must not collapse just because an agent has no history yet.
  if (points.length < 2) {
    return (
      <div className="khoros-stave-line" role="img" aria-label={`${label}: no data yet`}>
        <svg
          viewBox={`0 0 ${VIEW_W} ${height}`}
          preserveAspectRatio="none"
          className="khoros-sparkline"
          aria-hidden="true"
        >
          <line
            x1="0"
            y1={height / 2}
            x2={VIEW_W}
            y2={height / 2}
            className="khoros-sparkline-axis"
          />
        </svg>
      </div>
    );
  }

  const values = points.map((p) => p.v);
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  // Symmetric scale around zero so the axis sits mid-band and gain/loss are
  // visually comparable.
  const extent = Math.max(Math.abs(max), Math.abs(min)) || 1;

  const mid = height / 2;
  const toX = (i: number): number => (i / (points.length - 1)) * VIEW_W;
  const toY = (v: number): number => mid - (v / extent) * (mid - 2);

  // Split the series at every zero crossing so the loss portions can be
  // coloured differently from the gain portions.
  type Segment = { d: string; negative: boolean };
  const segments: Segment[] = [];
  let current: string[] = [];
  let currentNegative = (values[0] as number) < 0;

  for (let i = 0; i < points.length; i++) {
    const v = values[i] as number;
    const x = toX(i);
    const y = toY(v);
    const negative = v < 0;

    if (i > 0 && negative !== currentNegative) {
      // Interpolate the exact crossing so the colour changes at the axis.
      const prevV = values[i - 1] as number;
      const t = prevV === v ? 0 : prevV / (prevV - v);
      const crossX = toX(i - 1) + (x - toX(i - 1)) * t;

      current.push(`L ${crossX.toFixed(2)} ${mid.toFixed(2)}`);
      segments.push({ d: current.join(" "), negative: currentNegative });

      current = [`M ${crossX.toFixed(2)} ${mid.toFixed(2)}`];
      currentNegative = negative;
    }

    current.push(
      `${current.length === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`,
    );
  }
  segments.push({ d: current.join(" "), negative: currentNegative });

  const last = values[values.length - 1] as number;
  const summary = `${label}. Latest ${last >= 0 ? "gain" : "loss"} of ${Math.abs(last).toFixed(2)}.`;

  return (
    <div className="khoros-stave-line" role="img" aria-label={summary}>
      <svg
        viewBox={`0 0 ${VIEW_W} ${height}`}
        preserveAspectRatio="none"
        className="khoros-sparkline"
        aria-hidden="true"
      >
        {/* The rule: zero axis and stave line at once. */}
        <line
          x1="0"
          y1={mid}
          x2={VIEW_W}
          y2={mid}
          className="khoros-sparkline-axis"
        />
        {segments.map((s, i) => (
          <path
            key={i}
            d={s.d}
            className="khoros-sparkline-path"
            data-negative={s.negative ? "true" : undefined}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
    </div>
  );
}
