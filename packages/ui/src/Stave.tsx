/**
 * The stave — the signature component. One agent, one horizontal band.
 * From docs/08-DESIGN_SYSTEM.md.
 *
 * Four rows inside one band:
 *   1. name, right-aligned against the trust score with its interval
 *   2. provenance: category, protocols, payment-backed review count in brass
 *   3. the stave line — a hairline rule with the sparkline drawn ON it, the
 *      rule being the zero axis. This is where metaphor and information coincide.
 *   4. the six metric slots, tabular, same order for every category
 *
 * Rendered as a real <tr>. The accessibility floor in docs/08 requires the arena
 * be a semantic table — screen readers get a comparison table, sighted users get
 * a score. That is why this is a table row and not a div.
 */

import type { CategoryDefinition } from "@khoros/core";
import { METRIC_SLOTS } from "@khoros/core";
import type { PerformanceMetrics, TrustScore } from "@khoros/core";

import { Sparkline } from "./Sparkline.js";
import { TrustBar } from "./TrustBar.js";

export type StaveVariant = "arena" | "dashboard" | "compact";

export type StaveProps = {
  agentId: bigint;
  name: string;
  definition: CategoryDefinition;
  trust: TrustScore;
  performance: PerformanceMetrics;
  /** Number of reviews with a settled payment behind them. Rendered in brass. */
  paymentBackedReviews: number;
  variant?: StaveVariant;
  href?: string;
  /** Rendered after the metrics — the dashboard uses it for revoke. */
  trailing?: React.ReactNode;
};

/** Format one metric slot for display, using the category's own labels. */
function formatSlot(
  slot: (typeof METRIC_SLOTS)[number],
  p: PerformanceMetrics,
  def: CategoryDefinition,
): { value: string; label: string; negative: boolean } {
  const label = def.metrics[slot];

  switch (slot) {
    case "return": {
      const negative = p.returnValue < 0;
      const value =
        def.returnUnit === "usd"
          ? `${negative ? "−" : ""}$${Math.abs(p.returnValue).toLocaleString("en-US", { maximumFractionDigits: 0 })}`
          : `${negative ? "−" : ""}${Math.abs(p.returnValue).toFixed(1)}%`;
      return { value, label, negative };
    }
    case "risk": {
      // Drawdown is stored positive in bps and always reads as a loss.
      const pct = p.maxDrawdownBps / 100;
      return { value: `−${pct.toFixed(1)}%`, label, negative: true };
    }
    case "activity":
      return { value: `${p.activityCount30d}`, label, negative: false };
    case "precision":
      return {
        value: `${(p.precisionBps / 100).toFixed(0)}%`,
        label,
        negative: false,
      };
    case "latency": {
      const s = p.medianLatencyMs / 1000;
      const value = s >= 1 ? `${s.toFixed(1)}s` : `${p.medianLatencyMs}ms`;
      return { value, label, negative: false };
    }
    case "scale": {
      const v = p.scaleUsd;
      const value =
        v >= 1_000_000
          ? `$${(v / 1_000_000).toFixed(1)}m`
          : v >= 1_000
            ? `$${(v / 1_000).toFixed(0)}k`
            : `$${v.toFixed(0)}`;
      return { value, label, negative: false };
    }
  }
}

export function Stave({
  agentId,
  name,
  definition,
  trust,
  performance,
  paymentBackedReviews,
  variant = "arena",
  href,
  trailing,
}: StaveProps): React.ReactElement {
  const protocols = definition.protocols
    .map((p) =>
      p
        .split("-")
        .map((w) => (w === "v3" ? "V3" : w.charAt(0).toUpperCase() + w.slice(1)))
        .join(" "),
    )
    .join(", ");

  return (
    // data-agent-key is what the arena's FLIP reorder measures against, so it
    // must be a stable identity across a re-sort.
    <tr
      className="khoros-stave"
      data-variant={variant}
      data-agent-key={agentId.toString()}
    >
      <th scope="row" className="khoros-stave-cell">
        <div className="khoros-stave-band">
          {/* Row 1 — name against the trust score */}
          <div className="khoros-stave-head">
            {href ? (
              <a href={href} className="khoros-agent-name khoros-stave-name">
                {name}
              </a>
            ) : (
              <span className="khoros-agent-name khoros-stave-name">{name}</span>
            )}
            <TrustBar trust={trust} />
          </div>

          {/* Row 2 — provenance. Payment-backed count in brass, because a
              payment stands behind it. */}
          <p className="khoros-label khoros-stave-provenance">
            {definition.label}
            <span aria-hidden="true"> · </span>
            {protocols}
            <span aria-hidden="true"> · </span>
            <span className="khoros-brass">
              {paymentBackedReviews.toLocaleString("en-US")} payment-backed{" "}
              {paymentBackedReviews === 1 ? "review" : "reviews"}
            </span>
          </p>

          {/* Row 3 — the stave line. The rule is the zero axis. */}
          {variant !== "compact" && (
            <Sparkline
              points={performance.sparkline}
              label={`${name} performance over the last ${performance.window}`}
            />
          )}

          {/* Row 4 — the six slots, fixed order, tabular */}
          <dl className="khoros-stave-metrics">
            {METRIC_SLOTS.map((slot) => {
              const { value, label, negative } = formatSlot(
                slot,
                performance,
                definition,
              );
              return (
                <div key={slot} className="khoros-metric">
                  <dt className="khoros-label">{label}</dt>
                  <dd
                    className="khoros-data"
                    data-negative={negative ? "true" : undefined}
                  >
                    {value}
                  </dd>
                </div>
              );
            })}
          </dl>

          {/* Sample size is shown whenever it is thin. An n=3 figure must not
              carry the authority of an n=300 one. */}
          {performance.sampleSize > 0 && performance.sampleSize < 10 && (
            <p className="khoros-label khoros-stave-sample">
              From {performance.sampleSize}{" "}
              {performance.sampleSize === 1 ? "observation" : "observations"} —
              treat as indicative.
            </p>
          )}

          {trailing ? <div className="khoros-stave-trailing">{trailing}</div> : null}
        </div>
      </th>
    </tr>
  );
}
