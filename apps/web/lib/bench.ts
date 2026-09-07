/**
 * Load committed benchmark run records.
 *
 * docs/09: "Runs are committed so a judge reads the raw record, not just the
 * rendered summary." This reads them from bench/runs/ at build time.
 *
 * There is deliberately no fallback, no sample data, and no seeded example. If
 * the directory is empty the page renders an empty state saying so, because a
 * placeholder figure on this page would be exactly the fabrication CLAUDE.md
 * rule 5 forbids.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import type { BenchmarkRun } from "@khoros/bench";
import { validateRun } from "@khoros/bench";

const RUNS_DIR = join(process.cwd(), "..", "..", "bench", "runs");

function isBenchmarkRun(value: unknown): value is BenchmarkRun {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.runId === "string" &&
    typeof v.task === "string" &&
    typeof v.operator === "string" &&
    typeof v.manual === "object" &&
    typeof v.agent === "object"
  );
}

export async function loadRuns(): Promise<BenchmarkRun[]> {
  let entries: string[];
  try {
    entries = await readdir(RUNS_DIR);
  } catch {
    // No runs directory yet. Empty, not an error.
    return [];
  }

  const runs: BenchmarkRun[] = [];

  for (const entry of entries) {
    try {
      const raw = await readFile(join(RUNS_DIR, entry, "run.json"), "utf8");
      const parsed: unknown = JSON.parse(raw);

      if (!isBenchmarkRun(parsed)) {
        console.warn(`[bench] ${entry}/run.json is not a complete run record; skipping`);
        continue;
      }

      // An incomplete record must not reach the report surface. Better to omit
      // a run than to render a partial one as though it were whole.
      const problems = validateRun(parsed);
      if (problems.length > 0) {
        console.warn(`[bench] ${entry} skipped: ${problems.join(" ")}`);
        continue;
      }

      runs.push(parsed);
    } catch {
      // A directory without a complete run.json is a run in progress.
      continue;
    }
  }

  return runs.sort((a, b) => a.startedAt - b.startedAt);
}
