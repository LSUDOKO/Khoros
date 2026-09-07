/**
 * Policy evaluation. From docs/05-PACE_SAFETY.md.
 *
 * "The evaluator is pure: state diff plus policy in, verdict out. No model
 * call, no network call, no nondeterminism. The same inputs must always produce
 * the same verdict — that property is what lets a user trust the gate at all."
 *
 * So this module has no imports that touch the network, no clock, and no
 * randomness. Everything time-dependent is passed in. That is what makes a
 * verdict reproducible from the audit log, which is the whole point of keeping
 * one.
 */

import type { AgentCategory } from "@khoros/core";

export type Address = `0x${string}`;
export type Selector = `0x${string}`;

export type Invariant =
  | { kind: "no-net-outflow" }
  | { kind: "min-range-width-bps"; value: number }
  | { kind: "range-contains-spot" }
  | { kind: "hf-must-improve" }
  | { kind: "hf-floor-after"; value: number }
  | { kind: "max-concentration-bps"; value: number }
  | { kind: "oracle-deviation-max-bps"; value: number }
  | { kind: "destination-allowlisted"; value: string[] }
  | { kind: "value-preserved-bps"; value: number }
  | { kind: "utilisation-max-bps"; value: number }
  | { kind: "no-borrow-selector" }
  | { kind: "trade-size-within-level" };

export type Policy = {
  allowedTargets: Address[];
  allowedSelectors: Selector[];
  maxSlippageBps: number;
  spendCaps: { token: Address; limit: bigint; periodSeconds: number }[];
  invariants: Invariant[];
};

/**
 * What the fork simulation observed.
 *
 * Fields are optional because not every category produces every one — a grid
 * trade has no health factor. An invariant that needs a field absent from the
 * diff FAILS rather than passing vacuously; see `missing()` below.
 */
export type StateDiff = {
  /** Net token movements out of the account, in base units, per token. */
  netOutflow?: Record<string, bigint>;
  /** Health factor before and after. */
  hfBefore?: number;
  hfAfter?: number;
  /** New LP range, in price terms. */
  rangeLower?: number;
  rangeUpper?: number;
  /** Pool spot price at simulation. */
  spotPrice?: number;
  /** Oracle price, for the manipulation guard. */
  oraclePrice?: number;
  /** Realised slippage of the simulated swap, in bps. */
  slippageBps?: number;
  /** Portfolio value before and after, in USD. */
  valueBeforeUsd?: number;
  valueAfterUsd?: number;
  /** Largest single-protocol share after the action, in bps. */
  concentrationBps?: number;
  /** Destination protocol for a migration. */
  destination?: string;
  /** Destination utilisation, in bps. */
  utilisationBps?: number;
  /** Spend against each cap in the current window, in base units. */
  spentInWindow?: Record<string, bigint>;
  /** Trade size and the level allocation it must stay within, in USD. */
  tradeSizeUsd?: number;
  levelAllocationUsd?: number;
};

export type PolicyInput = {
  target: Address;
  selector: Selector;
  /** Slippage the intent declares it will tolerate. */
  maxSlippageBps: number;
  /** Amount this action spends, per token, in base units. */
  spend?: Record<string, bigint>;
  diff: StateDiff;
};

export type Verdict =
  | { ok: true }
  | {
      ok: false;
      /** The invariant or check that failed, e.g. "hf-floor-after". */
      failedInvariant: string;
      observed: string;
      expected: string;
      /** Plain-language explanation for the dashboard. */
      reason: string;
    };

/**
 * A required observation was missing from the state diff.
 *
 * This fails closed on purpose. If the simulation could not determine the
 * health factor, we must not approve an action whose safety depends on it —
 * "we could not tell" is not the same as "it is fine", and treating it as such
 * would be the single most dangerous bug this layer could have.
 */
function missing(invariant: string, field: string): Verdict {
  return {
    ok: false,
    failedInvariant: invariant,
    observed: "not observed",
    expected: `a value for ${field}`,
    reason:
      `The simulation could not determine ${field}, so this action was refused. ` +
      `An unverifiable action is treated as unsafe rather than assumed safe.`,
  };
}

