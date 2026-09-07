/**
 * The six headline metrics, in the fixed order every category uses.
 *
 * docs/03: "All four categories report the same six headline metrics so they
 * are comparable in one glance. The meaning differs per category; the slots do
 * not." Slot order is taken from METRIC_SLOTS rather than written out here, so
 * it cannot drift between surfaces.
 */

import type { CategoryDefinition, PerformanceMetrics } from "@khoros/core";
import { METRIC_SLOTS } from "@khoros/core";

function formatSlot(
  slot: (typeof METRIC_SLOTS)[number],
  p: PerformanceMetrics,
  def: CategoryDefinition,
): { value: string; negative: boolean } {
  switch (slot) {
    case "return": {
      const negative = p.returnValue < 0;
      const abs = Math.abs(p.returnValue);
      return {
        value:
          def.returnUnit === "usd"
            ? `${negative ? "−" : ""}$${abs.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
            : `${negative ? "−" : ""}${abs.toFixed(1)}%`,
        negative,
      };
    }
    case "risk":
      return { value: `−${(p.maxDrawdownBps / 100).toFixed(1)}%`, negative: true };
    case "activity":
      return { value: `${p.activityCount30d}`, negative: false };
    case "precision":
      return { value: `${(p.precisionBps / 100).toFixed(0)}%`, negative: false };
    case "latency": {
      const s = p.medianLatencyMs / 1000;
      return {
        value: s >= 1 ? `${s.toFixed(1)}s` : `${p.medianLatencyMs}ms`,
        negative: false,
      };
    }
    case "scale": {
      const v = p.scaleUsd;
      return {
        value:
          v >= 1_000_000
            ? `$${(v / 1_000_000).toFixed(1)}m`
            : v >= 1_000
              ? `$${(v / 1_000).toFixed(0)}k`
              : `$${v.toFixed(0)}`,
        negative: false,
      };
    }
  }
}

export function MetricGrid({
  performance,
  definition,
}: {
  performance: PerformanceMetrics;
  definition: CategoryDefinition;
}): React.ReactElement {
  // No measured history at all. Rendering zeros here would present an absence
  // as a measurement, which CLAUDE.md rule 5 forbids.
  if (performance.sampleSize === 0) {
    return (
      <p className="khoros-label khoros-prose">
        No performance history recorded yet. This agent has not run an engagement
        through Khoros, so there is nothing measured to show — and we would
        rather show nothing than a zero that looks like a result.
      </p>
    );
  }

  return (
    <>
      <dl className="metric-grid">
        {METRIC_SLOTS.map((slot) => {
          const { value, negative } = formatSlot(slot, performance, definition);
          return (
            <div key={slot} className="khoros-metric">
              <dt className="khoros-label">{definition.metrics[slot]}</dt>
              <dd className="khoros-data" data-negative={negative ? "true" : undefined}>
                {value}
              </dd>
            </div>
          );
        })}
      </dl>

      {/* Sample size is always stated when thin. An n=3 figure must not carry
          the authority of an n=300 one. */}
      {performance.sampleSize < 10 ? (
        <p className="khoros-label" style={{ marginTop: 12 }}>
          From {performance.sampleSize}{" "}
          {performance.sampleSize === 1 ? "observation" : "observations"} over{" "}
          {performance.window} — too few to be a track record. Treat as
          indicative.
        </p>
      ) : (
        <p className="khoros-label" style={{ marginTop: 12 }}>
          From {performance.sampleSize} observations over {performance.window}.
        </p>
      )}
    </>
  );
}
