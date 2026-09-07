/**
 * One benchmark task, both branches side by side.
 *
 * docs/09: "elapsed-time bars at true proportion (difference visual before
 * numeric); cost split into gas and opportunity cost (gas difference is small,
 * opportunity cost is the story); every tx hash as a VerifyLink; sample size
 * and run date stated plainly; the operator note."
 *
 * The bars are drawn at TRUE proportion — no minimum width, no log scale, no
 * clamping. If the agent branch is 300x faster, its bar is 1/300th as long.
 * Rescaling would flatter us.
 */

import type { BenchmarkRun } from "@khoros/bench";
import { summarise } from "@khoros/bench";
import { EmptyState, VerifyLink } from "@khoros/ui";

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s % 60)}s`;
}

export function TaskComparison({
  task,
  title,
  domain,
  runs,
}: {
  task: BenchmarkRun["task"];
  title: string;
  domain: string;
  runs: BenchmarkRun[];
}): React.ReactElement {
  if (runs.length === 0) {
    return (
      <section className="section">
        <div className="section-head">
          <h2 className="khoros-section">{title}</h2>
          <span className="khoros-label">{domain}</span>
        </div>
        <EmptyState message="This task has not been run yet. It will appear here once there is a real run with transaction hashes behind it." />
      </section>
    );
  }

  const summary = summarise(task, runs);
  const slowest = Math.max(summary.medianManualMs, summary.medianAgentMs) || 1;

  return (
    <section className="section">
      <div className="section-head">
        <h2 className="khoros-section">{title}</h2>
        <span className="khoros-label">{domain}</span>
      </div>

      {/* Sample size is never omitted. A single observation says so. */}
      <p className="khoros-label">
        {summary.sampleSize === 1
          ? "A single observation — not an average. Treat it as indicative."
          : `Median of ${summary.sampleSize} runs.`}
      </p>

      <div className="bench-bars">
        <div className="bench-branch">
          <div className="bench-branch-head">
            <span className="khoros-label">By hand</span>
            <span className="khoros-data">{formatDuration(summary.medianManualMs)}</span>
          </div>
          <div
            className="bench-bar"
            data-branch="manual"
            style={{ width: `${(summary.medianManualMs / slowest) * 100}%` }}
          />
        </div>

        <div className="bench-branch">
          <div className="bench-branch-head">
            <span className="khoros-label">With the agent</span>
            <span className="khoros-data">{formatDuration(summary.medianAgentMs)}</span>
          </div>
          <div
            className="bench-bar"
            data-branch="agent"
            style={{ width: `${(summary.medianAgentMs / slowest) * 100}%` }}
          />
        </div>
      </div>

      {/* Gas vs opportunity cost, split — the gas difference is small and the
          opportunity cost is the story. */}
      <div className="scroll-x">
        <table className="param-table">
          <thead>
            <tr>
              <th>Run</th>
              <th>Branch</th>
              <th>Elapsed</th>
              <th>Gas</th>
              <th>Opportunity cost</th>
              <th>Total</th>
              <th>Transactions</th>
            </tr>
          </thead>
          <tbody>
            {runs.flatMap((run) =>
              (["manual", "agent"] as const).map((branch) => {
                const b = run[branch];
                return (
                  <tr key={`${run.runId}-${branch}`}>
                    <td>{new Date(run.startedAt).toLocaleDateString("en-GB")}</td>
                    <td>{branch === "manual" ? "By hand" : "Agent"}</td>
                    <td>{formatDuration(b.elapsedMs)}</td>
                    <td>${b.gasCostUsd.toFixed(2)}</td>
                    <td>${b.opportunityCostUsd.toFixed(2)}</td>
                    <td>${b.totalCostUsd.toFixed(2)}</td>
                    <td>
                      {b.transactions.map((t) => (
                        <span key={t.hash} style={{ marginRight: 8 }}>
                          <VerifyLink
                            kind="bscscan"
                            value={t.hash}
                            target="tx"
                            chainId={97}
                          />
                        </span>
                      ))}
                    </td>
                  </tr>
                );
              }),
            )}
          </tbody>
        </table>
      </div>

      {/* The operator disclosure — docs/09 requires it beside the numbers. */}
      {runs.map((run) => (
        <div key={run.runId} className="notice">
          <p className="khoros-label">
            <strong>Manual branch run by:</strong> {run.operator}
          </p>
          {run.notes ? (
            <p className="khoros-label" style={{ marginTop: 8 }}>
              {run.notes}
            </p>
          ) : null}
        </div>
      ))}
    </section>
  );
}
