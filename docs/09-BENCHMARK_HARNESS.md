# 09 — The Agent Advantage Harness

## What TermiX is asking

TermiX judges one question: does hiring an agent on this marketplace actually beat
doing the job yourself, and can you prove it with numbers? They score
independently of the main track and they will hire from the marketplace themselves
to check.

Their weighting:

| Criterion | Weight | What we build for it |
|-----------|--------|----------------------|
| Value of the services | 30% | Agents that work, at a price and speed that beats manual |
| Proven agent advantage | 30% | This harness and its report |
| High-stakes categories & track record | 20% | Trading and security tasks, real win-rate data |
| Marketplace quality | 20% | Find, compare, hire without instructions |

The mandatory artifact is an Agent Advantage Report: at least three real tasks run
both ways, reporting time, cost, and output quality, with the actual outputs
attached, and at least one task from trading, stock, or security.

**Our approach:** make the report a live surface at `/benchmark` rather than a PDF.
A judge can open it, see both branches, and click through to the transactions. The
PDF export exists too, because the rules ask for a report, but the product is the
primary artifact.

---

## The honesty rule

This section is the most important thing in this document.

Every number on `/benchmark` comes from a run that actually happened, with a
transaction hash. The manual branch is a real human performing the task with a
timer running and a screen recording, not an estimate of how long a human would
take.

Where a figure is a single observation, the page says so. Where it is an average,
the page gives n. Where the manual branch was performed by a member of the team
who already knew the interface, the page says that too — it makes the manual branch
*faster* than a real user's, which makes the comparison conservative and therefore
more credible.

TermiX will hire agents from this marketplace and compare what comes back against
what we claimed. A modest real number survives that. An impressive fabricated one
does not, and it takes the credibility of the whole submission with it.

---

## Task 1 — PancakeSwap V3 range recovery

**Domain:** trading (high-stakes, weighted above general-purpose)

**Setup.** A CAKE/USDT concentrated liquidity position on BSC Testnet, deliberately
positioned so a price move pushes it out of range. Two identical positions are
opened, one for each branch, with the same capital and the same initial range.

**Trigger.** Price moves beyond the position's upper or lower tick. Both branches
are notified at the same instant — the manual operator gets the same alert the
agent's runtime receives.

**Manual branch, measured steps:**

1. Alert received (t=0, recorded)
2. Open PancakeSwap interface, connect wallet
3. Read current price, decide new range
4. `decreaseLiquidity`, sign
5. `collect`, sign
6. Swap to rebalance inventory ratio, sign
7. `mint` new position, sign
8. Position live (t=end, recorded)

**Agent branch:** trigger observed → intent built → PACE simulation → executor call
→ inclusion. All timestamps logged by the runtime.

**Measured:**

| Metric | How |
|--------|-----|
| Elapsed time | Alert timestamp to position-live timestamp, both branches |
| Gas | Sum of gas × price across all transactions in the branch |
| Fees forgone | Pool fee accrual during the out-of-range window, from pool state |
| Slippage | Executed price vs. TWAP at execution, on the inventory swap |
| Range quality | Width vs. realised volatility; whether the new range contains spot |

**Outputs attached:** both branches' transaction hashes, the final position NFT
ids, the pool state at each step, and the screen recording of the manual branch.

---

## Task 2 — Venus liquidation defense

**Domain:** security (second high-stakes category, largest dollar delta)

**Setup.** Two Venus borrow positions on BSC Testnet with identical collateral and
debt, both at a health factor around 1.3. Collateral price is moved via the testnet
oracle to drive HF toward 1.0.

**Trigger.** HF crosses the 1.15 floor. Manual operator is alerted at the same
instant the agent's runtime detects it.

**Manual branch:** alert → open Venus → connect → check position → approve token →
supply collateral → confirm → HF restored.

**Agent branch:** predictive trigger fires before the reactive floor, intent built,
simulated (invariants: HF must improve, post-HF ≥ 1.40), executed.

**Measured:**

| Metric | How |
|--------|-----|
| Elapsed time | Alert to HF restored |
| HF trough | Lowest HF reached in each branch |
| Liquidated | Whether a liquidation bot took any collateral, and how much |
| Penalty | Collateral seized × liquidation incentive |
| Gas | As above |

This task carries the largest dollar difference because the manual branch can
actually lose to a liquidation bot. If it does, that is the single most persuasive
number in the report — and it must be a real liquidation, on-chain, with the
liquidator's transaction linked.

