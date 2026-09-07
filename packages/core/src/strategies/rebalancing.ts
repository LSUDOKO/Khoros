/**
 * Rebalancing. From docs/03-AGENT_CATEGORIES.md category 1.
 *
 * Two triggers:
 *   hard      — price crossed the boundary tick. An out-of-range position earns
 *               nothing, so this fires regardless of the economic calculation.
 *   economic  — E[fee gain over horizon] > gas + slippage + LVR
 *
 * New range is centred on price with width scaled to realised volatility:
 *   [mu - k*sigma, mu + k*sigma], k = 1.2 tight / 1.8 balanced / 2.5 wide
 */

import type { RebalancingBoundaries, Selector } from "../types.js";
import type { EngagementContext, Strategy } from "../harness.js";

export type RebalancingState = {
  /** Current pool price, in token1 per token0. */
  price: number;
  /** The position's current range. */
  rangeLower: number;
  rangeUpper: number;
  /** Position value in USD. */
  positionValueUsd: number;
  /** Pool fee tier in basis points, e.g. 25 for 0.25%. */
  feeTierBps: number;
  /** Recent price returns, oldest first, for the volatility estimate. */
  priceReturns: number[];
  /** Estimated cost to rebalance, in USD. */
  gasCostUsd: number;
  /** Unix seconds of the last rebalance, if any. */
  lastRebalanceAt?: bigint;
  /** Rebalances already performed in the current day. */
  rebalancesToday: number;
  calls: {
    rebalance: (lower: number, upper: number) => {
      target: `0x${string}`;
      selector: Selector;
      payload: `0x${string}`;
    };
  };
};

const WIDTH_K: Record<RebalancingBoundaries["widthProfile"], number> = {
  tight: 1.2,
  balanced: 1.8,
  wide: 2.5,
};

/** Sample standard deviation of returns. Zero with too little history. */
export function realisedVolatility(returns: number[]): number {
  if (returns.length < 2) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance);
}

export function isInRange(state: RebalancingState): boolean {
  return state.price >= state.rangeLower && state.price <= state.rangeUpper;
}

/**
 * The new range: centred on price, width scaled to volatility.
 *
 * Falls back to a fixed 2% half-width when there is not enough price history to
 * estimate volatility — a range built from a bad sigma is worse than a plain one.
 */
export function newRange(
  state: RebalancingState,
  profile: RebalancingBoundaries["widthProfile"],
): { lower: number; upper: number } {
  const sigma = realisedVolatility(state.priceReturns);
  const k = WIDTH_K[profile];
  const halfWidth = sigma > 0 ? k * sigma : 0.02;

  return {
    lower: state.price * (1 - halfWidth),
    upper: state.price * (1 + halfWidth),
  };
}

/**
 * Expected fee income over the horizon if the position were back in range.
 *
 * Deliberately simple and conservative: fee tier times an assumed turnover
 * proportional to volatility. It is an estimate used only to decide whether
 * moving is worth the gas, never displayed as a measured figure.
 */
export function expectedFeeGainUsd(
  state: RebalancingState,
  horizonDays: number,
): number {
  const sigma = realisedVolatility(state.priceReturns);
  if (sigma === 0) return 0;
  const dailyTurnover = sigma * 2;
  return (
    state.positionValueUsd * dailyTurnover * horizonDays * (state.feeTierBps / 10_000)
  );
}

/**
 * Loss-versus-rebalancing over the horizon.
 *
 * LVR scales with sigma squared times position value; the constant folds in the
 * usual quarter factor for a constant-product-like pool.
 */
export function estimateLvrUsd(
  state: RebalancingState,
  horizonDays: number,
): number {
  const sigma = realisedVolatility(state.priceReturns);
  return 0.25 * sigma ** 2 * state.positionValueUsd * horizonDays;
}

export function createRebalancingStrategy(
  observe: (engagement: EngagementContext) => Promise<RebalancingState>,
): Strategy<RebalancingState> {
  return {
    category: "rebalancing",

    observe,

    describeTrigger(state) {
      return isInRange(state)
        ? `Price ${state.price.toFixed(4)}, in range`
        : `Price ${state.price.toFixed(4)}, outside the range ${state.rangeLower.toFixed(4)}–${state.rangeUpper.toFixed(4)}`;
    },

    evaluate(state, engagement) {
      const b = engagement.boundaries as RebalancingBoundaries;

      // Rate limits come first: they are the user's stated ceiling on churn,
      // and no economic argument overrides them.
      if (state.rebalancesToday >= b.maxRebalancesPerDay) return undefined;

      if (state.lastRebalanceAt !== undefined) {
        const elapsed = Number(engagement.now - state.lastRebalanceAt);
        if (elapsed < b.minSecondsBetween) return undefined;
      }

      const outOfRange = !isInRange(state);
      const horizonDays = 7;
      const feeGain = expectedFeeGainUsd(state, horizonDays);
      const lvr = estimateLvrUsd(state, horizonDays);
      const slippageCost =
        state.positionValueUsd * (b.maxSlippageBps / 10_000);
      const cost = state.gasCostUsd + slippageCost + lvr;

      const economic = feeGain > cost;

      if (!outOfRange && !economic) return undefined;

      const range = newRange(state, b.widthProfile);

      // A range that does not contain spot would be rejected by PACE anyway;
      // not proposing it keeps the blocked feed meaningful.
      if (state.price < range.lower || state.price > range.upper) return undefined;

      const reason = outOfRange
        ? `Position is out of range at ${state.price.toFixed(4)} and earning nothing. Recentring to ${range.lower.toFixed(4)}–${range.upper.toFixed(4)}.`
        : `Recentring is worth it: about $${feeGain.toFixed(2)} of expected fees over ${horizonDays} days against $${cost.toFixed(2)} to move.`;

      const call = state.calls.rebalance(range.lower, range.upper);
      return {
        reason,
        target: call.target,
        selector: call.selector,
        payload: call.payload,
        maxSlippageBps: b.maxSlippageBps,
      };
    },
  };
}
