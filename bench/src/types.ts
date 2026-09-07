/**
 * Benchmark run records. From docs/09-BENCHMARK_HARNESS.md.
 *
 * The honesty section of that document is the most important part of it, and it
 * shapes these types:
 *
 *   - every number comes from a run that actually happened, with a tx hash
 *   - the manual branch is a real human with a timer running, not an estimate
 *   - single observations are labelled as such; averages state n
 *   - where the manual operator was familiar with the interface, the page says
 *     so, because that makes the comparison conservative
 *
 * `operator` and `notes` are REQUIRED rather than optional. A run record that
 * cannot say who ran the manual branch is not usable evidence, and making the
 * field optional would let one be written without noticing.
 */

export type Hash = `0x${string}`;

export type BenchmarkTask =
  | "lp-range-recovery"
  | "venus-liquidation-defense"
  | "yield-migration";

export type TaskDomain = "trading" | "security" | "yield";

export const TASK_DOMAIN: Record<BenchmarkTask, TaskDomain> = {
  "lp-range-recovery": "trading",
  "venus-liquidation-defense": "security",
  "yield-migration": "yield",
};

export const TASK_TITLE: Record<BenchmarkTask, string> = {
  "lp-range-recovery": "PancakeSwap V3 range recovery",
  "venus-liquidation-defense": "Venus liquidation defense",
  "yield-migration": "Cross-protocol yield migration",
};

export type BranchTransaction = {
  hash: Hash;
  gasUsed: string; // decimal string — JSON has no bigint
  gasPriceWei: string;
  step: string;
};

export type BranchResult = {
  elapsedMs: number;
  transactions: BranchTransaction[];
  gasCostUsd: number;
  /** Fees forgone, yield forgone, penalty paid. */
  opportunityCostUsd: number;
  totalCostUsd: number;
  /** Task-specific end state. */
  outcome: Record<string, unknown>;
  /** Paths to recordings and state dumps, relative to the run directory. */
  artifacts: string[];
};

export type BenchmarkRun = {
  runId: string;
  task: BenchmarkTask;
  startedAt: number;
  chain: 97;
  manual: BranchResult;
  agent: BranchResult;
  /** Conditions, anomalies, anything a reader should know. */
  notes: string;
  /** Who ran the manual branch and how familiar they were with the interface. */
  operator: string;
};

/**
 * A task's runs, summarised for display.
 *
 * `sampleSize` is carried explicitly and rendered everywhere, so a single
 * observation can never be presented with the authority of an average.
 */
export type TaskSummary = {
  task: BenchmarkTask;
  runs: BenchmarkRun[];
  sampleSize: number;
  medianManualMs: number;
  medianAgentMs: number;
  medianManualCostUsd: number;
  medianAgentCostUsd: number;
};

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
    : (sorted[mid] ?? 0);
}

/** Median rather than mean: with n of 2 or 3, one outlier would dominate a mean. */
export function summarise(task: BenchmarkTask, runs: BenchmarkRun[]): TaskSummary {
  const mine = runs.filter((r) => r.task === task);
  return {
    task,
    runs: mine,
    sampleSize: mine.length,
    medianManualMs: median(mine.map((r) => r.manual.elapsedMs)),
    medianAgentMs: median(mine.map((r) => r.agent.elapsedMs)),
    medianManualCostUsd: median(mine.map((r) => r.manual.totalCostUsd)),
    medianAgentCostUsd: median(mine.map((r) => r.agent.totalCostUsd)),
  };
}

/**
 * Validate a run record before it is allowed near the report surface.
 *
 * Returns the problems rather than throwing, so the page can render "this run
 * is incomplete" instead of crashing or, worse, quietly displaying a partial
 * record as if it were whole.
 */
export function validateRun(run: BenchmarkRun): string[] {
  const problems: string[] = [];

  if (run.chain !== 97) {
    problems.push("Run is not on BSC Testnet (chain 97).");
  }
  if (run.operator.trim().length === 0) {
    problems.push(
      "No operator recorded. Who ran the manual branch, and how familiar were they?",
    );
  }
  // Every figure must trace to a real transaction (CLAUDE.md rule 5).
  if (run.agent.transactions.length === 0) {
    problems.push("The agent branch has no transaction hashes.");
  }
  if (run.manual.transactions.length === 0) {
    problems.push("The manual branch has no transaction hashes.");
  }
  if (run.manual.elapsedMs <= 0 || run.agent.elapsedMs <= 0) {
    problems.push("A branch has no recorded elapsed time.");
  }

  return problems;
}