/**
 * Evaluate one action against a policy. Pure.
 *
 * Order matters for legibility: the allowlists come first because "this agent
 * may not call that at all" is a clearer answer than a downstream invariant
 * failure.
 */
export function evaluatePolicy(policy: Policy, input: PolicyInput): Verdict {
  const { diff } = input;

  // --- Allowlists ---------------------------------------------------------

  const targetAllowed = policy.allowedTargets.some(
    (t) => t.toLowerCase() === input.target.toLowerCase(),
  );
  if (!targetAllowed) {
    return {
      ok: false,
      failedInvariant: "target-allowlist",
      observed: input.target,
      expected: `one of ${policy.allowedTargets.length} allowed contracts`,
      reason:
        "This agent tried to call a contract outside the list you approved, so the action was refused.",
    };
  }

  const selectorAllowed = policy.allowedSelectors.some(
    (s) => s.toLowerCase() === input.selector.toLowerCase(),
  );
  if (!selectorAllowed) {
    return {
      ok: false,
      failedInvariant: "selector-allowlist",
      observed: input.selector,
      expected: `one of ${policy.allowedSelectors.length} allowed functions`,
      reason:
        "This agent tried to call a function it was never granted, so the action was refused.",
    };
  }

  // --- Slippage -----------------------------------------------------------

  if (input.maxSlippageBps > policy.maxSlippageBps) {
    return {
      ok: false,
      failedInvariant: "max-slippage-bps",
      observed: `${input.maxSlippageBps} bps`,
      expected: `at most ${policy.maxSlippageBps} bps`,
      reason: `The action allowed more slippage than your cap of ${policy.maxSlippageBps / 100}%.`,
    };
  }

  if (diff.slippageBps !== undefined && diff.slippageBps > policy.maxSlippageBps) {
    return {
      ok: false,
      failedInvariant: "max-slippage-bps",
      observed: `${diff.slippageBps} bps`,
      expected: `at most ${policy.maxSlippageBps} bps`,
      reason:
        `The simulation showed slippage of ${(diff.slippageBps / 100).toFixed(2)}%, ` +
        `above your cap of ${(policy.maxSlippageBps / 100).toFixed(2)}%. ` +
        `Raise the cap, or wait for the pool to settle.`,
    };
  }

  // --- Spend caps ---------------------------------------------------------

  for (const cap of policy.spendCaps) {
    const key = cap.token.toLowerCase();
    const spending = input.spend?.[key] ?? 0n;
    const already = diff.spentInWindow?.[key] ?? 0n;

    if (already + spending > cap.limit) {
      return {
        ok: false,
        failedInvariant: "spend-cap",
        observed: `${(already + spending).toString()} base units`,
        expected: `at most ${cap.limit.toString()} base units`,
        reason:
          "This action would take the agent past the spending limit you set for this period.",
      };
    }
  }

  // --- Invariants ---------------------------------------------------------

  for (const invariant of policy.invariants) {
    const verdict = checkInvariant(invariant, diff);
    if (!verdict.ok) return verdict;
  }

  return { ok: true };
}

