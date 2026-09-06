/**
 * Category definitions. Transcribed from docs/03-AGENT_CATEGORIES.md.
 *
 * This module is the single source of truth for the equal-depth contract. Every
 * category surface in the product reads its copy, its metric labels, its session
 * scope manifest, and its boundary defaults from here — so a category cannot
 * silently end up thinner than its siblings. A missing field is a type error
 * rather than a design review finding.
 *
 * The six metric SLOTS are identical across categories and always render in the
 * same order. Only their MEANING differs, which is why each definition supplies
 * its own labels for the same six positions.
 */

import type {
  AgentCategory,
  CategoryBoundaries,
  Protocol,
  Selector,
} from "./types.js";

/** The six headline slots, in the fixed order every surface renders them. */
export const METRIC_SLOTS = [
  "return",
  "risk",
  "activity",
  "precision",
  "latency",
  "scale",
] as const;

export type MetricSlot = (typeof METRIC_SLOTS)[number];

/** How one category labels the six shared slots. */
export type MetricLabels = Record<MetricSlot, string>;

/** A selector the session scope allows, kept with its human name. */
export type ScopeSelector = { sig: Selector; name: string };

/** The session scope manifest a category requests at hire time. */
export type ScopeManifest = {
  /** Named contract targets. Addresses resolve per-chain at runtime. */
  targets: { key: string; label: string }[];
  selectors: ScopeSelector[];
  /** Selectors this category must never be granted, and why. */
  denied: { name: string; reason: string }[];
  /** Default session lifetime in seconds. */
  defaultExpirySeconds: number;
};

/** A PACE invariant this category enforces before any execution. */
export type PolicyConstraint = {
  id: string;
  description: string;
};

export type CategoryDefinition = {
  id: AgentCategory;
  /** Display name, sentence case per the design system. */
  label: string;
  /** Artifact 1 — plain-language description, two sentences. */
  description: string;
  /** Artifact 2 — strategy logic write-up, rendered expandable on the profile. */
  strategy: string;
  /** Artifact 3 — the trigger condition, stated precisely. */
  trigger: string;
  /** Artifact 4 — labels for the six shared metric slots. */
  metrics: MetricLabels;
  /** Units for the return slot, so the UI can format without a lookup table. */
  returnUnit: "percent" | "usd";
  /** Artifact 7 — the session scope manifest. */
  scope: ScopeManifest;
  /** Artifact 8 — PACE policy constraints. */
  constraints: PolicyConstraint[];
  protocols: Protocol[];
  /** Artifact 10 — defaults for the hire form. */
  defaultBoundaries: CategoryBoundaries;
  /** The seed intent chip that routes here from the front door. */
  seedChip: string;
};

const DAY = 86_400;

