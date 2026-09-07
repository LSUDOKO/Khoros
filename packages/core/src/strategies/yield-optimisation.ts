/**
 * Yield optimisation. From docs/03-AGENT_CATEGORIES.md category 3.
 *
 * Allocation:  max_w  sum(w_j * netAPY_j) - gamma * w'Sigma w
 *              s.t.   sum(w) = 1,  0 <= w_j <= w_max
 *
 * Trigger:     (APY_new - APY_current) * C * h/365 > gasCost
 *              The break-even horizon h is computed and shown to the user in
 *              plain language: "this move pays for itself in 2.8 days".
 *
 * Net APY is gross minus borrow cost minus an expected protocol risk premium,
 * never the headline number.
 */

import type { Protocol, Selector, YieldOptimisationBoundaries } from "../types.js";
import type { EngagementContext, Strategy } from "../harness.js";

export type ProtocolYield = {
  protocol: Protocol;
  /** Gross supply APY as a fraction, e.g. 0.084 for 8.4%. */
  grossApy: number;
  /** Borrow cost attributable to this position, if any. */
  borrowCost: number;
  /** Expected risk premium — what the yield should be discounted by. */
  riskPremium: number;
  /** Utilisation, for the safety bound. */
  utilisation: number;
  /** Volatility of this protocol's risk proxies, for the covariance term. */
  volatility: number;
};

export type YieldState = {
  /** Where capital sits now. */
  current: Protocol;
  capitalUsd: number;
  /** Unix seconds the current position was entered. */
  enteredAt: bigint;
  candidates: ProtocolYield[];
  gasCostUsd: number;
  calls: {
    migrate: (to: Protocol, amountUsd: number) => {
      target: `0x${string}`;
      selector: Selector;
      payload: `0x${string}`;
    };
  };
};

const GAMMA: Record<YieldOptimisationBoundaries["riskProfile"], number> = {
  conservative: 4,
  balanced: 2,
  aggressive: 0.5,
};

/** Net APY: gross, less borrow cost, less the risk premium. */
export function netApy(y: ProtocolYield): number {
  return y.grossApy - y.borrowCost - y.riskPremium;
}

/**
 * Risk-adjusted score for one destination.
 *
 * The full formulation is a covariance-penalised allocation across protocols.
 * With capital in one place at a time — which is what the session scope
 * permits — that reduces to penalising each candidate by its own variance,
 * scaled by the user's risk aversion.
 */
export function riskAdjustedScore(
  y: ProtocolYield,
  profile: YieldOptimisationBoundaries["riskProfile"],
): number {
  return netApy(y) - GAMMA[profile] * y.volatility ** 2;
}

/**
 * Days until the extra yield pays for the gas.
 *
 *   spread * capital * h/365 = gas   =>   h = gas * 365 / (spread * capital)
 *
 * Returns Infinity when the spread is zero or negative — it never pays off.
 */
export function breakEvenDays(
  spread: number,
  capitalUsd: number,
  gasCostUsd: number,
): number {
  if (spread <= 0 || capitalUsd <= 0) return Number.POSITIVE_INFINITY;
  return (gasCostUsd * 365) / (spread * capitalUsd);
}

export function bestDestination(
  state: YieldState,
  boundaries: YieldOptimisationBoundaries,
): ProtocolYield | undefined {
  const eligible = state.candidates.filter(
    (c) =>
      boundaries.protocolAllowlist.includes(c.protocol) &&
      // Utilisation safety bound: a market this hot may not let us withdraw.
      c.utilisation < 0.95,
  );

  if (eligible.length === 0) return undefined;

  return eligible.reduce((best, c) =>
    riskAdjustedScore(c, boundaries.riskProfile) >
    riskAdjustedScore(best, boundaries.riskProfile)
      ? c
      : best,
  );
}

export function createYieldStrategy(
  observe: (engagement: EngagementContext) => Promise<YieldState>,
): Strategy<YieldState> {
  return {
    category: "yield-optimisation",

    observe,

    describeTrigger(state) {
      const here = state.candidates.find((c) => c.protocol === state.current);
      return here
        ? `${state.current} at ${(netApy(here) * 100).toFixed(2)}% net APY`
        : `Capital in ${state.current}`;
    },

    evaluate(state, engagement) {
      const b = engagement.boundaries as YieldOptimisationBoundaries;

      // Minimum holding period — stops the agent chasing every wobble.
      const held = Number(engagement.now - state.enteredAt);
      if (held < b.minHoldSeconds) return undefined;

      const here = state.candidates.find((c) => c.protocol === state.current);
      const target = bestDestination(state, b);

      if (!target || !here || target.protocol === state.current) return undefined;

      const spread = netApy(target) - netApy(here);
      const spreadBps = spread * 10_000;

      // The user's own floor on what is worth moving for.
      if (spreadBps < b.minSpreadBps) return undefined;

      const horizon = breakEvenDays(spread, state.capitalUsd, state.gasCostUsd);

      // The economic trigger: it must pay for itself inside the holding period
      // the user is willing to commit to, not merely eventually.
      const holdDays = b.minHoldSeconds / 86_400;
      if (!Number.isFinite(horizon) || horizon > Math.max(holdDays, 30)) {
        return undefined;
      }

      const call = state.calls.migrate(target.protocol, state.capitalUsd);

      return {
        reason:
          `${target.protocol} pays ${(netApy(target) * 100).toFixed(2)}% net against ` +
          `${(netApy(here) * 100).toFixed(2)}% here. Moving costs about $${state.gasCostUsd.toFixed(2)}, ` +
          `so this pays for itself in ${horizon.toFixed(1)} days.`,
        target: call.target,
        selector: call.selector,
        payload: call.payload,
        maxSlippageBps: 50,
      };
    },
  };
}
