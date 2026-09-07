#!/usr/bin/env node
/**
 * Run one indexer cycle.
 *
 * Usage:
 *   pnpm cycle                 # seed set only, no registry walk
 *   pnpm cycle --registry 60   # also walk 60 live ERC-8004 ids
 */

import { createPool } from "./persist.js";
import { runCycle } from "./cycle.js";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const url = process.env.DATABASE_URL;
if (!url) {
  process.stdout.write("DATABASE_URL is not set.\n");
  process.exit(1);
}

const pool = createPool(url);

const report = await runCycle({
  pool,
  chainId: 56,
  rpcUrl: process.env.BSC_MAINNET_RPC,
  registryCount: Number(flag("registry", 0)),
  fromId: BigInt(flag("from", 1)),
  includeSeed: flag("no-seed", null) === null,
});

process.stdout.write("\nIndexer cycle complete\n");
process.stdout.write(`${"=".repeat(52)}\n`);
process.stdout.write(`  registry agents read   ${report.registryAgentsRead}\n`);
process.stdout.write(`  curated agents written ${report.seedAgentsWritten}\n`);
process.stdout.write(`  agents persisted       ${report.agentsPersisted}\n`);
process.stdout.write(`  scores computed        ${report.scoresComputed}\n`);
process.stdout.write(`  duration               ${report.durationMs}ms\n`);
process.stdout.write(`\n  classification this cycle:\n`);
for (const [k, v] of Object.entries(report.classification)) {
  process.stdout.write(`    ${k.padEnd(22)} ${v}\n`);
}
process.stdout.write(`\n  categories in database:\n`);
for (const [k, v] of Object.entries(report.categoriesInDatabase)) {
  process.stdout.write(`    ${k.padEnd(22)} ${v}\n`);
}

await pool.end();
