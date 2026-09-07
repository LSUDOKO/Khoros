/**
 * The curated seed set.
 *
 * docs/10-BUILD_PLAN.md authorises this explicitly:
 *
 *   "be willing to hand-curate a seed set of known-good agents per category so
 *    no arena is empty during judging"
 *
 * src/sources/REGISTRY_FINDINGS.md documents why it is needed: zero of 150
 * sampled ERC-8004 registrations on BSC classify into any of the four DeFi
 * categories. The registry is real and the reader works; the agents in it are
 * mostly name-spam.
 *
 * WHAT THESE ARE. Each entry is a Khoros-operated agent: the four runtimes in
 * packages/core/src/strategies, listed so a user can hire the strategy the
 * product actually implements. They are marked `seeded` in the database and
 * labelled "Curated listing" everywhere they render, so none can be mistaken
 * for one discovered on-chain.
 *
 * WHAT THEY ARE NOT. They carry no invented performance history. Their
 * performance rows are written with sampleSize 0, which the UI renders as "no
 * measured history" rather than as zeros that look like results. Reviews and
 * ROI figures appear only when real settlements produce them.
 */

import type { AgentCategory, Address } from "@khoros/core";
import { CATEGORY_DEFINITIONS } from "@khoros/core";

import type { IndexedAgent } from "./sources/registry.js";

/**
 * The wallet the Khoros spike provisions on BSC Testnet.
 *
 * Real and deterministic — derived from SPIKE_ADMIN_KEY, and the address the
 * faucet funds. Using it as the owner means the seeded agents point at an
 * account that genuinely exists rather than a placeholder.
 */
const KHOROS_OPERATOR: Address = "0x7A6fd27153400fA405391e8B05033928CA997A9c";

/**
 * Ids are deliberately far above the live registry's range and marked seeded,
 * so they cannot collide with a real ERC-8004 agent id during ingest.
 */
const SEED_ID_BASE = 900_000_000n;

const SEED_ORDER: AgentCategory[] = [
  "rebalancing",
  "grid-trading",
  "yield-optimisation",
  "health-factor",
];

const SEED_NAMES: Record<AgentCategory, string> = {
  rebalancing: "Meridian LP Keeper",
  "grid-trading": "Cadence Grid",
  "yield-optimisation": "Threnody Yield Router",
  "health-factor": "Bastion Health Guard",
};

export type SeededAgent = IndexedAgent & {
  seeded: true;
  seedNote: string;
};

/**
 * Build the seed set.
 *
 * Descriptions come from the category definitions rather than being written
 * again here, so a seeded agent describes exactly the strategy the runtime
 * implements — the same text the profile and hire form show.
 */
export function buildSeedAgents(now: bigint): SeededAgent[] {
  return SEED_ORDER.map((category, i) => {
    const definition = CATEGORY_DEFINITIONS[category];

    return {
      agentId: SEED_ID_BASE + BigInt(i),
      registry: "khoros:curated",
      owner: KHOROS_OPERATOR,
      name: SEED_NAMES[category],
      description: definition.description,
      registeredAt: now,
      active: true,
      // Reputation only. Claiming a TEE attestation we do not have would be
      // exactly the kind of unearned badge the trust model exists to strip out.
      supportedTrust: ["reputation"],
      services: [
        {
          name: "web",
          endpoint: "https://khoros.app",
        },
      ],
      x402Support: false,
      classification: {
        category,
        confidence: 1,
        protocols: definition.protocols,
      },
      seeded: true,
      seedNote:
        `Operated by Khoros, running the ${definition.label.toLowerCase()} strategy in ` +
        `packages/core/src/strategies. Listed so this category is not empty while the ` +
        `ERC-8004 registry has no agents matching it.`,
    };
  });
}

/**
 * Performance rows for the seed set.
 *
 * Every metric is zero and sampleSize is 0. That is not a placeholder — it is
 * the honest state, and the UI renders sampleSize 0 as "no measured history"
 * rather than as a measured zero. CLAUDE.md rule 5.
 */
export function buildSeedPerformance(
  agent: SeededAgent,
  now: bigint,
): {
  agentId: bigint;
  window: "30d";
  returnValue: number;
  returnLabel: string;
  maxDrawdownBps: number;
  activityCount30d: number;
  precisionBps: number;
  medianLatencyMs: number;
  scaleUsd: number;
  sampleSize: number;
  sparkline: { t: number; v: number }[];
  computedAt: bigint;
} {
  const category = agent.classification.category;
  const label =
    category === "uncategorised"
      ? "Return"
      : CATEGORY_DEFINITIONS[category].metrics.return;

  return {
    agentId: agent.agentId,
    window: "30d",
    returnValue: 0,
    returnLabel: label,
    maxDrawdownBps: 0,
    activityCount30d: 0,
    precisionBps: 0,
    medianLatencyMs: 0,
    scaleUsd: 0,
    // Zero observations. The UI must not present this as a measurement.
    sampleSize: 0,
    sparkline: [],
    computedAt: now,
  };
}
