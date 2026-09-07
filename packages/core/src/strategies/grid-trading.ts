/**
 * Grid trading. From docs/03-AGENT_CATEGORIES.md category 2.
 *
 * Geometric spacing:  P_i = P_min * (P_max/P_min)^(i/N)  — constant percentage
 * step, which suits volatile pairs. Arithmetic is offered for stable pairs.
 *
 * Trigger: price crosses a level. A downward cross buys that level's allocation
 * and arms a sell above; an upward cross does the reverse. A cooldown stops one
 * volatile candle sweeping the whole ladder.
 */

import type { GridTradingBoundaries, Selector } from "../types.js";
import type { EngagementContext, Strategy } from "../harness.js";

export type GridLevel = {
  index: number;
  price: number;
  /** Capital assigned to this level, in USD. */
  allocationUsd: number;
  /** What this level is currently waiting for. */
  armed: "buy" | "sell" | "none";
};

export type GridState = {
  price: number;
  /** Price at the previous observation, to detect a crossing. */
  previousPrice: number;
  levels: GridLevel[];
  /** Spent in the rolling 24h window, in USD. */
  spentTodayUsd: number;
  /** Unix seconds of the last fill. */
  lastFillAt?: bigint;
  /** Oracle price, for the manipulation guard. */
  oraclePrice: number;
  calls: {
    buy: (level: GridLevel) => { target: `0x${string}`; selector: Selector; payload: `0x${string}` };
    sell: (level: GridLevel) => { target: `0x${string}`; selector: Selector; payload: `0x${string}` };
  };
};

/** Cooldown between fills, so one candle cannot sweep the ladder. */
export const GRID_COOLDOWN_SECONDS = 60;

/**
 * Build the ladder.
 *
 * `lowerWeighting` above 1 puts more capital in the lower half, which is the
 * accumulate-on-the-way-down profile. Weights are normalised so the total
 * always equals the capital supplied, whatever the weighting.
 */
export function buildGrid(
  boundaries: GridTradingBoundaries,
  capitalUsd: number,
): GridLevel[] {
  const { priceMin, priceMax, levels: n, spacing, lowerWeighting } = boundaries;
  if (n < 2 || priceMin <= 0 || priceMax <= priceMin) return [];

  const prices: number[] = [];
  for (let i = 0; i <= n; i++) {
    if (spacing === "geometric") {
      prices.push(priceMin * (priceMax / priceMin) ** (i / n));
    } else {
      prices.push(priceMin + ((priceMax - priceMin) * i) / n);
    }
  }

  // Weight the lower half if asked, then normalise.
  const weights = prices.map((_, i) => (i < prices.length / 2 ? lowerWeighting : 1));
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  return prices.map((price, index) => ({
    index,
    price,
    allocationUsd: (capitalUsd * (weights[index] ?? 1)) / totalWeight,
    armed: "none" as const,
  }));
}

/** The level crossed between two observations, if any. */
export function crossedLevel(
  state: GridState,
): { level: GridLevel; direction: "up" | "down" } | undefined {
  const { price, previousPrice, levels } = state;
  if (price === previousPrice) return undefined;

  const low = Math.min(price, previousPrice);
  const high = Math.max(price, previousPrice);
  const direction = price < previousPrice ? "down" : "up";

  // When several levels are crossed at once, act on the furthest one reached —
  // that is the level whose fill best reflects where the price actually is.
  const crossed = levels
    .filter((l) => l.price > low && l.price <= high)
    .sort((a, b) => (direction === "down" ? a.price - b.price : b.price - a.price));

  const level = crossed[0];
  return level ? { level, direction } : undefined;
}

export function createGridStrategy(
  observe: (engagement: EngagementContext) => Promise<GridState>,
): Strategy<GridState> {
  return {
    category: "grid-trading",

    observe,

    describeTrigger(state) {
      const crossing = crossedLevel(state);
      return crossing
        ? `Price ${state.price.toFixed(4)} crossed level ${crossing.level.index} ${crossing.direction}`
        : `Price ${state.price.toFixed(4)}, no level crossed`;
    },

    evaluate(state, engagement) {
      const b = engagement.boundaries as GridTradingBoundaries;

      // Stop-out overrides everything: the user asked to be out below this.
      if (b.stopOutPrice !== undefined && state.price < b.stopOutPrice) {
        return undefined;
      }

      if (state.lastFillAt !== undefined) {
        const elapsed = Number(engagement.now - state.lastFillAt);
        if (elapsed < GRID_COOLDOWN_SECONDS) return undefined;
      }

      const crossing = crossedLevel(state);
      if (!crossing) return undefined;

      const { level, direction } = crossing;

      // Manipulation guard. PACE checks this too, but proposing an action we
      // know will be refused would fill the blocked feed with our own noise.
      if (state.oraclePrice > 0) {
        const deviationBps =
          (Math.abs(state.price - state.oraclePrice) / state.oraclePrice) * 10_000;
        if (deviationBps > 200) return undefined;
      }

      // The daily cap applies across the WHOLE grid, not per order, so a flash
      // crash cannot sweep past budget one level at a time.
      const capUsd = Number(b.dailySpendCap) / 1e18;
      if (direction === "down" && state.spentTodayUsd + level.allocationUsd > capUsd) {
        return undefined;
      }

      const call =
        direction === "down" ? state.calls.buy(level) : state.calls.sell(level);

      return {
        reason:
          direction === "down"
            ? `Price crossed down through ${level.price.toFixed(4)}. Buying this level's $${level.allocationUsd.toFixed(2)} and arming a sell above it.`
            : `Price crossed up through ${level.price.toFixed(4)}. Selling this level and arming a buy below it.`,
        target: call.target,
        selector: call.selector,
        payload: call.payload,
        maxSlippageBps: b.maxSlippageBps,
      };
    },
  };
}
