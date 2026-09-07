/**
 * Deterministic strategy tests, one block per category at equal depth.
 *
 * CLAUDE.md: "The four agent strategies get deterministic tests against
 * recorded chain state." Each block covers the trigger, the rate limits, and
 * the case where the strategy must decline to act.
 */

import { describe, expect, it } from "vitest";

import { CATEGORY_DEFINITIONS } from "../categories.js";
import type { EngagementContext } from "../harness.js";
import type {
  GridTradingBoundaries,
  HealthFactorBoundaries,
  RebalancingBoundaries,
  Selector,
  YieldOptimisationBoundaries,
} from "../types.js";

import { buildGrid, createGridStrategy, crossedLevel, type GridState } from "./grid-trading.js";
import {
  collateralNeeded,
  createHealthFactorStrategy,
  healthFactor,
  projectedHealthFactor,
  valueAtRisk,
  type HealthFactorState,
} from "./health-factor.js";
import {
  createRebalancingStrategy,
  isInRange,
  newRange,
  realisedVolatility,
  type RebalancingState,
} from "./rebalancing.js";
import {
  breakEvenDays,
  bestDestination,
  createYieldStrategy,
  netApy,
  type YieldState,
} from "./yield-optimisation.js";

const NOW = 1_760_000_000n;
const CALL = {
  target: "0x1111111111111111111111111111111111111111" as `0x${string}`,
  selector: "0x88316456" as Selector,
  payload: "0x88316456" as `0x${string}`,
};

function ctx(category: EngagementContext["category"], boundaries: unknown): EngagementContext {
  return {
    engagementId: "e1",
    account: "0x2222222222222222222222222222222222222222",
    category,
    boundaries,
    now: NOW,
  };
}

