/**
 * Reviews, each showing the settled payment that backs it.
 *
 * docs/04-TRUST_SCORING.md: "On the agent profile, each review row shows the
 * settled payment that backs it. Reviews with no payment appear only in
 * unfiltered mode, greyed, labelled 'no payment recorded'."
 */

import type { TrustScore } from "@khoros/core";
import { EmptyState, VerifyLink } from "@khoros/ui";

import type { ReviewRow } from "@/lib/db";

const REASON_COPY: Record<string, string> = {
  circularCluster: "discarded — circular rating cluster",
  noPaymentEvidence: "no payment recorded",
  reviewerTooNew: "discarded — reviewer address too new",
  revoked: "revoked by its author",
};

export function ReviewList({
  reviews,
  trust,
}: {
  reviews: ReviewRow[];
  trust: TrustScore;
}): React.ReactElement {
  if (reviews.length === 0) {
    return (
      <EmptyState
        message={
          trust.reviewsDiscarded > 0
            ? `No payment-backed reviews yet. ${trust.reviewsDiscarded.toLocaleString("en-US")} ${trust.reviewsDiscarded === 1 ? "review was" : "reviews were"} set aside because no settled payment stands behind them, so they do not count toward the ranking.`
            : "No reviews yet. Reviews appear here once a job settles on-chain, with the payment that backs each one."
        }
        action={
          <a className="btn-secondary" href="/verify">
            How reviews are weighted
          </a>
        }
      />
    );
  }

  return (
    <ul className="review-list">
      {reviews.map((r, i) => {
        const counted = r.weight > 0;
        return (
          <li key={i} className="review-row" data-counted={counted ? "true" : "false"}>
            <div className="review-head">
              <span className="khoros-data">{(r.score * 100).toFixed(0)}%</span>
              <VerifyLink
                kind="bscscan"
                value={r.clientAddress}
                target="address"
                chainId={56}
              />
            </div>

            <p className="khoros-label review-backing">
              {counted ? (
                <>
                  {/* Brass means a payment stands behind it. */}
                  <span className="khoros-brass">
                    ${r.settledPaymentUsd.toLocaleString("en-US", {
                      maximumFractionDigits: 2,
                    })}{" "}
                    settled
                  </span>
                  {r.settlementJobId !== undefined ? (
                    <> · job #{r.settlementJobId.toString()}</>
                  ) : null}
                </>
              ) : (
                <span className="khoros-dim">
                  {REASON_COPY[r.discardReason ?? "noPaymentEvidence"] ??
                    "no payment recorded"}
                </span>
              )}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
