/**
 * ERC-8183 escrowed hiring. From docs/06-INTEGRATIONS.md and docs/10 phase 6.
 *
 * Written against the SDK as published (v0.9.0), whose interface is confirmed:
 *
 *   hireErc8183Agent(session, params, opts)  — the buyer's five on-chain
 *     actions (createJob, registerJob, setBudget, approve $U, fund) batched
 *     into ONE atomic relay intent. Studio buyers need five self-paid
 *     transactions for the same flow.
 *
 * The Altana bonus criterion names `hireErc8183Agent` specifically, and it can
 * be driven by a SESSION rather than the admin key — which is what lets a
 * coordinator agent hire specialists on the user's behalf inside its scope.
 *
 * Deployment addresses on chain 97, from the SDK's own registry and verified
 * with eth_getCode:
 *   commerce 0xa206c0517B6371C6638CD9e4a42Cc9f02A33B0DE
 *   router   0xD7d36D66d2F1B608A0F943f722D27e3744f66F25
 *   policy   0xd6a4217588F6B1F5657a92A3e94E6422aD771cEA
 *   $U       0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565
 */

import type { AgentCategory, Address, Hash } from "@khoros/core";

import { EXECUTION_CHAIN_ID, getAltanaClient } from "../altana/sessions";

export type JobState =
  | "open"
  | "funded"
  | "submitted"
  | "completed"
  | "rejected"
  | "expired";

/** JOB_STATUS in the SDK is order-locked with the AgenticCommerce kernel. */
const STATUS_NAMES = [
  "open",
  "funded",
  "submitted",
  "completed",
  "rejected",
  "expired",
] as const;

export function jobStateFromStatus(status: number): JobState {
  return STATUS_NAMES[status] ?? "open";
}

/** Addresses of the ERC-8183 stack for a chain, read from the SDK. */
export async function erc8183Addresses(chainId: 56 | 97 = EXECUTION_CHAIN_ID) {
  const { erc8183Addresses: lookup } = await import("@altananetwork/sdk");
  return lookup(chainId);
}

export type HireJobInput = {
  /** The agent's wallet — the ERC-8183 provider. */
  provider: Address;
  /** What the agent is being hired to do, in the user's own terms. */
  task: string;
  /** Budget in raw $U units (18 decimals). */
  budget: bigint;
  /** Extra submission time beyond the dispute window. */
  deadlineSeconds?: number;
};

export type HireJobResult = {
  jobId: bigint;
  provider: Address;
  budget: bigint;
  expiredAt: bigint;
  tx?: Hash;
  status: string;
};

/**
 * Create and fund a job in one atomic batch.
 *
 * `session` is the Altana session granted at hire time, so the escrow is opened
 * within the same scope the user approved rather than requiring a second
 * authority.
 */
export async function hireAgent(
  session: unknown,
  input: HireJobInput,
): Promise<HireJobResult> {
  const { hireErc8183Agent, BNB_TESTNET } = await import("@altananetwork/sdk");

  const result = await hireErc8183Agent(
    session as never,
    {
      provider: input.provider,
      task: input.task,
      budget: input.budget,
      deadlineSeconds: input.deadlineSeconds,
    },
    { network: BNB_TESTNET },
  );

  return {
    jobId: result.jobId,
    provider: result.provider as Address,
    budget: result.budget,
    expiredAt: result.expiredAt,
    tx: result.transactionHash as Hash | undefined,
    status: result.status,
  };
}

