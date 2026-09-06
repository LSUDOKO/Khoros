/**
 * The scoring test suite prescribed by docs/04-TRUST_SCORING.md.
 *
 * These tests are also our evidence during judging that the pruning works, so
 * they are written to be read: each fixture states what it represents, and each
 * assertion states what a judge should conclude from it.
 */

import { describe, expect, it } from "vitest";

import { aggregate, demandIndex } from "./aggregate.js";
import { betaInterval95, incompleteBeta } from "./beta.js";
import {
  analyseClusters,
  clusterCorrelation,
  connectedComponents,
  reciprocitySignal,
  temporalSignal,
  type ReviewEdge,
} from "./cluster.js";
import { defaultScoringConfig } from "./config.js";
import { feedbackWeightDetailed, type EnrichedFeedback } from "./weight.js";

const CFG = defaultScoringConfig();
const NOW = 1_760_000_000n;
const OLD_ENOUGH = CFG.minReviewerAgeSeconds + 86_400;

function feedback(over: Partial<EnrichedFeedback> = {}): EnrichedFeedback {
  return {
    agentId: 1n,
    clientAddress: "0xreviewer",
    feedbackIndex: 0n,
    score: 1,
    isRevoked: false,
    settledPaymentUsd: 100,
    matchConfidence: 1,
    reviewerAgeSeconds: OLD_ENOUGH,
    reviewerTxCount: 50,
    clusterCorrelation: 0,
    createdAt: NOW,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// 1. Known Sybil fixture
// ---------------------------------------------------------------------------

describe("Sybil fixture: 20 addresses circularly rating 5 agents, zero settlement", () => {
  const reviewers = Array.from({ length: 20 }, (_, i) => `0xsybil${i}`);
  const agents = [1n, 2n, 3n, 4n, 5n];

  // Every reviewer rates every agent, all within the same few seconds, none
  // of it backed by a payment. This is the shape of a rating ring.
  const edges: ReviewEdge[] = [];
  for (const r of reviewers) {
    for (const a of agents) {
      edges.push({ reviewer: r, agentId: a, at: NOW, settledPaymentUsd: 0 });
    }
  }

  it("scores the ring at maximum cluster correlation", () => {
    const { correlationByReviewer } = analyseClusters(edges);
    for (const r of reviewers) {
      // Density 1.0 and zero economic flow across the boundary, all inside one
      // window: reciprocity and temporal both saturate.
      expect(correlationByReviewer.get(r.toLowerCase())).toBeCloseTo(0.8, 5);
    }
  });

  it("gives every review in the ring a weight of zero", () => {
    const records = reviewers.map((r, i) =>
      feedback({
        clientAddress: r,
        feedbackIndex: BigInt(i),
        settledPaymentUsd: 0,
        clusterCorrelation: 0.8,
      }),
    );

    for (const r of records) {
      expect(feedbackWeightDetailed(r, CFG).weight).toBe(0);
    }
  });

  it("collapses the agent's score to the prior", () => {
    const records = reviewers.map((r, i) =>
      feedback({
        clientAddress: r,
        feedbackIndex: BigInt(i),
        settledPaymentUsd: 0,
        clusterCorrelation: 0.8,
      }),
    );

    const score = aggregate(records, CFG, NOW);

    // No verified history survives, so the posterior is exactly the uniform
    // prior: quality 0.5, maturity 0, demand index 0.
    expect(score.quality).toBe(0.5);
    expect(score.maturity).toBe(0);
    expect(score.demandIndex).toBe(0);
    expect(score.reviewsCounted).toBe(0);
    expect(score.reviewsDiscarded).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// 2. Legitimate fixture
// ---------------------------------------------------------------------------

describe("Legitimate fixture: 30 independent reviewers with varied payments", () => {
  const records = Array.from({ length: 30 }, (_, i) =>
    feedback({
      clientAddress: `0xreal${i}`,
      feedbackIndex: BigInt(i),
      settledPaymentUsd: 10 + i * 25,
      clusterCorrelation: 0,
    }),
  );

  it("gives every review a positive weight", () => {
    for (const r of records) {
      expect(feedbackWeightDetailed(r, CFG).weight).toBeGreaterThan(0);
    }
  });

  it("weights are monotone in payment size", () => {
    const weights = records.map((r) => feedbackWeightDetailed(r, CFG).weight);
    for (let i = 1; i < weights.length; i++) {
      expect(weights[i] as number).toBeGreaterThan(weights[i - 1] as number);
    }
  });

  it("damps payment logarithmically, so a whale cannot dominate", () => {
    const small = feedbackWeightDetailed(feedback({ settledPaymentUsd: 5 }), CFG).weight;
    const large = feedbackWeightDetailed(feedback({ settledPaymentUsd: 500 }), CFG).weight;

    // 100x the payment, but far less than 100x the weight.
    expect(large).toBeGreaterThan(small);
    expect(large / small).toBeLessThan(5);
  });

  it("produces a high quality score with real maturity behind it", () => {
    const score = aggregate(records, CFG, NOW);
    expect(score.reviewsCounted).toBe(30);
    expect(score.reviewsDiscarded).toBe(0);
    expect(score.quality).toBeGreaterThan(0.9);
    expect(score.maturity).toBeGreaterThan(100);
  });
});

// ---------------------------------------------------------------------------
// 3. Mixed fixture — pruning must change the ranking
// ---------------------------------------------------------------------------

describe("Mixed fixture: pruning changes the ranking order", () => {
  // Agent A: few reviews, all genuinely paid for.
  const agentA = Array.from({ length: 6 }, (_, i) =>
    feedback({
      agentId: 1n,
      clientAddress: `0xhonest${i}`,
      feedbackIndex: BigInt(i),
      score: 0.9,
      settledPaymentUsd: 200,
      clusterCorrelation: 0,
    }),
  );

  // Agent B: many perfect reviews, none of them paid for, all from one ring.
  const agentB = Array.from({ length: 40 }, (_, i) =>
    feedback({
      agentId: 2n,
      clientAddress: `0xring${i}`,
      feedbackIndex: BigInt(i),
      score: 1,
      settledPaymentUsd: 0,
      clusterCorrelation: 0.95,
    }),
  );

  it("ranks the wash-rated agent above the honest one when unfiltered", () => {
    const rawA = aggregate(agentA, CFG, NOW).raw;
    const rawB = aggregate(agentB, CFG, NOW).raw;

    // Unfiltered, B looks better: a perfect average over far more reviews.
    expect(rawB.average).toBeGreaterThan(rawA.average);
    expect(rawB.count).toBeGreaterThan(rawA.count);
  });

  it("reverses that ranking once pruned", () => {
    const a = aggregate(agentA, CFG, NOW);
    const b = aggregate(agentB, CFG, NOW);

    // This reversal is the product's central claim, and the reason the arena
    // defaults to pruned.
    expect(a.demandIndex).toBeGreaterThan(b.demandIndex);
    expect(b.demandIndex).toBe(0);
  });

  it("reports a discarded count that matches the zero-weight records", () => {
    const b = aggregate(agentB, CFG, NOW);
    const zeroWeight = b.weights.filter((w) => w.weight === 0).length;

    expect(b.reviewsDiscarded).toBe(zeroWeight);
    expect(b.reviewsCounted + b.reviewsDiscarded).toBe(agentB.length);
  });

  it("breaks discards down into buckets that sum to the total", () => {
    const mixed = [
      feedback({ feedbackIndex: 1n, isRevoked: true }),
      feedback({ feedbackIndex: 2n, reviewerAgeSeconds: 60 }),
      feedback({ feedbackIndex: 3n, settledPaymentUsd: 0 }),
      feedback({ feedbackIndex: 4n, clusterCorrelation: 1 }),
      feedback({ feedbackIndex: 5n }), // counted
    ];

    const score = aggregate(mixed, CFG, NOW);
    const r = score.discardReasons;

    expect(r.revoked).toBe(1);
    expect(r.reviewerTooNew).toBe(1);
    expect(r.noPaymentEvidence).toBe(1);
    expect(r.circularCluster).toBe(1);
    expect(r.revoked + r.reviewerTooNew + r.noPaymentEvidence + r.circularCluster).toBe(
      score.reviewsDiscarded,
    );
    expect(score.reviewsCounted).toBe(1);
  });

  // A record can match several discard conditions at once. The buckets are
  // reported as a breakdown that must reconcile, so precedence must be fixed.
  it("assigns exactly one reason when a record matches several", () => {
    const everything = feedback({
      isRevoked: true,
      reviewerAgeSeconds: 1,
      settledPaymentUsd: 0,
      clusterCorrelation: 1,
    });

    const result = feedbackWeightDetailed(everything, CFG);
    expect(result.counted).toBe(false);
    if (!result.counted) expect(result.reason).toBe("revoked");
  });
});

// ---------------------------------------------------------------------------
// 4. Prior behaviour
// ---------------------------------------------------------------------------

describe("Prior behaviour: an agent with no feedback", () => {
  it("scores exactly 0.5", () => {
    const score = aggregate([], CFG, NOW);
    expect(score.quality).toBe(0.5);
  });

  it("has the widest possible interval", () => {
    const score = aggregate([], CFG, NOW);
    const [lo, hi] = score.interval95;

    // Beta(1,1) is uniform: its 95% interval spans [0.025, 0.975].
    expect(lo).toBeCloseTo(0.025, 3);
    expect(hi).toBeCloseTo(0.975, 3);

    // Any agent with real history must look more certain than this one.
    const known = aggregate(
      Array.from({ length: 20 }, (_, i) =>
        feedback({ feedbackIndex: BigInt(i), settledPaymentUsd: 300 }),
      ),
      CFG,
      NOW,
    );
    const knownWidth = known.interval95[1] - known.interval95[0];
    expect(knownWidth).toBeLessThan(hi - lo);
  });

  it("has a demand index of zero, so it cannot top the arena", () => {
    expect(aggregate([], CFG, NOW).demandIndex).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 5. Saturation
// ---------------------------------------------------------------------------

describe("Saturation: v increases in M and approaches F asymptotically", () => {
  const F = 0.9;

  it("increases monotonically in maturity", () => {
    let previous = -1;
    for (let m = 0; m <= 200; m += 5) {
      const v = demandIndex(F, m, CFG.lambda);
      expect(v).toBeGreaterThan(previous);
      previous = v;
    }
  });

  it("approaches quality but never exceeds it", () => {
    for (const m of [0, 1, 10, 60, 500, 5000]) {
      expect(demandIndex(F, m, CFG.lambda)).toBeLessThanOrEqual(F);
    }
    expect(demandIndex(F, 100_000, CFG.lambda)).toBeCloseTo(F, 6);
  });

  it("reaches ~95% of the ceiling at M = 60, as documented", () => {
    // docs/04 states lambda is tuned so M ~ 60 reaches about 95%.
    const ratio = demandIndex(F, 60, CFG.lambda) / F;
    expect(ratio).toBeGreaterThan(0.94);
    expect(ratio).toBeLessThan(0.96);
  });

  it("stops incumbents being unassailable: late history barely moves v", () => {
    const early = demandIndex(F, 10, CFG.lambda) - demandIndex(F, 5, CFG.lambda);
    const late = demandIndex(F, 205, CFG.lambda) - demandIndex(F, 200, CFG.lambda);
    expect(early).toBeGreaterThan(late * 100);
  });
});

// ---------------------------------------------------------------------------
// Supporting maths
// ---------------------------------------------------------------------------

describe("Beta distribution helpers", () => {
  it("computes a CDF that matches known values", () => {
    // Beta(1,1) is uniform, so I_x(1,1) = x.
    expect(incompleteBeta(0.25, 1, 1)).toBeCloseTo(0.25, 6);
    expect(incompleteBeta(0.75, 1, 1)).toBeCloseTo(0.75, 6);

    // Beta(2,2) is symmetric about 0.5.
    expect(incompleteBeta(0.5, 2, 2)).toBeCloseTo(0.5, 6);
  });

  it("produces intervals that bracket the mean", () => {
    const [lo, hi] = betaInterval95(8, 2);
    const mean = 8 / 10;
    expect(lo).toBeLessThan(mean);
    expect(hi).toBeGreaterThan(mean);
  });

  it("narrows the interval as evidence accumulates", () => {
    const width = (a: number, b: number): number => {
      const [lo, hi] = betaInterval95(a, b);
      return hi - lo;
    };

    expect(width(80, 20)).toBeLessThan(width(8, 2));
    expect(width(800, 200)).toBeLessThan(width(80, 20));
  });
});

describe("Cluster signals", () => {
  it("finds one component per disconnected group", () => {
    const edges: ReviewEdge[] = [
      { reviewer: "0xa", agentId: 1n, at: NOW, settledPaymentUsd: 10 },
      { reviewer: "0xb", agentId: 1n, at: NOW, settledPaymentUsd: 10 },
      { reviewer: "0xc", agentId: 2n, at: NOW, settledPaymentUsd: 10 },
    ];
    expect(connectedComponents(edges)).toHaveLength(2);
  });

  it("scores a dense unpaid ring high on reciprocity", () => {
    const edges: ReviewEdge[] = [];
    for (const r of ["0x1", "0x2", "0x3"]) {
      for (const a of [1n, 2n, 3n]) {
        edges.push({ reviewer: r, agentId: a, at: NOW, settledPaymentUsd: 0 });
      }
    }
    const [comp] = connectedComponents(edges);
    expect(reciprocitySignal(comp!)).toBeCloseTo(1, 5);
  });

  it("scores a sparse well-paid neighbourhood low on reciprocity", () => {
    const edges: ReviewEdge[] = [
      { reviewer: "0x1", agentId: 1n, at: NOW, settledPaymentUsd: 500 },
      { reviewer: "0x2", agentId: 1n, at: NOW, settledPaymentUsd: 500 },
      { reviewer: "0x3", agentId: 2n, at: NOW, settledPaymentUsd: 500 },
      { reviewer: "0x3", agentId: 1n, at: NOW, settledPaymentUsd: 500 },
    ];
    const [comp] = connectedComponents(edges);
    // Every edge is paid, so economic closure is 0 and so is the signal.
    expect(reciprocitySignal(comp!)).toBe(0);
  });

  it("scores simultaneous reviews high and spread-out reviews low", () => {
    const together: ReviewEdge[] = Array.from({ length: 10 }, (_, i) => ({
      reviewer: `0x${i}`,
      agentId: 1n,
      at: NOW,
      settledPaymentUsd: 0,
    }));
    const [burst] = connectedComponents(together);
    expect(temporalSignal(burst!)).toBe(1);

    const spread: ReviewEdge[] = Array.from({ length: 10 }, (_, i) => ({
      reviewer: `0x${i}`,
      agentId: 1n,
      at: NOW + BigInt(i) * 86_400n,
      settledPaymentUsd: 0,
    }));
    const [overTime] = connectedComponents(spread);
    expect(temporalSignal(overTime!)).toBe(0);
  });

  it("caps the combined correlation at 1", () => {
    expect(
      clusterCorrelation({
        reciprocity: 1,
        temporalCoincidence: 1,
        fundingProvenance: 1,
      }),
    ).toBe(1);
  });

  it("contributes nothing for funding when no funding data is known", () => {
    const edges: ReviewEdge[] = Array.from({ length: 5 }, (_, i) => ({
      reviewer: `0x${i}`,
      agentId: 1n,
      at: NOW,
      settledPaymentUsd: 0,
    }));
    const { components } = analyseClusters(edges);
    expect(components[0]!.signals.fundingProvenance).toBe(0);
  });
});
