/**
 * Persistence for the indexer cycle.
 *
 * docs/02: "On-chain is the source of truth ... Postgres is a derived,
 * rebuildable cache. Any table must be reconstructible by replaying the indexer
 * from genesis."
 *
 * Every write here is therefore an upsert keyed on chain identity, so a replay
 * converges to the same rows rather than duplicating them.
 */

import { Pool } from "pg";

import type { TrustScore } from "@khoros/core";

import type { IndexedAgent } from "./sources/registry.js";

export function createPool(databaseUrl: string): Pool {
  return new Pool({
    connectionString: databaseUrl,
    max: 8,
    ssl: databaseUrl.includes("localhost") ? undefined : { rejectUnauthorized: false },
  });
}

/** Upsert agents. Idempotent: replaying produces identical rows. */
export async function upsertAgents(
  pool: Pool,
  agents: IndexedAgent[],
  indexedAt: bigint,
): Promise<number> {
  if (agents.length === 0) return 0;

  const client = await pool.connect();
  try {
    await client.query("begin");

    for (const a of agents) {
      await client.query(
        `insert into agents (
           agent_id, registry, owner, name, description, image,
           registered_at, active, supported_trust, services, x402_support,
           category, category_confidence, protocols, indexed_at
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         on conflict (agent_id) do update set
           registry = excluded.registry,
           owner = excluded.owner,
           name = excluded.name,
           description = excluded.description,
           image = excluded.image,
           active = excluded.active,
           supported_trust = excluded.supported_trust,
           services = excluded.services,
           x402_support = excluded.x402_support,
           category = excluded.category,
           category_confidence = excluded.category_confidence,
           protocols = excluded.protocols,
           indexed_at = excluded.indexed_at`,
        [
          a.agentId.toString(),
          a.registry,
          a.owner,
          a.name,
          a.description,
          a.image ?? null,
          a.registeredAt.toString(),
          a.active,
          a.supportedTrust,
          JSON.stringify(a.services),
          a.x402Support,
          a.classification.category,
          a.classification.confidence,
          a.classification.protocols,
          indexedAt.toString(),
        ],
      );
    }

    await client.query("commit");
    return agents.length;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

/** Write a computed trust score. */
export async function upsertScore(
  pool: Pool,
  agentId: bigint,
  score: TrustScore,
): Promise<void> {
  await pool.query(
    `insert into agent_scores (
       agent_id, quality, maturity, demand_index, interval_low, interval_high,
       reviews_counted, reviews_discarded, discard_reasons,
       raw_average, raw_count, computed_at
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     on conflict (agent_id) do update set
       quality = excluded.quality,
       maturity = excluded.maturity,
       demand_index = excluded.demand_index,
       interval_low = excluded.interval_low,
       interval_high = excluded.interval_high,
       reviews_counted = excluded.reviews_counted,
       reviews_discarded = excluded.reviews_discarded,
       discard_reasons = excluded.discard_reasons,
       raw_average = excluded.raw_average,
       raw_count = excluded.raw_count,
       computed_at = excluded.computed_at`,
    [
      agentId.toString(),
      score.quality,
      score.maturity,
      score.demandIndex,
      score.interval95[0],
      score.interval95[1],
      score.reviewsCounted,
      score.reviewsDiscarded,
      JSON.stringify(score.discardReasons),
      score.raw.average,
      score.raw.count,
      score.computedAt.toString(),
    ],
  );
}

export type PerformanceRow = {
  agentId: bigint;
  window: "7d" | "30d" | "90d";
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
};

export async function upsertPerformance(
  pool: Pool,
  row: PerformanceRow,
): Promise<void> {
  await pool.query(
    `insert into performance (
       agent_id, window_label, return_value, return_label, max_drawdown_bps,
       activity_30d, precision_bps, median_latency_ms, scale_usd,
       sample_size, sparkline, computed_at
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     on conflict (agent_id, window_label) do update set
       return_value = excluded.return_value,
       return_label = excluded.return_label,
       max_drawdown_bps = excluded.max_drawdown_bps,
       activity_30d = excluded.activity_30d,
       precision_bps = excluded.precision_bps,
       median_latency_ms = excluded.median_latency_ms,
       scale_usd = excluded.scale_usd,
       sample_size = excluded.sample_size,
       sparkline = excluded.sparkline,
       computed_at = excluded.computed_at`,
    [
      row.agentId.toString(),
      row.window,
      row.returnValue,
      row.returnLabel,
      row.maxDrawdownBps,
      row.activityCount30d,
      row.precisionBps,
      row.medianLatencyMs,
      row.scaleUsd,
      row.sampleSize,
      JSON.stringify(row.sparkline),
      row.computedAt.toString(),
    ],
  );
}

/**
 * Refresh the ranking view.
 *
 * Concurrent so the arena keeps serving during a cycle. This requires the
 * unique index that docs/07 omits — without it Postgres refuses outright.
 */
export async function refreshRankings(pool: Pool): Promise<void> {
  await pool.query("refresh materialized view concurrently agent_rankings");
}

/** Classification distribution, for the report docs/10 asks for. */
export async function categoryDistribution(
  pool: Pool,
): Promise<Record<string, number>> {
  const { rows } = await pool.query<{ category: string; n: string }>(
    "select category, count(*)::text as n from agents group by category order by n desc",
  );
  const out: Record<string, number> = {};
  for (const r of rows) out[r.category] = Number(r.n);
  return out;
}