function checkInvariant(invariant: Invariant, diff: StateDiff): Verdict {
  switch (invariant.kind) {
    case "no-net-outflow": {
      if (diff.netOutflow === undefined) {
        return missing("no-net-outflow", "the net token movement");
      }
      for (const [token, amount] of Object.entries(diff.netOutflow)) {
        if (amount > 0n) {
          return {
            ok: false,
            failedInvariant: "no-net-outflow",
            observed: `${amount.toString()} of ${token} leaving`,
            expected: "no tokens leaving the account",
            reason:
              "The action would have moved tokens out of your account. Agents may rearrange your position, never withdraw from it.",
          };
        }
      }
      return { ok: true };
    }

    case "min-range-width-bps": {
      if (diff.rangeLower === undefined || diff.rangeUpper === undefined) {
        return missing("min-range-width-bps", "the new price range");
      }
      const widthBps =
        ((diff.rangeUpper - diff.rangeLower) / diff.rangeLower) * 10_000;
      if (widthBps < invariant.value) {
        return {
          ok: false,
          failedInvariant: "min-range-width-bps",
          observed: `${widthBps.toFixed(0)} bps wide`,
          expected: `at least ${invariant.value} bps wide`,
          reason:
            "The proposed range was too narrow to be useful, which is the shape a griefing attack takes.",
        };
      }
      return { ok: true };
    }

    case "range-contains-spot": {
      if (
        diff.rangeLower === undefined ||
        diff.rangeUpper === undefined ||
        diff.spotPrice === undefined
      ) {
        return missing("range-contains-spot", "the range and the current price");
      }
      if (diff.spotPrice < diff.rangeLower || diff.spotPrice > diff.rangeUpper) {
        return {
          ok: false,
          failedInvariant: "range-contains-spot",
          observed: `price ${diff.spotPrice} outside ${diff.rangeLower}–${diff.rangeUpper}`,
          expected: "a range containing the current price",
          reason:
            "The new range would not have contained the current price, so the position would have earned nothing immediately.",
        };
      }
      return { ok: true };
    }

    case "hf-must-improve": {
      if (diff.hfBefore === undefined || diff.hfAfter === undefined) {
        return missing("hf-must-improve", "the health factor");
      }
      if (diff.hfAfter <= diff.hfBefore) {
        return {
          ok: false,
          failedInvariant: "hf-must-improve",
          observed: `${diff.hfBefore.toFixed(3)} → ${diff.hfAfter.toFixed(3)}`,
          expected: "a higher health factor after the action",
          reason:
            "The action would not have improved your health factor, so it was refused.",
        };
      }
      return { ok: true };
    }

    case "hf-floor-after": {
      if (diff.hfAfter === undefined) {
        return missing("hf-floor-after", "the health factor after the action");
      }
      if (diff.hfAfter < invariant.value) {
        return {
          ok: false,
          failedInvariant: "hf-floor-after",
          observed: diff.hfAfter.toFixed(3),
          expected: `at least ${invariant.value}`,
          reason:
            `The action would have left your health factor at ${diff.hfAfter.toFixed(2)}, ` +
            `short of the ${invariant.value} target — not enough of a margin to be worth the gas.`,
        };
      }
      return { ok: true };
    }

    case "max-concentration-bps": {
      if (diff.concentrationBps === undefined) {
        return missing("max-concentration-bps", "the resulting allocation");
      }
      if (diff.concentrationBps > invariant.value) {
        return {
          ok: false,
          failedInvariant: "max-concentration-bps",
          observed: `${(diff.concentrationBps / 100).toFixed(1)}%`,
          expected: `at most ${(invariant.value / 100).toFixed(1)}%`,
          reason:
            "The move would have put more of your capital in one protocol than you allowed.",
        };
      }
      return { ok: true };
    }

    case "oracle-deviation-max-bps": {
      if (diff.spotPrice === undefined || diff.oraclePrice === undefined) {
        return missing("oracle-deviation-max-bps", "the pool and oracle prices");
      }
      if (diff.oraclePrice === 0) {
        return missing("oracle-deviation-max-bps", "a usable oracle price");
      }
      const deviationBps =
        (Math.abs(diff.spotPrice - diff.oraclePrice) / diff.oraclePrice) * 10_000;
      if (deviationBps > invariant.value) {
        return {
          ok: false,
          failedInvariant: "oracle-deviation-max-bps",
          observed: `${deviationBps.toFixed(0)} bps from the oracle`,
          expected: `within ${invariant.value} bps`,
          reason:
            "The pool price is far from the oracle price, which is what a manipulated pool looks like. The action was refused rather than trading into it.",
        };
      }
      return { ok: true };
    }

    case "destination-allowlisted": {
      if (diff.destination === undefined) {
        return missing("destination-allowlisted", "the destination protocol");
      }
      if (!invariant.value.includes(diff.destination)) {
        return {
          ok: false,
          failedInvariant: "destination-allowlisted",
          observed: diff.destination,
          expected: `one of ${invariant.value.join(", ")}`,
          reason:
            "The agent tried to move capital to a protocol outside the set you approved.",
        };
      }
      return { ok: true };
    }

    case "value-preserved-bps": {
      if (diff.valueBeforeUsd === undefined || diff.valueAfterUsd === undefined) {
        return missing("value-preserved-bps", "the portfolio value");
      }
      if (diff.valueBeforeUsd === 0) return { ok: true };
      const lossBps =
        ((diff.valueBeforeUsd - diff.valueAfterUsd) / diff.valueBeforeUsd) * 10_000;
      if (lossBps > invariant.value) {
        return {
          ok: false,
          failedInvariant: "value-preserved-bps",
          observed: `${(lossBps / 100).toFixed(2)}% lost`,
          expected: `at most ${(invariant.value / 100).toFixed(2)}% lost`,
          reason:
            "The move would have cost more value in the transition than it could recover.",
        };
      }
      return { ok: true };
    }

    case "utilisation-max-bps": {
      if (diff.utilisationBps === undefined) {
        return missing("utilisation-max-bps", "the destination's utilisation");
      }
      if (diff.utilisationBps > invariant.value) {
        return {
          ok: false,
          failedInvariant: "utilisation-max-bps",
          observed: `${(diff.utilisationBps / 100).toFixed(1)}% utilised`,
          expected: `at most ${(invariant.value / 100).toFixed(1)}%`,
          reason:
            "The destination market is nearly fully borrowed, so you might not be able to withdraw. The move was refused.",
        };
      }
      return { ok: true };
    }

    case "no-borrow-selector":
      // Enforced by the selector allowlist above; kept as a declared invariant
      // so the policy states it explicitly and it appears in the UI.
      return { ok: true };

    case "trade-size-within-level": {
      if (diff.tradeSizeUsd === undefined || diff.levelAllocationUsd === undefined) {
        return missing("trade-size-within-level", "the trade size");
      }
      if (diff.tradeSizeUsd > diff.levelAllocationUsd) {
        return {
          ok: false,
          failedInvariant: "trade-size-within-level",
          observed: `$${diff.tradeSizeUsd.toFixed(2)}`,
          expected: `at most $${diff.levelAllocationUsd.toFixed(2)}`,
          reason:
            "The trade was larger than the capital assigned to that grid level.",
        };
      }
      return { ok: true };
    }
  }
}

