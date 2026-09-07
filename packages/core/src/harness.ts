/**
 * The shared agent harness. From docs/10-BUILD_PLAN.md phase 4:
 * "Build the shared harness in packages/core first — trigger loop, intent
 * construction, verifier call, telemetry emission — then the four strategies on
 * top of it."
 *
 * Everything the four runtimes have in common lives here, so a strategy file
 * contains only its strategy. That is what keeps the four categories at equal
 * depth: none of them can quietly skip the verifier, or forget to emit a
 * blocked event, because none of them owns that code.
 *
 * CLAUDE.md rule 4: no execution path skips the PDR. The harness makes this
 * structural — `runCycle` calls the verifier and will not call `execute`
 * without a PDR in hand. A strategy cannot opt out because a strategy never
 * touches the executor.
 */

import type {
  AgentCategory,
  Address,
  Hash,
  Selector,
  StateDelta,
  TelemetryEvent,
} from "./types.js";

// ---------------------------------------------------------------------------
// Intent
// ---------------------------------------------------------------------------

/** What a strategy proposes. Mirrors the on-chain TransactionIntent. */
export type TransactionIntent = {
  account: Address;
  targetContract: Address;
  value: bigint;
  selector: Selector;
  calldataHash: Hash;
  maxSlippageBps: bigint;
  expiry: bigint;
  nonce: bigint;
};

/** A proposed action, before it has been checked by anything. */
export type ProposedAction = {
  /** Why the strategy wants to act. Rendered verbatim in the telemetry feed. */
  reason: string;
  target: Address;
  selector: Selector;
  /** The full encoded payload. The intent commits to its hash. */
  payload: `0x${string}`;
  value?: bigint;
  maxSlippageBps: number;
};

// ---------------------------------------------------------------------------
// Verifier contract
// ---------------------------------------------------------------------------

export type PolicyDecisionRecord = {
  intentHash: Hash;
  simulationReportHash: Hash;
  policyHash: Hash;
  simulationBlock: bigint;
  validUntil: bigint;
  verifierSignature: `0x${string}`;
};

export type VerifierApproval = {
  ok: true;
  pdr: PolicyDecisionRecord;
  intent: TransactionIntent;
  stateDelta: StateDelta;
};

export type VerifierRejection = {
  ok: false;
  /** Plain-language reason, shown to the user. */
  reason: string;
  /** Which invariant failed, e.g. "hf-floor-after". */
  failedInvariant: string;
  observed: string;
  expected: string;
};

export type VerifierResult = VerifierApproval | VerifierRejection;

/** Simulates an action and signs a PDR, or refuses with a reason. */
export type Verifier = {
  simulate(input: {
    engagementId: string;
    category: AgentCategory;
    action: ProposedAction;
  }): Promise<VerifierResult>;
};

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

export type ExecutionResult =
  | { ok: true; tx: Hash; gasUsed: bigint }
  | { ok: false; error: string };

/**
 * Submits an approved action through the Altana session key.
 *
 * Note the shape: it can ONLY be called with a PDR. There is deliberately no
 * overload that takes a bare action, so "execute without checking" is not an
 * expressible call.
 */
export type Executor = {
  execute(approval: VerifierApproval, payload: `0x${string}`): Promise<ExecutionResult>;
};

// ---------------------------------------------------------------------------
// Telemetry
// ---------------------------------------------------------------------------

export type TelemetrySink = {
  emit(event: TelemetryEvent): Promise<void>;
};

// ---------------------------------------------------------------------------
// Strategy
// ---------------------------------------------------------------------------

/**
 * A category's strategy. The whole surface a runtime has to implement.
 *
 * `evaluate` is pure with respect to the chain: it receives observed state and
 * returns what it wants to do. It cannot execute, which is what makes the
 * safety layer non-optional rather than merely conventional.
 */
