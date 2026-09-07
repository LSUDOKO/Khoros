#!/usr/bin/env node
/**
 * The manual-branch recorder. From docs/09-BENCHMARK_HARNESS.md.
 *
 * "A small CLI the human operator runs. It starts a monotonic clock on the
 * alert, prompts for each step boundary, captures transaction hashes as they
 * land, and writes the branch result — explicitly to remove the temptation to
 * reconstruct timings from memory afterwards."
 *
 * That last clause is the whole point. A timing typed in after the fact is an
 * estimate wearing a measurement's clothes, and the TermiX judges will compare
 * our numbers against their own runs.
 *
 * Uses process.hrtime.bigint() — a monotonic clock, so an NTP correction
 * mid-run cannot silently change a recorded duration.
 *
 * Run:  pnpm bench manual --task lp-range-recovery
 */

import { createInterface } from "node:readline/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { stdin, stdout } from "node:process";

const TASKS = {
  "lp-range-recovery": [
    "you have opened the PancakeSwap interface",
    "you have connected your wallet",
    "you have read the price and decided the new range",
    "you have signed decreaseLiquidity",
    "you have signed collect",
    "you have signed the inventory swap",
    "you have signed mint for the new position",
  ],
  "venus-liquidation-defense": [
    "you have opened the Venus interface",
    "you have connected your wallet",
    "you have checked the position",
    "you have signed the token approval",
    "you have signed the collateral supply",
    "the health factor is restored",
  ],
  "yield-migration": [
    "you noticed the yield divergence",
    "you have evaluated the destination",
    "you have signed the withdrawal from the source",
    "you have signed the deposit into the destination",
  ],
};

function parseArgs(argv) {
  const args = { task: undefined };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--task") args.task = argv[i + 1];
  }
  return args;
}

function fmt(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

async function main() {
  const { task } = parseArgs(process.argv.slice(2));

  if (!task || !TASKS[task]) {
    stdout.write(
      `Usage: pnpm bench manual --task <${Object.keys(TASKS).join("|")}>\n`,
    );
    process.exit(1);
  }

  const rl = createInterface({ input: stdin, output: stdout });

  stdout.write(`\nManual branch recorder — ${task}\n`);
  stdout.write(`${"=".repeat(60)}\n\n`);

  // The operator is required, not optional. A run that cannot say who ran it
  // and how familiar they were is not usable evidence.
  const operator = await rl.question(
    "Who is running this branch, and how familiar are you with the interface?\n> ",
  );
  if (operator.trim().length === 0) {
    stdout.write("\nAn operator is required. Aborting rather than recording an anonymous run.\n");
    rl.close();
    process.exit(1);
  }

  stdout.write("\nPress enter the moment the alert arrives to start the clock.\n");
  await rl.question("> ");

  // Monotonic. Wall-clock is recorded separately, for the record only.
  const t0 = process.hrtime.bigint();
  const startedAt = Date.now();
  stdout.write(`\nClock started at ${new Date(startedAt).toISOString()}\n\n`);

  const steps = [];
  const transactions = [];

  for (const prompt of TASKS[task]) {
    await rl.question(`  [enter] when ${prompt}\n`);
    const elapsed = Number((process.hrtime.bigint() - t0) / 1_000_000n);
    steps.push({ step: prompt, atMs: elapsed });
    stdout.write(`      recorded at ${fmt(elapsed)}\n`);

    // Capture hashes as they land, not from memory at the end.
    const hash = await rl.question(
      "      transaction hash for this step (blank if none): ",
    );
    if (hash.trim().startsWith("0x")) {
      const gasUsed = await rl.question("      gas used: ");
      const gasPriceWei = await rl.question("      gas price in wei: ");
      transactions.push({
        hash: hash.trim(),
        gasUsed: gasUsed.trim() || "0",
        gasPriceWei: gasPriceWei.trim() || "0",
        step: prompt,
      });
    }
    stdout.write("\n");
  }

  const elapsedMs = Number((process.hrtime.bigint() - t0) / 1_000_000n);

  stdout.write(`Elapsed ${fmt(elapsedMs)}. ${transactions.length} transactions.\n\n`);

  const gasCostUsd = Number(
    (await rl.question("Total gas cost in USD for this branch: ")) || "0",
  );
  const opportunityCostUsd = Number(
    (await rl.question(
      "Opportunity cost in USD (fees forgone, yield forgone, penalty paid): ",
    )) || "0",
  );
  const notes = await rl.question(
    "Notes — conditions, anomalies, anything a reader should know:\n> ",
  );

  rl.close();

  const runId = `${task}-${new Date(startedAt).toISOString().replace(/[:.]/g, "-")}`;
  const dir = new URL(`../runs/${runId}/`, import.meta.url);
  await mkdir(dir, { recursive: true });

  const branch = {
    elapsedMs,
    transactions,
    gasCostUsd,
    opportunityCostUsd,
    totalCostUsd: gasCostUsd + opportunityCostUsd,
    outcome: { steps },
    artifacts: [],
  };

  await writeFile(
    new URL("manual.json", dir),
    `${JSON.stringify({ runId, task, startedAt, chain: 97, operator, notes, manual: branch }, null, 2)}\n`,
  );

  stdout.write(`\nWritten to bench/runs/${runId}/manual.json\n`);
  stdout.write(
    "Record the agent branch separately, then merge the two into run.json.\n",
  );
  stdout.write(
    "\nAttach your screen recording to the run directory — docs/09 requires the\n" +
      "manual branch to be a real recorded run, not a reconstruction.\n",
  );
}

main().catch((error) => {
  stdout.write(`\nRecorder failed: ${error?.stack ?? error}\n`);
  process.exit(1);
});
