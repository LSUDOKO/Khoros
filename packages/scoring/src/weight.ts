/**
 * Step 3 — Weighting. From docs/04-TRUST_SCORING.md.
 *
 *   w_i = ln(1 + SettledPaymentUSD) · 1(ClientAge > tau) · (1 - ClusterCorrelation)
 *
 * The principle underneath: a review is worth what the reviewer paid.
 */

import type { ScoringConfig } from "./config.js";

export type EnrichedFeedback = {
  agentId: bigint;
  clientAddress: string;
  feedbackIndex: bigint;
  /** Registry score normalised to [0,1] by its valueDecimals. */
  score: number;
  isRevoked: boolean;

  settledPaymentUsd: number;
  settlementJobId?: bigint;
  matchConfidence: number;

  /** Seconds between the reviewer's first on-chain activity and this review. */
  reviewerAgeSeconds: number;
  reviewerTxCount: number;
  clusterCorrelation: number;

  createdAt: bigint;
};

/**
 * Why a record was excluded from the ranking.
 *
 * docs/04 lists four discard buckets but does not say what happens when a record
 * qualifies for several — a revoked review from a new address inside a cluster
 * with no payment matches all four. The UI reports these as a breakdown that must
 * sum to the discarded total, so the buckets have to be mutually exclusive.
 *
 * We therefore fix a precedence, in order of how conclusive the signal is:
 *
 *   revoked > reviewerTooNew > noPaymentEvidence > circularCluster
 *
 * Revocation is an explicit on-chain statement, so it wins. Age is a hard,
 * objective gate. Absence of payment is objective. Cluster correlation is the
 * only inferred signal, so it is reported last and never masks a harder reason.
 */
export type DiscardReason =
  | "revoked"
  | "reviewerTooNew"
  | "noPaymentEvidence"
  | "circularCluster";

export type WeightResult =
  | { weight: number; counted: true }
  | { weight: 0; counted: false; reason: DiscardReason };

/**
 * The weight of one feedback record, with the reason when it is zero.
 *
 * docs/04's reference implementation returns a bare number and short-circuits in
 * the order revoked -> age -> payment. That leaves a fully circular reviewer
 * (correlation exactly 1.0) at weight 0 via `payment * 0` with no reason bucket,
 * which breaks the invariant that counted + discarded equals the total. This
 * version returns the reason explicitly so the breakdown always reconciles.
 */
export function feedbackWeightDetailed(
  f: EnrichedFeedback,
  cfg: ScoringConfig,
): WeightResult {
  if (f.isRevoked) return { weight: 0, counted: false, reason: "revoked" };

  if (f.reviewerAgeSeconds <= cfg.minReviewerAgeSeconds) {
    return { weight: 0, counted: false, reason: "reviewerTooNew" };
  }

  const payment = Math.log1p(f.settledPaymentUsd);
  if (payment === 0) {
    return { weight: 0, counted: false, reason: "noPaymentEvidence" };
  }

  const weight = payment * (1 - f.clusterCorrelation);
  if (weight <= 0) {
    // Correlation of exactly 1.0 — a reviewer wholly inside a circular ring.
    return { weight: 0, counted: false, reason: "circularCluster" };
  }

  return { weight, counted: true };
}

/** The scalar form from the doc, for callers that only need the number. */
export function feedbackWeight(
  f: EnrichedFeedback,
  cfg: ScoringConfig,
): number {
  return feedbackWeightDetailed(f, cfg).weight;
}