export type Strategy<TState> = {
  category: AgentCategory;

  /** Read whatever chain state this strategy needs. */
  observe(engagement: EngagementContext): Promise<TState>;

  /**
   * Decide whether to act. Returning undefined means "nothing to do", which is
   * the common case and must be cheap.
   */
  evaluate(state: TState, engagement: EngagementContext): ProposedAction | undefined;

  /** Describe the trigger for the telemetry feed, whether or not it fires. */
  describeTrigger(state: TState): string;
};

export type EngagementContext = {
  engagementId: string;
  account: Address;
  category: AgentCategory;
  /** The category boundaries the user configured at hire time. */
  boundaries: unknown;
  /** Unix seconds. Injected so a cycle is deterministic under test. */
  now: bigint;
};

// ---------------------------------------------------------------------------
// The cycle
// ---------------------------------------------------------------------------

export type CycleDependencies = {
  verifier: Verifier;
  executor: Executor;
  telemetry: TelemetrySink;
  /** Injected for deterministic tests. */
  now?: () => bigint;
};

export type CycleOutcome =
  | { kind: "idle"; trigger: string }
  | { kind: "executed"; tx: Hash; latencyMs: number }
  | { kind: "blocked"; reason: string; failedInvariant: string }
  | { kind: "failed"; error: string };

/**
 * One decision cycle: observe, evaluate, verify, execute, report.
 *
 * The ordering is the safety property. There is no branch in which `execute`
 * runs without a preceding successful `simulate`, and a rejection emits a
 * `blocked` event rather than being swallowed — docs/02 is explicit that
 * "rejected simulations are a feature, not an error".
 */
export async function runCycle<TState>(
  strategy: Strategy<TState>,
  engagement: EngagementContext,
  deps: CycleDependencies,
): Promise<CycleOutcome> {
  const clock = deps.now ?? (() => BigInt(Math.floor(Date.now() / 1000)));
  const startedMs = Date.now();

  let state: TState;
  try {
    state = await strategy.observe(engagement);
  } catch (error) {
    // A failed read must not be mistaken for "nothing to do". Report it.
    return {
      kind: "failed",
      error: error instanceof Error ? error.message : "Could not read chain state",
    };
  }

  const trigger = strategy.describeTrigger(state);
  const action = strategy.evaluate(state, engagement);

  if (!action) {
    return { kind: "idle", trigger };
  }

  // The trigger fired. Record that before anything can go wrong downstream, so
  // the feed shows what the agent noticed even if the action never lands.
  await deps.telemetry.emit({
    kind: "triggered",
    engagementId: engagement.engagementId,
    trigger: action.reason,
    at: clock(),
  });

  const verdict = await deps.verifier.simulate({
    engagementId: engagement.engagementId,
    category: engagement.category,
    action,
  });

  if (!verdict.ok) {
    // Blocked actions are evidence the layer works. They are emitted with the
    // failing invariant and the observed value, and rendered at the same
    // prominence as executions.
    await deps.telemetry.emit({
      kind: "blocked",
      engagementId: engagement.engagementId,
      intentHash: "0x" as Hash,
      reason: verdict.reason,
      failedInvariant: verdict.failedInvariant,
      observed: verdict.observed,
      expected: verdict.expected,
      at: clock(),
    });

    return {
      kind: "blocked",
      reason: verdict.reason,
      failedInvariant: verdict.failedInvariant,
    };
  }

  const result = await deps.executor.execute(verdict, action.payload);

  if (!result.ok) {
    return { kind: "failed", error: result.error };
  }

  const latencyMs = Date.now() - startedMs;

  await deps.telemetry.emit({
    kind: "executed",
    engagementId: engagement.engagementId,
    intentHash: verdict.pdr.intentHash,
    target: action.target,
    selector: action.selector,
    tx: result.tx,
    gasUsed: result.gasUsed,
    latencyMs,
    stateDelta: verdict.stateDelta,
    at: clock(),
  });

  return { kind: "executed", tx: result.tx, latencyMs };
}