export const CATEGORY_DEFINITIONS: Record<AgentCategory, CategoryDefinition> = {
  rebalancing: {
    id: "rebalancing",
    label: "Rebalancing",
    description:
      "Keeps a concentrated liquidity position earning fees by moving the price range when the market drifts away from it. When your position goes out of range it stops earning entirely, and this agent puts it back to work without you watching a chart.",
    strategy:
      "PancakeSwap V3 concentrates liquidity into a tick interval. Inside the range capital earns fees efficiently; outside it capital efficiency drops to zero while the position stays fully exposed to price movement. Compounding this is loss-versus-rebalancing, where arbitrageurs systematically extract value from stale positions. The agent recentres the range on the current price with width scaled to realised volatility, then restores the inventory ratio so both sides of the pair are working.",
    trigger:
      "Rebalance when expected fee gain from a recentred range exceeds gas plus slippage plus LVR over a forward horizon. Price is modelled as jump-diffusion so a volatility spike does not trigger a rebalance that mean reversion would immediately undo. A hard secondary trigger fires whenever price crosses the boundary tick, regardless of the economic calculation.",
    metrics: {
      return: "Fee APR",
      risk: "Max drawdown incl. IL",
      activity: "Rebalances / 30d",
      precision: "Time in range",
      latency: "Median trigger→tx",
      scale: "TVL managed",
    },
    returnUnit: "percent",
    scope: {
      targets: [
        { key: "PANCAKE_V3_POSITION_MANAGER", label: "PancakeSwap V3 Position Manager" },
        { key: "PANCAKE_V3_SWAP_ROUTER", label: "PancakeSwap V3 Swap Router" },
      ],
      selectors: [
        { sig: "0x88316456", name: "mint" },
        { sig: "0x0c49ccbe", name: "decreaseLiquidity" },
        { sig: "0xfc6f7865", name: "collect" },
        { sig: "0x414bf389", name: "exactInputSingle" },
      ],
      denied: [
        { name: "transfer", reason: "The agent can never move your tokens to another address." },
        { name: "approve", reason: "The agent cannot approve a spender outside the allowlist." },
      ],
      defaultExpirySeconds: 7 * DAY,
    },
    constraints: [
      { id: "max-slippage-bps", description: "Swap slippage must stay at or below 50 bps." },
      { id: "min-range-width-bps", description: "New range width must be at least 2%, blocking dust-range griefing." },
      { id: "range-contains-spot", description: "The resulting position must contain the current price." },
      { id: "no-net-outflow", description: "No net token outflow from the account." },
    ],
    protocols: ["pancakeswap-v3"],
    defaultBoundaries: {
      kind: "rebalancing",
      widthProfile: "balanced",
      maxSlippageBps: 50,
      maxRebalancesPerDay: 4,
      minSecondsBetween: 3600,
      dailyGasBudget: 20_000_000_000_000_000n, // 0.02 BNB
    },
    seedChip: "Keep my PancakeSwap CAKE/USDT position in range",
  },

  "grid-trading": {
    id: "grid-trading",
    label: "Grid trading",
    description:
      "Places a ladder of buy and sell orders across a price range and works it automatically as the market moves. It captures the swing between levels without you having to hand-place forty orders or hand custody to an exchange.",
    strategy:
      "The agent partitions a price range into levels, geometrically for volatile pairs so each step is a constant percentage, arithmetically for stable pairs. Capital is divided across levels, optionally weighted to the lower half to accumulate on the way down. Each downward crossing buys that level's allocation and arms a sell above it; each upward crossing does the reverse, realising the spread. Running on-chain removes the custody risk of a centralised exchange grid bot.",
    trigger:
      "Price crosses a grid level. A downward cross buys that level's allocation and arms a sell at the level above; an upward cross sells and arms a buy below. A cooldown prevents a single volatile candle from sweeping the entire ladder.",
    metrics: {
      return: "Grid profit",
      risk: "Max drawdown",
      activity: "Filled orders / 30d",
      precision: "Grid capture rate",
      latency: "Median trigger→tx",
      scale: "TVL managed",
    },
    returnUnit: "percent",
    scope: {
      targets: [
        { key: "PANCAKE_V3_SWAP_ROUTER", label: "PancakeSwap V3 Swap Router" },
        { key: "PANCAKE_V3_QUOTER", label: "PancakeSwap V3 Quoter" },
      ],
      selectors: [
        { sig: "0x414bf389", name: "exactInputSingle" },
        { sig: "0xdb3e2198", name: "exactOutputSingle" },
      ],
      denied: [
        { name: "transfer", reason: "The agent can never move your tokens to another address." },
        { name: "*", reason: "Any target outside PancakeSwap is refused." },
      ],
      defaultExpirySeconds: 7 * DAY,
    },
    constraints: [
      { id: "rolling-daily-spend-cap", description: "A rolling 24h spend cap applies across the whole grid, not per order, so a flash crash cannot sweep past budget." },
      { id: "max-slippage-bps", description: "Per-trade slippage must stay within your cap." },
      { id: "trade-size-within-level", description: "No trade may exceed its level's allocation." },
      { id: "oracle-deviation-max-bps", description: "Rejected if pool spot deviates from the oracle beyond threshold, guarding against manipulation." },
    ],
    protocols: ["pancakeswap-v3"],
    defaultBoundaries: {
      kind: "grid-trading",
      priceMin: 500,
      priceMax: 700,
      levels: 20,
      spacing: "geometric",
      lowerWeighting: 1,
      dailySpendCap: 1_000_000_000_000_000_000_000n, // 1000 units, 18dp
      maxSlippageBps: 50,
    },
    seedChip: "Grid trade BNB between $500 and $700",
  },

  "yield-optimisation": {
    id: "yield-optimisation",
    label: "Yield optimisation",
    description:
      "Moves idle stablecoins to wherever they earn the most across Venus, Lista and PancakeSwap, and moves them again when that changes. It only acts when the extra yield actually pays for the gas it costs to move.",
    strategy:
      "The agent maximises expected net APY across protocols subject to a concentration cap, penalising allocations by a covariance term built from TVL volatility, utilisation swings and oracle deviation history. Net APY is gross yield minus borrow cost minus an expected protocol risk premium, not the headline number. Risk aversion is exposed as conservative, balanced or aggressive, and the user can exclude any protocol entirely.",
    trigger:
      "Migrate when the APY spread times capital over the holding horizon exceeds the gas cost of moving. The break-even horizon is computed and shown to the user in plain language, for example 'this move pays for itself in 2.8 days'.",
    metrics: {
      return: "Net APY delta",
      risk: "Max drawdown",
      activity: "Migrations / 30d",
      precision: "Time at best APY",
      latency: "Median trigger→tx",
      scale: "TVL managed",
    },
    returnUnit: "percent",
    scope: {
      targets: [
        { key: "VENUS_VTOKEN", label: "Venus vTokens" },
        { key: "LISTA_STAKING", label: "Lista staking" },
        { key: "PANCAKE_V3_POSITION_MANAGER", label: "PancakeSwap V3 Position Manager" },
      ],
      selectors: [
        { sig: "0xa0712d68", name: "mint" },
        { sig: "0x852a12e3", name: "redeemUnderlying" },
        { sig: "0xb6b55f25", name: "deposit" },
        { sig: "0x2e1a7d4d", name: "withdraw" },
        { sig: "0xa694fc3a", name: "stake" },
        { sig: "0x2e17de78", name: "unstake" },
      ],
      denied: [
        {
          name: "transfer",
          reason:
            "Capital structurally cannot leave the set of audited protocols. Even a fully compromised planner cannot route funds to an attacker.",
        },
      ],
      defaultExpirySeconds: 14 * DAY,
    },
    constraints: [
      { id: "destination-allowlisted", description: "The destination protocol must be on the allowlist." },
      { id: "max-concentration-bps", description: "No protocol may exceed the concentration cap after migration." },
      { id: "value-preserved", description: "Simulated post-state value must be within tolerance of pre-state value." },
      { id: "utilisation-safety-bound", description: "Blocked if the destination's utilisation exceeds a safety bound." },
    ],
    protocols: ["venus", "lista", "pancakeswap-v3", "aave-v3"],
    defaultBoundaries: {
      kind: "yield-optimisation",
      riskProfile: "balanced",
      maxConcentrationBps: 6000,
      minSpreadBps: 50,
      minHoldSeconds: 2 * DAY,
      protocolAllowlist: ["venus", "lista", "pancakeswap-v3"],
    },
    seedChip: "Move my stablecoins to the best yield on BNB Chain",
  },

  "health-factor": {
    id: "health-factor",
    label: "Health factor monitoring",
    description:
      "Watches your Venus or Aave borrow position and acts before it can be liquidated, by topping up collateral or paying down debt. Liquidation costs 5–15% of your collateral, so preventing one is worth far more than reacting to it.",
    strategy:
      "Health factor is collateral times liquidation threshold over debt. The agent responds on a ladder: first add collateral from pre-authorised reserves, which is cheapest; if no reserve is available, partially deleverage by withdrawing a computed collateral slice, swapping it and repaying debt; if neither is possible within its permissions, it alerts and stops rather than exceeding scope to 'save' the position. It targets a health factor of 1.40 after intervening.",
    trigger:
      "Reactive: health factor falls to the floor, 1.15 by default. Predictive, and the point of the product: a rolling value-at-risk projection on collateral price shows the floor would be breached, so the agent acts before the level is reached rather than after.",
    metrics: {
      return: "Penalties avoided",
      risk: "Lowest HF reached",
      activity: "Interventions / 30d",
      precision: "Interventions before HF 1.0",
      latency: "Median trigger→tx",
      scale: "Debt protected",
    },
    returnUnit: "usd",
    scope: {
      targets: [
        { key: "VENUS_COMPTROLLER", label: "Venus Comptroller" },
        { key: "VENUS_VTOKEN", label: "Venus vTokens" },
        { key: "AAVE_V3_POOL", label: "Aave V3 Pool" },
        { key: "PANCAKE_V3_SWAP_ROUTER", label: "PancakeSwap V3 Swap Router" },
      ],
      selectors: [
        { sig: "0x617ba037", name: "supply" },
        { sig: "0xa0712d68", name: "mint" },
        { sig: "0x0e752702", name: "repayBorrow" },
        { sig: "0x852a12e3", name: "redeemUnderlying" },
        { sig: "0x414bf389", name: "exactInputSingle" },
      ],
      denied: [
        { name: "borrow", reason: "The agent can never increase your leverage." },
        { name: "transfer", reason: "The agent can never move your tokens to another address." },
      ],
      defaultExpirySeconds: 30 * DAY,
    },
    constraints: [
      { id: "hf-must-improve", description: "Simulated health factor after the action must be strictly higher than before." },
      { id: "hf-floor-after", description: "Health factor after the action must reach at least 1.40, or the action is rejected as insufficient." },
      { id: "max-slippage-bps", description: "Deleverage swap slippage must stay at or below 100 bps — deliberately wider than rebalancing, because speed beats precision when the alternative is a 5–15% penalty." },
      { id: "no-borrow-selector", description: "The borrow selector is refused under all circumstances." },
      { id: "oracle-deviation-max-bps", description: "Oracle sanity check against a secondary feed, so a manipulated oracle cannot induce a spurious deleverage." },
    ],
    protocols: ["venus", "aave-v3", "pancakeswap-v3"],
    defaultBoundaries: {
      kind: "health-factor",
      hfFloor: 1.15,
      hfTarget: 1.4,
      reserveAuthorised: 500_000_000_000_000_000_000n, // 500 units, 18dp
      preferredResponse: "collateral-first",
      maxInterventionsPerDay: 6,
      predictiveConfidence: 0.95,
    },
    seedChip: "Protect my Venus borrow from liquidation",
  },
};

/** Ordered list, for surfaces that render all four. */
export const CATEGORY_LIST: CategoryDefinition[] = [
  CATEGORY_DEFINITIONS.rebalancing,
  CATEGORY_DEFINITIONS["grid-trading"],
  CATEGORY_DEFINITIONS["yield-optimisation"],
  CATEGORY_DEFINITIONS["health-factor"],
];

export function categoryDefinition(id: AgentCategory): CategoryDefinition {
  return CATEGORY_DEFINITIONS[id];
}

/** The four seed chips on the front door, in display order. */
export const SEED_CHIPS: { category: AgentCategory; text: string }[] =
  CATEGORY_LIST.map((c) => ({ category: c.id, text: c.seedChip }));
