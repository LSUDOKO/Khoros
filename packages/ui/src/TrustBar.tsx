/**
 * TrustBar — the trust score with its 95% interval drawn as a bar.
 * From docs/08-DESIGN_SYSTEM.md.
 *
 * "A wide interval reads as a short fill with a long ghost — uncertainty is
 * visible, not hidden behind a number." Two agents both at 0.88 with different
 * confidence must look different, because they are different.
 */

import type { TrustScore } from "@khoros/core";

export type TrustBarProps = {
  trust: TrustScore;
  /** Segments in the bar. 10 matches the reference sketch in docs/08. */
  segments?: number;
};

export function TrustBar({
  trust,
  segments = 10,
}: TrustBarProps): React.ReactElement {
  const [low, high] = trust.interval95;
  const score = trust.demandIndex;

  // The filled portion is the point estimate; the ghost runs to the top of the
  // interval, so a wide interval leaves a long ghost tail.
  const filled = Math.round(Math.max(0, Math.min(1, score)) * segments);
  const ghost = Math.round(Math.max(0, Math.min(1, high)) * segments);

  const description =
    trust.reviewsCounted === 0
      ? "No payment-backed reviews yet, so this score is the neutral prior."
      : `Trust score ${score.toFixed(2)}. 95% confidence interval ${low.toFixed(2)} to ${high.toFixed(2)}, from ${trust.reviewsCounted} payment-backed reviews.`;

  return (
    <span className="khoros-trustbar" title={description}>
      <span className="khoros-data khoros-trustbar-value">
        {score.toFixed(2)}
      </span>
      <span className="khoros-trustbar-track" aria-hidden="true">
        {Array.from({ length: segments }, (_, i) => (
          <span
            key={i}
            className="khoros-trustbar-seg"
            data-state={i < filled ? "filled" : i < ghost ? "ghost" : "empty"}
          />
        ))}
      </span>
      {/* The visual bar is decorative; this is what a screen reader reads. */}
      <span className="khoros-sr-only">{description}</span>
    </span>
  );
}