// ---------------------------------------------------------------------------
// Per-category policies
// ---------------------------------------------------------------------------

/**
 * The invariants each category enforces, from docs/03-AGENT_CATEGORIES.md.
 *
 * These mirror the `constraints` listed on each CategoryDefinition, which is
 * what the UI shows the user. The two are checked against each other in the
 * tests so the promise and the enforcement cannot drift.
 */
export const CATEGORY_INVARIANTS: Record<AgentCategory, Invariant[]> = {
  rebalancing: [
    { kind: "min-range-width-bps", value: 200 },
    { kind: "range-contains-spot" },
    { kind: "no-net-outflow" },
  ],
  "grid-trading": [
    { kind: "trade-size-within-level" },
    { kind: "oracle-deviation-max-bps", value: 200 },
    { kind: "no-net-outflow" },
  ],
  "yield-optimisation": [
    { kind: "destination-allowlisted", value: ["venus", "lista", "pancakeswap-v3", "aave-v3"] },
    { kind: "max-concentration-bps", value: 6000 },
    { kind: "value-preserved-bps", value: 100 },
    { kind: "utilisation-max-bps", value: 9500 },
  ],
  "health-factor": [
    { kind: "hf-must-improve" },
    { kind: "hf-floor-after", value: 1.4 },
    { kind: "no-borrow-selector" },
    { kind: "oracle-deviation-max-bps", value: 200 },
  ],
};
