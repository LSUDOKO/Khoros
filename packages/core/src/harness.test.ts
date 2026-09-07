/**
 * Harness tests.
 *
 * The central assertion here is CLAUDE.md rule 4: no transaction executes
 * without a valid PDR. These tests are the evidence that the rule holds
 * structurally rather than by convention — a strategy has no route to the
 * executor at all.
 */

import { describe, expect, it, vi } from "vitest";

import {
  runCycle,
  type CycleDependencies,
  type EngagementContext,
  type ProposedAction,
  type Strategy,
  type VerifierResult,
} from "./harness.js";
import type { Address, Hash, TelemetryEvent } from "./types.js";

const ACCOUNT = "0x1111111111111111111111111111111111111111" as Address;
const TARGET = "0x2222222222222222222222222222222222222222" as Address;
const TX = "0xabc123" as Hash;
const NOW = 1_760_000_000n;

const engagement: EngagementContext = {
  engagementId: "eng-1",
  account: ACCOUNT,
  category: "health-factor",
  boundaries: {},
  now: NOW,
};

const action: ProposedAction = {
  reason: "Health factor fell to 1.12, below your floor of 1.15",
  target: TARGET,
  selector: "0x617ba037",
  payload: "0x617ba037dead",
  maxSlippageBps: 100,
};

/** A strategy that always wants to act. */
function alwaysActs(): Strategy<{ hf: number }> {
  return {
    category: "health-factor",
    observe: async () => ({ hf: 1.12 }),
    evaluate: () => action,
    describeTrigger: (s) => `Health factor ${s.hf}`,
  };
}

/** A strategy that never wants to act. */
function neverActs(): Strategy<{ hf: number }> {
  return {
    category: "health-factor",
    observe: async () => ({ hf: 2.4 }),
    evaluate: () => undefined,
    describeTrigger: (s) => `Health factor ${s.hf}, comfortably above the floor`,
  };
}

function deps(verdict: VerifierResult): {
  deps: CycleDependencies;
  events: TelemetryEvent[];
  execute: ReturnType<typeof vi.fn>;
} {
  const events: TelemetryEvent[] = [];
  const execute = vi.fn(async () => ({
    ok: true as const,
    tx: TX,
    gasUsed: 21_000n,
  }));

  return {
    events,
    execute,
    deps: {
      verifier: { simulate: async () => verdict },
      executor: { execute },
      telemetry: {
        emit: async (e) => {
          events.push(e);
        },
      },
      now: () => NOW,
    },
  };
}

const approved: VerifierResult = {
  ok: true,
  pdr: {
    intentHash: "0xhash" as Hash,
    simulationReportHash: "0xreport" as Hash,
    policyHash: "0xpolicy" as Hash,
    simulationBlock: 100n,
    validUntil: NOW + 60n,
    verifierSignature: "0xsig",
  },
  intent: {
    account: ACCOUNT,
    targetContract: TARGET,
    value: 0n,
    selector: "0x617ba037",
    calldataHash: "0xcalldata" as Hash,
    maxSlippageBps: 100n,
    expiry: NOW + 300n,
    nonce: 1n,
  },
  stateDelta: { hfBefore: 1.12, hfAfter: 1.42 },
};

const rejected: VerifierResult = {
  ok: false,
  reason:
    "The top-up was blocked because it would not have lifted your health factor far enough",
  failedInvariant: "hf-floor-after",
  observed: "1.22",
  expected: ">= 1.40",
};

describe("runCycle", () => {
  it("does nothing when the strategy sees no reason to act", async () => {
    const { deps: d, events, execute } = deps(approved);
    const outcome = await runCycle(neverActs(), engagement, d);

    expect(outcome.kind).toBe("idle");
    expect(execute).not.toHaveBeenCalled();
    // Quiet cycles must stay quiet — a feed full of "nothing happened" is noise.
    expect(events).toHaveLength(0);
  });

  it("executes only after the verifier approves", async () => {
    const { deps: d, events, execute } = deps(approved);
    const outcome = await runCycle(alwaysActs(), engagement, d);

    expect(outcome).toEqual({ kind: "executed", tx: TX, latencyMs: expect.any(Number) });
    expect(execute).toHaveBeenCalledOnce();

    // The executor may only be handed an approval, never a bare action.
    const [approval] = execute.mock.calls[0] as [{ ok: boolean }];
    expect(approval.ok).toBe(true);

    expect(events.map((e) => e.kind)).toEqual(["triggered", "executed"]);
  });

  // This is the rule-4 test.
  it("NEVER executes when the verifier rejects", async () => {
    const { deps: d, execute } = deps(rejected);
    const outcome = await runCycle(alwaysActs(), engagement, d);

    expect(execute).not.toHaveBeenCalled();
    expect(outcome.kind).toBe("blocked");
  });

  it("emits a blocked event carrying the failing invariant and observed value", async () => {
    const { deps: d, events } = deps(rejected);
    await runCycle(alwaysActs(), engagement, d);

    const blocked = events.find((e) => e.kind === "blocked");
    expect(blocked).toBeDefined();
    if (blocked?.kind === "blocked") {
      expect(blocked.failedInvariant).toBe("hf-floor-after");
      expect(blocked.observed).toBe("1.22");
      expect(blocked.expected).toBe(">= 1.40");
      // The reason is user-facing copy, not a protocol error string.
      expect(blocked.reason).toContain("blocked");
    }
  });

  it("records the trigger before verification, so a block still shows what fired", async () => {
    const { deps: d, events } = deps(rejected);
    await runCycle(alwaysActs(), engagement, d);

    expect(events.map((e) => e.kind)).toEqual(["triggered", "blocked"]);
  });

  it("reports a failed chain read rather than treating it as nothing to do", async () => {
    const { deps: d, execute } = deps(approved);
    const broken: Strategy<{ hf: number }> = {
      ...alwaysActs(),
      observe: async () => {
        throw new Error("RPC timed out");
      },
    };

    const outcome = await runCycle(broken, engagement, d);

    expect(outcome).toEqual({ kind: "failed", error: "RPC timed out" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("reports a failed execution without claiming success", async () => {
    const { deps: d } = deps(approved);
    d.executor = {
      execute: async () => ({ ok: false, error: "reverted: insufficient balance" }),
    };

    const outcome = await runCycle(alwaysActs(), engagement, d);
    expect(outcome).toEqual({
      kind: "failed",
      error: "reverted: insufficient balance",
    });
  });

  it("carries the verifier's state delta into the executed event", async () => {
    const { deps: d, events } = deps(approved);
    await runCycle(alwaysActs(), engagement, d);

    const executed = events.find((e) => e.kind === "executed");
    if (executed?.kind === "executed") {
      expect(executed.stateDelta).toEqual({ hfBefore: 1.12, hfAfter: 1.42 });
      expect(executed.tx).toBe(TX);
      expect(executed.gasUsed).toBe(21_000n);
    }
  });
});