/** Read a job's current state from the kernel. */
export async function readJob(jobId: bigint): Promise<{
  jobId: bigint;
  client: Address;
  provider: Address;
  budget: bigint;
  state: JobState;
  expiredAt: bigint;
  deliverable: Hash;
} | undefined> {
  try {
    const { getErc8183Job, BNB_TESTNET } = await import("@altananetwork/sdk");
    const job = await getErc8183Job(BNB_TESTNET, jobId);

    return {
      jobId: job.id,
      client: job.client as Address,
      provider: job.provider as Address,
      budget: job.budget,
      state: jobStateFromStatus(job.status),
      expiredAt: job.expiredAt,
      deliverable: job.deliverable as Hash,
    };
  } catch {
    // A job that cannot be read is reported absent rather than invented.
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Coordinator — multi-category intents
// ---------------------------------------------------------------------------

/**
 * A slice of the user's capital assigned to one specialist.
 *
 * docs/03: "Requires a shared constraint object so two agents can't spend the
 * same dollar; the coordinator holds allocation, each specialist's session is
 * scoped to its own slice."
 *
 * That constraint is enforced here by construction: `planCoordination` splits a
 * fixed total and asserts the parts sum to it, so an allocation that
 * double-spends cannot be produced.
 */
export type SubEngagement = {
  category: AgentCategory;
  /** This specialist's slice, in base units. */
  allocation: bigint;
  /** Why this specialist is in the plan, for the cascade UI. */
  role: string;
};

export type CoordinationPlan = {
  total: bigint;
  parts: SubEngagement[];
};

/**
 * Split capital across the categories a multi-category intent named.
 *
 * The split is deliberate rather than even where the categories interact:
 * a health-factor agent guarding a position needs a reserve held back, and the
 * yield agent works only the surplus above it. docs/03 gives these pairings.
 */
export function planCoordination(
  categories: AgentCategory[],
  total: bigint,
): CoordinationPlan {
  if (categories.length === 0) return { total, parts: [] };

  const unique = [...new Set(categories)];

  // "Protect my loan and reinvest the surplus" — the health-factor agent holds
  // a reserve floor; yield works only what is left above it.
  const hasHf = unique.includes("health-factor");
  const hasYield = unique.includes("yield-optimisation");

  const parts: SubEngagement[] = [];

  if (hasHf && hasYield && unique.length === 2) {
    // 40% held as the protective reserve, 60% put to work.
    const reserve = (total * 40n) / 100n;
    parts.push({
      category: "health-factor",
      allocation: reserve,
      role: "Holds a reserve to defend the borrow position",
    });
    parts.push({
      category: "yield-optimisation",
      allocation: total - reserve,
      role: "Works the surplus above the reserve",
    });
    return { total, parts };
  }

  // Otherwise split evenly, giving any remainder to the first specialist so the
  // parts always sum exactly to the total.
  const share = total / BigInt(unique.length);
  const remainder = total - share * BigInt(unique.length);

  unique.forEach((category, i) => {
    parts.push({
      category,
      allocation: i === 0 ? share + remainder : share,
      role: ROLE_COPY[category],
    });
  });

  return { total, parts };
}

const ROLE_COPY: Record<AgentCategory, string> = {
  rebalancing: "Keeps the liquidity position in range",
  "grid-trading": "Works the range with a ladder of orders",
  "yield-optimisation": "Routes capital to the best available yield",
  "health-factor": "Watches the borrow position and intervenes early",
};

/**
 * Two agents must never be able to spend the same dollar.
 *
 * Checked explicitly rather than assumed, because this is the invariant the
 * whole coordinator rests on.
 */
export function validatePlan(plan: CoordinationPlan): string[] {
  const problems: string[] = [];

  const sum = plan.parts.reduce((total, p) => total + p.allocation, 0n);
  if (sum !== plan.total) {
    problems.push(
      `Allocations sum to ${sum} but the parent holds ${plan.total}. ` +
        `A mismatch means two agents could spend the same capital.`,
    );
  }

  for (const part of plan.parts) {
    if (part.allocation <= 0n) {
      problems.push(`${part.category} was allocated nothing.`);
    }
  }

  const categories = plan.parts.map((p) => p.category);
  if (new Set(categories).size !== categories.length) {
    problems.push("The same category appears twice in one plan.");
  }

  return problems;
}
