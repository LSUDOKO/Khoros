/**
 * PruneToggle — the two-state control plus its explanatory line.
 * From docs/04-TRUST_SCORING.md and docs/08-DESIGN_SYSTEM.md.
 *
 * CLAUDE.md rule 2: never display raw reputation as the default. Default is
 * always the pruned score; raw sits behind this toggle, labelled as unfiltered.
 *
 * Flipping it re-ranks the arena, and watching that reorder is the
 * demonstration — the thirty-second surprise for a judge. The choreography
 * lives in the arena list; this component owns the control and the copy.
 */

import type { PruningSummary } from "@khoros/core";

export type PruneToggleProps = {
  pruned: boolean;
  onChange: (pruned: boolean) => void;
  summary: PruningSummary;
  /** Link to the methodology page. */
  verifyHref?: string;
};

/** Turn the discard breakdown into the sentence docs/04 specifies. */
export function describeDiscards(summary: PruningSummary): string | null {
  const { reviewsDiscarded, reasons } = summary;
  if (reviewsDiscarded === 0) return null;

  const parts: string[] = [];
  const label: Record<string, string> = {
    circularCluster: "from circular rating clusters",
    noPaymentEvidence: "with no payment behind them",
    reviewerTooNew: "from addresses too new to count",
    revoked: "revoked by their author",
  };

  // Largest bucket first — the biggest reason is the most informative.
  for (const [key, count] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) {
    if (count > 0 && label[key]) parts.push(`${count.toLocaleString("en-US")} ${label[key]}`);
  }

  return parts.length > 0 ? parts.join(", ") : null;
}

export function PruneToggle({
  pruned,
  onChange,
  summary,
  verifyHref = "/verify",
}: PruneToggleProps): React.ReactElement {
  const discards = describeDiscards(summary);

  return (
    <div className="khoros-prune">
      <div
        className="khoros-prune-control"
        role="radiogroup"
        aria-label="Review filtering"
      >
        <button
          type="button"
          role="radio"
          aria-checked={pruned}
          className="khoros-prune-option"
          data-active={pruned ? "true" : undefined}
          onClick={() => onChange(true)}
        >
          Verified
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={!pruned}
          className="khoros-prune-option"
          data-active={!pruned ? "true" : undefined}
          onClick={() => onChange(false)}
        >
          Unfiltered
        </button>
      </div>

      <p className="khoros-label khoros-prune-copy" aria-live="polite">
        {pruned ? (
          <>
            Ranking uses{" "}
            <span className="khoros-brass">
              {summary.reviewsCounted.toLocaleString("en-US")} payment-backed{" "}
              {summary.reviewsCounted === 1 ? "review" : "reviews"}
            </span>
            {discards ? (
              <>
                . {summary.reviewsDiscarded.toLocaleString("en-US")}{" "}
                {summary.reviewsDiscarded === 1 ? "review was" : "reviews were"}{" "}
                discarded: {discards}.
              </>
            ) : (
              "."
            )}{" "}
            <a href={verifyHref}>How this works</a>
          </>
        ) : (
          <>
            <span className="khoros-madder">Showing unfiltered registry averages.</span>{" "}
            These reviews are unauthenticated — anyone can write one, and the
            ranking will differ. <a href={verifyHref}>How this works</a>
          </>
        )}
      </p>
    </div>
  );
}
