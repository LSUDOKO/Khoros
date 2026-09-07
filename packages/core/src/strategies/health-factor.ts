/**
 * Health factor monitoring. From docs/03-AGENT_CATEGORIES.md category 4.
 *
 *   HF = sum(collateral_i * liqThreshold_i) / sum(debt_j)
 *
 * Two triggers, and the predictive one is the point of the product:
 *   reactive   — HF <= floor (default 1.15)
 *   predictive — a rolling VaR on collateral price projects a breach within the
 *                response horizon, so the agent acts BEFORE the level is reached
 *
 * The response ladder, cheapest first:
 *   1. add collateral from pre-authorised reserves
 *   2. partial deleverage — withdraw collateral, swap, repay
 *   3. alert and stop, never exceeding scope to "save" the position
 */

import type { HealthFactorBoundaries, Selector } from "../types.js";
import type { EngagementContext, Strategy } from "../harness.js";

export type CollateralPosition = {
  symbol: string;
  /** USD value of the collateral. */
  valueUsd: number;
  /** Liquidation threshold, e.g. 0.8. */
  liquidationThreshold: number;
};

export type HealthFactorState = {
  collateral: CollateralPosition[];
  /** Total debt in USD. */
  debtUsd: number;
  /** Reserves the agent may draw on, in USD. */
  reserveAvailableUsd: number;
  /**
   * Recent collateral price returns, oldest first. Used for the VaR
   * projection. An empty series disables the predictive trigger rather than
   * inventing a distribution.
   */
  priceReturns: number[];
  /** Encoded calls the runtime supplies, so this module stays chain-free. */
  calls: {
    supplyCollateral: (amountUsd: number) => { target: `0x${string}`; selector: Selector; payload: `0x${string}` };
    deleverage: (amountUsd: number) => { target: `0x${string}`; selector: Selector; payload: `0x${string}` };
  };
};

/** HF from the position. Returns Infinity with no debt, which is correct. */
export function healthFactor(state: HealthFactorState): number {
  if (state.debtUsd <= 0) return Number.POSITIVE_INFINITY;
  const weighted = state.collateral.reduce(
    (sum, c) => sum + c.valueUsd * c.liquidationThreshold,
    0,
  );
  return weighted / state.debtUsd;
}

/**
 * Historical value-at-risk of the collateral price at a confidence level.
 *
 * Deliberately the empirical quantile of observed returns rather than a
 * parametric normal: crypto returns have fat tails, and a normal assumption
 * understates exactly the moves that cause liquidations.
 *
 * Returns 0 when there is not enough history — no projection is better than a
 * projection from four data points.
 */
export function valueAtRisk(returns: number[], confidence: number): number {
  if (returns.length < 20) return 0;

  const losses = [...returns].sort((a, b) => a - b);
  const index = Math.floor((1 - confidence) * losses.length);
  const quantile = losses[Math.min(index, losses.length - 1)] ?? 0;

  // VaR is expressed as a positive fraction of value at risk.
  return quantile < 0 ? Math.abs(quantile) : 0;
}

/** HF if collateral fell by the VaR amount. */
export function projectedHealthFactor(
  state: HealthFactorState,
  confidence: number,
): number {
  const var95 = valueAtRisk(state.priceReturns, confidence);
  if (var95 === 0) return healthFactor(state);
  if (state.debtUsd <= 0) return Number.POSITIVE_INFINITY;

  const weighted = state.collateral.reduce(
    (sum, c) => sum + c.valueUsd * (1 - var95) * c.liquidationThreshold,
    0,
  );
  return weighted / state.debtUsd;
}

/**
 * How much collateral, in USD, restores HF to the target.
 *
 *   (weighted + x * threshold) / debt = target
 *   x = (target * debt - weighted) / threshold
 */
export function collateralNeeded(
  state: HealthFactorState,
  targetHf: number,
): number {
  const weighted = state.collateral.reduce(
    (sum, c) => sum + c.valueUsd * c.liquidationThreshold,
    0,
  );
  // Use the best threshold available, since that is what the agent would add.
  const threshold = Math.max(
    ...state.collateral.map((c) => c.liquidationThreshold),
    0.5,
  );
  const needed = (targetHf * state.debtUsd - weighted) / threshold;
  return Math.max(0, needed);
}

export function createHealthFactorStrategy(
  observe: (engagement: EngagementContext) => Promise<HealthFactorState>,
): Strategy<HealthFactorState> {
  return {
    category: "health-factor",

    observe,

    describeTrigger(state) {
      const hf = healthFactor(state);
      if (!Number.isFinite(hf)) return "No debt on this position";
      return `Health factor ${hf.toFixed(3)}`;
    },

    evaluate(state, engagement) {
      const b = engagement.boundaries as HealthFactorBoundaries;
      const hf = healthFactor(state);

      if (!Number.isFinite(hf)) return undefined;

      const reactive = hf <= b.hfFloor;
      const projected = projectedHealthFactor(state, b.predictiveConfidence);
      const predictive = projected <= b.hfFloor && hf > b.hfFloor;

      if (!reactive && !predictive) return undefined;

      const needed = collateralNeeded(state, b.hfTarget);
      if (needed <= 0) return undefined;

      const reason = reactive
        ? `Health factor fell to ${hf.toFixed(2)}, at or below your floor of ${b.hfFloor}. Topping up to reach ${b.hfTarget}.`
        : `Health factor is ${hf.toFixed(2)} now, but a plausible fall in collateral price would take it to ${projected.toFixed(2)} — below your floor of ${b.hfFloor}. Acting early.`;

      // Ladder step 1: add collateral from reserves, the cheapest response.
      if (
        b.preferredResponse === "collateral-first" &&
        state.reserveAvailableUsd >= needed
      ) {
        const call = state.calls.supplyCollateral(needed);
        return {
          reason,
          target: call.target,
          selector: call.selector,
          payload: call.payload,
          maxSlippageBps: 0, // supplying collateral involves no swap
        };
      }

      // Ladder step 2: deleverage. Slippage allowance is deliberately wider
      // than rebalancing — speed beats precision when the alternative is a
      // 5-15% liquidation penalty.
      if (state.reserveAvailableUsd < needed || b.preferredResponse === "deleverage-first") {
        const call = state.calls.deleverage(needed);
        return {
          reason: `${reason} No reserve is available, so paying down debt instead.`,
          target: call.target,
          selector: call.selector,
          payload: call.payload,
          maxSlippageBps: 100,
        };
      }

      // Ladder step 3: neither is possible within permissions. Do nothing
      // rather than exceed scope to "save" the position.
      return undefined;
    },
  };
}