/** A stable pseudo-random return series, so tests never flake. */
function returns(n: number, scale = 0.02): number[] {
  const out: number[] = [];
  let seed = 42;
  for (let i = 0; i < n; i++) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    out.push(((seed / 2147483648) * 2 - 1) * scale);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1. Health factor
// ---------------------------------------------------------------------------

describe("health factor", () => {
  const boundaries = CATEGORY_DEFINITIONS["health-factor"]
    .defaultBoundaries as HealthFactorBoundaries;

  function state(over: Partial<HealthFactorState> = {}): HealthFactorState {
    return {
      collateral: [{ symbol: "BNB", valueUsd: 1000, liquidationThreshold: 0.8 }],
      debtUsd: 500,
      reserveAvailableUsd: 500,
      priceReturns: returns(60, 0.03),
      calls: {
        supplyCollateral: () => CALL,
        deleverage: () => CALL,
      },
      ...over,
    };
  }

  it("computes HF from collateral, threshold and debt", () => {
    // 1000 * 0.8 / 500 = 1.6
    expect(healthFactor(state())).toBeCloseTo(1.6, 6);
  });

  it("treats a position with no debt as infinitely healthy", () => {
    expect(healthFactor(state({ debtUsd: 0 }))).toBe(Number.POSITIVE_INFINITY);
  });

  it("does nothing while the position is comfortably healthy", () => {
    const s = createHealthFactorStrategy(async () => state());
    expect(s.evaluate(state(), ctx("health-factor", boundaries))).toBeUndefined();
  });

  it("acts reactively once HF reaches the floor", () => {
    // 1000 * 0.8 / 700 = 1.14, below the 1.15 floor.
    const breached = state({ debtUsd: 700 });
    const s = createHealthFactorStrategy(async () => breached);
    const action = s.evaluate(breached, ctx("health-factor", boundaries));

    expect(action).toBeDefined();
    expect(action?.reason).toContain("1.14");
  });

  // The predictive trigger is "the point of the product" per docs/03.
  it("acts predictively before the floor is reached", () => {
    // HF 1.28 now — above the floor — but a large VaR projects a breach.
    const risky = state({ debtUsd: 625, priceReturns: returns(60, 0.25) });

    expect(healthFactor(risky)).toBeGreaterThan(boundaries.hfFloor);
    expect(projectedHealthFactor(risky, boundaries.predictiveConfidence)).toBeLessThan(
      boundaries.hfFloor,
    );

    const s = createHealthFactorStrategy(async () => risky);
    const action = s.evaluate(risky, ctx("health-factor", boundaries));

    expect(action).toBeDefined();
    expect(action?.reason).toContain("Acting early");
  });

  it("refuses to project from too little history rather than inventing one", () => {
    expect(valueAtRisk(returns(5), 0.95)).toBe(0);
    const thin = state({ priceReturns: returns(5) });
    // With no VaR, the projection is just the current HF.
    expect(projectedHealthFactor(thin, 0.95)).toBeCloseTo(healthFactor(thin), 6);
  });

  it("computes the collateral needed to reach the target", () => {
    const s = state({ debtUsd: 700 });
    const needed = collateralNeeded(s, 1.4);
    // (1.4 * 700 - 800) / 0.8 = 225
    expect(needed).toBeCloseTo(225, 4);
  });

  it("deleverages when no reserve is available", () => {
    const broke = state({ debtUsd: 700, reserveAvailableUsd: 0 });
    const s = createHealthFactorStrategy(async () => broke);
    const action = s.evaluate(broke, ctx("health-factor", boundaries));

    expect(action?.reason).toContain("No reserve");
    // Wider than rebalancing on purpose: speed beats precision against a
    // 5-15% liquidation penalty.
    expect(action?.maxSlippageBps).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// 2. Rebalancing
// ---------------------------------------------------------------------------

describe("rebalancing", () => {
  const boundaries = CATEGORY_DEFINITIONS.rebalancing
    .defaultBoundaries as RebalancingBoundaries;

  function state(over: Partial<RebalancingState> = {}): RebalancingState {
    return {
      price: 100,
      rangeLower: 95,
      rangeUpper: 105,
      positionValueUsd: 10_000,
      feeTierBps: 25,
      priceReturns: returns(60, 0.02),
      gasCostUsd: 2,
      rebalancesToday: 0,
      calls: { rebalance: () => CALL },
      ...over,
    };
  }

  it("knows when a position is in range", () => {
    expect(isInRange(state())).toBe(true);
    expect(isInRange(state({ price: 110 }))).toBe(false);
  });

  it("does nothing while in range and not worth moving", () => {
    const quiet = state({ priceReturns: returns(60, 0.0001), gasCostUsd: 50 });
    const s = createRebalancingStrategy(async () => quiet);
    expect(s.evaluate(quiet, ctx("rebalancing", boundaries))).toBeUndefined();
  });

  it("fires the hard trigger when price leaves the range", () => {
    const out = state({ price: 110 });
    const s = createRebalancingStrategy(async () => out);
    const action = s.evaluate(out, ctx("rebalancing", boundaries));

    expect(action).toBeDefined();
    expect(action?.reason).toContain("out of range");
  });

  it("centres the new range on price with volatility-scaled width", () => {
    const s = state({ price: 110 });
    const range = newRange(s, "balanced");

    expect(range.lower).toBeLessThan(110);
    expect(range.upper).toBeGreaterThan(110);
    // Balanced (k=1.8) must be wider than tight (k=1.2).
    const tight = newRange(s, "tight");
    expect(range.upper - range.lower).toBeGreaterThan(tight.upper - tight.lower);
  });

  it("falls back to a fixed width when volatility cannot be estimated", () => {
    expect(realisedVolatility([])).toBe(0);
    const range = newRange(state({ price: 100, priceReturns: [] }), "balanced");
    expect(range.lower).toBeCloseTo(98, 6);
    expect(range.upper).toBeCloseTo(102, 6);
  });

  it("respects the daily rebalance ceiling", () => {
    const maxed = state({ price: 110, rebalancesToday: boundaries.maxRebalancesPerDay });
    const s = createRebalancingStrategy(async () => maxed);
    expect(s.evaluate(maxed, ctx("rebalancing", boundaries))).toBeUndefined();
  });

  it("respects the minimum interval between rebalances", () => {
    const recent = state({
      price: 110,
      lastRebalanceAt: NOW - BigInt(boundaries.minSecondsBetween - 10),
    });
    const s = createRebalancingStrategy(async () => recent);
    expect(s.evaluate(recent, ctx("rebalancing", boundaries))).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 3. Grid trading
// ---------------------------------------------------------------------------

describe("grid trading", () => {
  const boundaries = CATEGORY_DEFINITIONS["grid-trading"]
    .defaultBoundaries as GridTradingBoundaries;

  const levels = buildGrid(boundaries, 1000);

  function state(over: Partial<GridState> = {}): GridState {
    return {
      price: 600,
      previousPrice: 600,
      levels,
      spentTodayUsd: 0,
      oraclePrice: 600,
      calls: { buy: () => CALL, sell: () => CALL },
      ...over,
    };
  }

  it("builds a geometric ladder spanning the range", () => {
    expect(levels).toHaveLength(boundaries.levels + 1);
    expect(levels[0]?.price).toBeCloseTo(boundaries.priceMin, 6);
    expect(levels[levels.length - 1]?.price).toBeCloseTo(boundaries.priceMax, 6);
  });

  it("distributes exactly the capital supplied", () => {
    const total = levels.reduce((sum, l) => sum + l.allocationUsd, 0);
    expect(total).toBeCloseTo(1000, 6);
  });

  it("keeps a constant percentage step when geometric", () => {
    const r1 = (levels[1]?.price ?? 0) / (levels[0]?.price ?? 1);
    const r2 = (levels[2]?.price ?? 0) / (levels[1]?.price ?? 1);
    expect(r1).toBeCloseTo(r2, 9);
  });

  it("detects a downward crossing", () => {
    const crossing = crossedLevel(state({ previousPrice: 620, price: 590 }));
    expect(crossing?.direction).toBe("down");
  });

  it("does nothing when no level was crossed", () => {
    const s = createGridStrategy(async () => state());
    expect(s.evaluate(state(), ctx("grid-trading", boundaries))).toBeUndefined();
  });

  it("buys on a downward crossing", () => {
    const crossed = state({ previousPrice: 620, price: 590 });
    const s = createGridStrategy(async () => crossed);
    const action = s.evaluate(crossed, ctx("grid-trading", boundaries));

    expect(action?.reason).toContain("crossed down");
  });

  it("holds during the cooldown, so one candle cannot sweep the ladder", () => {
    const rapid = state({
      previousPrice: 620,
      price: 590,
      lastFillAt: NOW - 10n,
    });
    const s = createGridStrategy(async () => rapid);
    expect(s.evaluate(rapid, ctx("grid-trading", boundaries))).toBeUndefined();
  });

  it("refuses to trade when spot deviates far from the oracle", () => {
    const manipulated = state({
      previousPrice: 620,
      price: 590,
      oraclePrice: 700,
    });
    const s = createGridStrategy(async () => manipulated);
    expect(s.evaluate(manipulated, ctx("grid-trading", boundaries))).toBeUndefined();
  });

  it("applies the daily cap across the whole grid, not per order", () => {
    const spent = state({
      previousPrice: 620,
      price: 590,
      spentTodayUsd: 999_999,
    });
    const s = createGridStrategy(async () => spent);
    expect(s.evaluate(spent, ctx("grid-trading", boundaries))).toBeUndefined();
  });

  it("stops entirely below the stop-out price", () => {
    const b: GridTradingBoundaries = { ...boundaries, stopOutPrice: 550 };
    const crashed = state({ previousPrice: 560, price: 540 });
    const s = createGridStrategy(async () => crashed);
    expect(s.evaluate(crashed, ctx("grid-trading", b))).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 4. Yield optimisation
// ---------------------------------------------------------------------------

describe("yield optimisation", () => {
  const boundaries = CATEGORY_DEFINITIONS["yield-optimisation"]
    .defaultBoundaries as YieldOptimisationBoundaries;

  function state(over: Partial<YieldState> = {}): YieldState {
    return {
      current: "venus",
      capitalUsd: 10_000,
      enteredAt: NOW - BigInt(boundaries.minHoldSeconds + 1),
      gasCostUsd: 3,
      candidates: [
        {
          protocol: "venus",
          grossApy: 0.05,
          borrowCost: 0,
          riskPremium: 0.005,
          utilisation: 0.6,
          volatility: 0.02,
        },
        {
          protocol: "lista",
          grossApy: 0.09,
          borrowCost: 0,
          riskPremium: 0.005,
          utilisation: 0.5,
          volatility: 0.02,
        },
      ],
      calls: { migrate: () => CALL },
      ...over,
    };
  }

  it("uses net APY, not the headline number", () => {
    expect(
      netApy({
        protocol: "venus",
        grossApy: 0.1,
        borrowCost: 0.02,
        riskPremium: 0.01,
        utilisation: 0.5,
        volatility: 0,
      }),
    ).toBeCloseTo(0.07, 9);
  });

  it("computes a break-even horizon", () => {
    // 3 * 365 / (0.035 * 10000) = 3.13 days
    expect(breakEvenDays(0.035, 10_000, 3)).toBeCloseTo(3.129, 2);
  });

  it("treats a non-positive spread as never paying off", () => {
    expect(breakEvenDays(0, 10_000, 3)).toBe(Number.POSITIVE_INFINITY);
    expect(breakEvenDays(-0.01, 10_000, 3)).toBe(Number.POSITIVE_INFINITY);
  });

  it("migrates when the spread clears the gas cost", () => {
    const s = createYieldStrategy(async () => state());
    const action = s.evaluate(state(), ctx("yield-optimisation", boundaries));

    expect(action).toBeDefined();
    expect(action?.reason).toContain("pays for itself");
  });

  it("stays put during the minimum holding period", () => {
    const fresh = state({ enteredAt: NOW - 10n });
    const s = createYieldStrategy(async () => fresh);
    expect(s.evaluate(fresh, ctx("yield-optimisation", boundaries))).toBeUndefined();
  });

  it("ignores a spread below the user's floor", () => {
    const narrow = state({
      candidates: [
        {
          protocol: "venus",
          grossApy: 0.05,
          borrowCost: 0,
          riskPremium: 0,
          utilisation: 0.5,
          volatility: 0.01,
        },
        {
          protocol: "lista",
          grossApy: 0.0501,
          borrowCost: 0,
          riskPremium: 0,
          utilisation: 0.5,
          volatility: 0.01,
        },
      ],
    });
    const s = createYieldStrategy(async () => narrow);
    expect(s.evaluate(narrow, ctx("yield-optimisation", boundaries))).toBeUndefined();
  });

  it("never routes to a protocol the user excluded", () => {
    const b: YieldOptimisationBoundaries = {
      ...boundaries,
      protocolAllowlist: ["venus"],
    };
    // Lista pays far more, but the user removed it.
    expect(bestDestination(state(), b)?.protocol).toBe("venus");
  });

  it("avoids a destination whose utilisation is dangerously high", () => {
    const hot = state({
      candidates: [
        {
          protocol: "venus",
          grossApy: 0.05,
          borrowCost: 0,
          riskPremium: 0.005,
          utilisation: 0.6,
          volatility: 0.02,
        },
        {
          protocol: "lista",
          grossApy: 0.3,
          borrowCost: 0,
          riskPremium: 0,
          utilisation: 0.99,
          volatility: 0.02,
        },
      ],
    });
    expect(bestDestination(hot, boundaries)?.protocol).toBe("venus");
  });

  it("penalises volatility according to the risk profile", () => {
    const volatile = {
      protocol: "lista" as const,
      grossApy: 0.09,
      borrowCost: 0,
      riskPremium: 0,
      utilisation: 0.5,
      // Chosen so the profiles genuinely diverge: at this volatility a
      // conservative user prefers the steadier option and an aggressive one
      // does not. A more extreme value would be rejected by every profile and
      // the test would prove nothing.
      volatility: 0.08,
    };
    const steady = {
      protocol: "venus" as const,
      grossApy: 0.08,
      borrowCost: 0,
      riskPremium: 0,
      utilisation: 0.5,
      volatility: 0.01,
    };

    const s = state({ candidates: [steady, volatile] });

    // A conservative user prefers the steadier, slightly lower yield.
    expect(bestDestination(s, { ...boundaries, riskProfile: "conservative" })?.protocol).toBe(
      "venus",
    );
    // An aggressive one takes the higher headline.
    expect(bestDestination(s, { ...boundaries, riskProfile: "aggressive" })?.protocol).toBe(
      "lista",
    );
  });
});