If the manual branch survives without liquidation in a given run, report that
honestly. Run it several times; the distribution is more informative than one
favourable instance.

---

## Task 3 — Cross-protocol yield migration

**Domain:** yield

**Setup.** Equal stablecoin capital in a Venus market for both branches. A yield
divergence is created or observed — Venus supply APY falls while a Lista vault
offers materially more.

**Trigger.** Spread exceeds the gas-amortised threshold.

**Manual branch:** notice the divergence (this is where the manual delay is real
and large — a human checks yields occasionally, not continuously), evaluate the
destination, compute whether the move pays for itself, redeem, stake.

**Agent branch:** continuous monitoring, break-even horizon computed, migration
executed.

**Measured:**

| Metric | How |
|--------|-----|
| Detection delay | Divergence onset to action, both branches |
| Yield forgone | Capital × APY spread × delay |
| Gas | As above |
| Allocation quality | Post-migration APY vs. the best available at that moment |

Detection delay is the honest heart of this task. The agent's advantage here is not
faster execution, it is *continuous attention*. Frame it that way in the report
rather than overstating the execution speed.

---

## Harness implementation

```
bench/
├── tasks/
│   ├── lp-range-recovery.ts
│   ├── venus-liquidation-defense.ts
│   └── yield-migration.ts
├── lib/
│   ├── clock.ts          # monotonic timestamps, both branches
│   ├── manual.ts         # manual branch recorder
│   ├── chain.ts          # gas accounting, receipt collection
│   └── evidence.ts       # artifact bundling
├── runs/                 # one directory per run, committed
│   └── 2026-09-.../
│       ├── run.json
│       ├── manual/
│       └── agent/
└── report/
    ├── build.ts          # runs → report data
    └── export-pdf.ts
```

### The run record

```ts
export type BenchmarkRun = {
  runId: string;
  task: "lp-range-recovery" | "venus-liquidation-defense" | "yield-migration";
  startedAt: number;
  chain: 97;

  manual: BranchResult;
  agent: BranchResult;

  notes: string;            // conditions, anomalies, anything a reader should know
  operator: string;         // who ran the manual branch and their familiarity
};

export type BranchResult = {
  elapsedMs: number;
  transactions: { hash: Hash; gasUsed: bigint; gasPriceWei: bigint; step: string }[];
  gasCostUsd: number;
  opportunityCostUsd: number;   // fees forgone, yield forgone, penalty paid
  totalCostUsd: number;
  outcome: Record<string, unknown>;  // task-specific end state
  artifacts: string[];          // paths to recordings, state dumps
};
```

Runs are committed to the repo. A judge can read the raw record, not just the
rendered summary.

### The manual branch recorder

A small CLI the human operator runs. It starts a monotonic clock on the alert,
prompts for each step boundary, captures transaction hashes as they land, and
writes the branch result. This removes the temptation to reconstruct timings
afterwards from memory.

```
$ pnpm bench manual --task lp-range-recovery
  Waiting for trigger... trigger at 14:22:07.412
  [enter] when you have opened the interface
  [enter] when you have signed decreaseLiquidity
  ...
  Recorded. Elapsed 18m 42s. 4 transactions. Written to runs/.../manual/
```

---

## The report surface

`/benchmark` renders each task as a paired comparison — the two branches side by
side on desktop, stacked on mobile — with:

- The elapsed-time bars at true proportion, so the difference is visual before it
  is numeric
- Cost broken into gas and opportunity cost, because the gas difference is small
  and the opportunity cost is the actual story
- The outcome state for both branches
- Every transaction hash as a `VerifyLink` to BscScan
- Sample size and run date, stated plainly
- The operator note

At the top, a summary line that does not overstate: *"Across three tasks and n runs
on BSC Testnet, agent execution completed in seconds where manual execution took
minutes to hours, and avoided the opportunity costs incurred by the delay. Full
records below."*

A "Download report" action exports the same content as PDF for the formal
submission requirement.

---

## Hire-from-the-marketplace path

TermiX say they will hire from the marketplace themselves. Make that trivially
easy:

- A prominent path from `/benchmark` to hiring the exact agent used in each task
- Testnet faucet link and a short "what you need before hiring" note
- The hire flow works without any prior setup — Passkey account provisioning is
  part of the flow, not a prerequisite

If a judge cannot get from the benchmark page to a hired agent in under five
minutes without asking us a question, the 20% marketplace-quality criterion is at
risk regardless of how good the numbers are.
