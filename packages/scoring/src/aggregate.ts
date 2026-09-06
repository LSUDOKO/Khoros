/**
 * Step 4 — Aggregation. From docs/04-TRUST_SCORING.md.
 *
 *   alpha = 1 + sum over positives of w_i * s_i
 *   beta  = 1 + sum over negatives of w_j * (1 - s_j)
 *   F     = alpha / (alpha + beta)                       quality
 *   M     = sum of w_i                                   maturity
 *   v     = F * (1 - e^(-lambda * M))                    demand index, the ranking value
 *   CI95  = [BetaInv(0.025, alpha, beta), BetaInv(0.975, alpha, beta)]
 *
 * The uniform prior (alpha = beta = 1) is what puts an agent with no history at
 * exactly 0.5 rather than at 0 or 1.
 */

import type { DiscardReasons, TrustScore } from "@khoros/core";

import { betaInterval95 } from "./beta.js";
import type { ScoringConfig } from "./config.js";
import { feedbackWeightDetailed, type EnrichedFeedback } from "./weight.js";

export type AggregateResult = TrustScore & {
  /** Per-record weights, kept so callers can persist them to the feedback table. */
  weights: { feedbackIndex: bigint; clientAddress: string; weight: number }[];
};

const emptyDiscardReasons = (): DiscardReasons => ({
  circularCluster: 0,
  noPaymentEvidence: 0,
  reviewerTooNew: 0,
  revoked: 0,
});

/**
 * Aggregate one agent's feedback into a trust score.
 *
 * `computedAt` is passed in rather than read from the clock so the pipeline is
 * deterministic and a replay reproduces byte-identical rows.
 */
export function aggregate(
  feedback: EnrichedFeedback[],
  cfg: ScoringConfig,
  computedAt: bigint,
): AggregateResult {
  let alpha = 1;
  let beta = 1;
  let maturity = 0;

  let reviewsCounted = 0;
  let reviewsDiscarded = 0;
  const discardReasons = emptyDiscardReasons();

  const weights: AggregateResult["weights"] = [];

  // Raw, unfiltered average — what the arena shows behind the prune toggle.
  // Revoked reviews are excluded even here: the registry itself says they no
  // longer stand, so including them would misrepresent the raw data too.
  let rawSum = 0;
  let rawCount = 0;

  for (const f of feedback) {
    if (!f.isRevoked) {
      rawSum += f.score;
      rawCount += 1;
    }

    const result = feedbackWeightDetailed(f, cfg);

    if (!result.counted) {
      reviewsDiscarded += 1;
      discardReasons[result.reason] += 1;
      weights.push({
        feedbackIndex: f.feedbackIndex,
        clientAddress: f.clientAddress,
        weight: 0,
      });
      continue;
    }

    reviewsCounted += 1;
    maturity += result.weight;
    weights.push({
      feedbackIndex: f.feedbackIndex,
      clientAddress: f.clientAddress,
      weight: result.weight,
    });

    // Positive and negative split at the configured threshold.
    if (f.score >= cfg.positiveThreshold) {
      alpha += result.weight * f.score;
    } else {
      beta += result.weight * (1 - f.score);
    }
  }

  const quality = alpha / (alpha + beta);
  const demandIndex = quality * (1 - Math.exp(-cfg.lambda * maturity));

  return {
    quality,
    maturity,
    demandIndex,
    interval95: betaInterval95(alpha, beta),
    reviewsCounted,
    reviewsDiscarded,
    discardReasons,
    raw: {
      average: rawCount === 0 ? 0 : rawSum / rawCount,
      count: rawCount,
    },
    computedAt,
    weights,
  };
}

/** The demand index on its own, for tests and for /verify's worked example. */
export function demandIndex(
  quality: number,
  maturity: number,
  lambda: number,
): number {
  return quality * (1 - Math.exp(-lambda * maturity));
}
