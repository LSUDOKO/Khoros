/**
 * The intervention log — artifact 6 of the eleven.
 *
 * Every entry links to its transaction. Blocked actions render at the same
 * prominence as executed ones, because a blocked action is evidence the safety
 * layer works rather than an error to tuck away (docs/08).
 */

import { EmptyState, VerifyLink } from "@khoros/ui";

import type { InterventionRow } from "@/lib/db";

function formatWhen(at: bigint): string {
  return new Date(Number(at) * 1000).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function InterventionLog({
  rows,
}: {
  rows: InterventionRow[];
}): React.ReactElement {
  if (rows.length === 0) {
    return (
      <EmptyState message="No interventions recorded yet. Every action this agent takes appears here — executed or blocked — with a link to the transaction." />
    );
  }

  return (
    <ol className="khoros-feed">
      {rows.map((r, i) => (
        <li key={i} className="khoros-feed-row" data-kind={r.kind}>
          <span className="khoros-label khoros-feed-time">{formatWhen(r.at)}</span>
          <span className="khoros-feed-body">
            <span
              className={`khoros-feed-verb${r.kind === "blocked" ? " khoros-madder" : ""}`}
            >
              {r.kind === "blocked"
                ? "Blocked before execution"
                : r.kind === "triggered"
                  ? "Triggered"
                  : "Executed"}
            </span>
            <span className="khoros-label">{r.detail}</span>
            {r.latencyMs !== undefined ? (
              <span className="khoros-label">{r.latencyMs}ms from trigger</span>
            ) : null}
            {r.tx ? <VerifyLink kind="bscscan" value={r.tx} target="tx" chainId={97} /> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}
