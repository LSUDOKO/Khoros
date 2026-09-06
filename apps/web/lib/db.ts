/**
 * Postgres access for the web app.
 *
 * The web app only ever READS precomputed models (docs/02-ARCHITECTURE.md).
 * The indexer is slow and batch-oriented; the arena must be fast, so nothing in
 * this path calls the chain or 8004scan. If the indexer is down, the arena
 * still renders from the last good rows with a staleness marker.
 */

import { Pool } from "pg";

import type {
  AgentCategory,
  AgentCategoryOrUncategorised,
  AgentRow,
  AgentSort,
  Protocol,
  TrustScore,
  PerformanceMetrics,
} from "@khoros/core";

let pool: Pool | undefined;

/** Lazily created so a missing DATABASE_URL does not crash at import time. */
export function getPool(): Pool | undefined {
  const url = process.env.DATABASE_URL;
  if (!url) return undefined;

  if (!pool) {
    pool = new Pool({
      connectionString: url,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      ssl: url.includes("localhost") ? undefined : { rejectUnauthorized: false },
    });
  }
  return pool;
}

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

/** A row of agent_rankings, as Postgres returns it. */
type RankingRow = {
  agent_id: string;
  name: string;
  description: string | null;
  image: string | null;
  category: string;
  owner: string;
  supported_trust: string[];
  protocols: string[];
  quality: number;
  maturity: number;
  demand_index: number;
  interval_low: number;
  interval_high: number;
  reviews_counted: number;
  reviews_discarded: number;
  discard_reasons: Record<string, number>;
  raw_average: number | null;
  raw_count: number | null;
  return_value: number | null;
  return_label: string | null;
  max_drawdown_bps: number | null;
  activity_30d: number | null;
  precision_bps: number | null;
  median_latency_ms: number | null;
  scale_usd: number | null;
  sample_size: number | null;
  sparkline: { t: number; v: number }[] | null;
  freshness: string;
};

function toTrustScore(r: RankingRow): TrustScore {
  const reasons = r.discard_reasons ?? {};
  return {
    quality: r.quality,
    maturity: r.maturity,
    demandIndex: r.demand_index,
    interval95: [r.interval_low, r.interval_high],
    reviewsCounted: r.reviews_counted,
    reviewsDiscarded: r.reviews_discarded,
    discardReasons: {
      circularCluster: reasons.circularCluster ?? 0,
      noPaymentEvidence: reasons.noPaymentEvidence ?? 0,
      reviewerTooNew: reasons.reviewerTooNew ?? 0,
      revoked: reasons.revoked ?? 0,
    },
    raw: { average: r.raw_average ?? 0, count: r.raw_count ?? 0 },
    computedAt: BigInt(r.freshness),
  };
}

/**
 * Performance for an agent with no rollup yet.
 *
 * Zeros here are honest: the row genuinely has no measured history, and
 * sampleSize 0 makes the UI render it as an empty state rather than as a
 * measured zero. We never invent a plausible-looking figure.
 */
function toPerformance(r: RankingRow): PerformanceMetrics {
  return {
    returnValue: r.return_value ?? 0,
    returnLabel: r.return_label ?? "",
    maxDrawdownBps: r.max_drawdown_bps ?? 0,
    activityCount30d: r.activity_30d ?? 0,
    precisionBps: r.precision_bps ?? 0,
    medianLatencyMs: r.median_latency_ms ?? 0,
    scaleUsd: r.scale_usd ?? 0,
    sparkline: (r.sparkline ?? []).map((p) => ({ t: BigInt(p.t), v: p.v })),
    window: "30d",
    sampleSize: r.sample_size ?? 0,
  };
}

function toAgentRow(r: RankingRow): AgentRow {
  return {
    agentId: BigInt(r.agent_id),
    name: r.name,
    category: r.category as AgentCategoryOrUncategorised,
    protocols: (r.protocols ?? []) as Protocol[],
    trust: toTrustScore(r),
    performance: toPerformance(r),
  };
}

const SORT_COLUMN: Record<AgentSort, string> = {
  demand: "demand_index",
  return: "return_value",
  latency: "median_latency_ms",
  scale: "scale_usd",
};

export type RankedQuery = {
  category?: AgentCategory;
  pruned?: boolean;
  sort?: AgentSort;
  limit?: number;
};

export type RankedResult = {
  agents: AgentRow[];
  freshness: bigint;
  /** True when no database is configured — the UI says so rather than faking rows. */
  unavailable: boolean;
};

/**
 * Read ranked agents from the materialised view.
 *
 * Sorting differs by prune state: pruned ranks on demand_index (the payment
 * weighted score), unfiltered ranks on the raw registry average. That
 * difference IS the demonstration — flipping the toggle visibly re-ranks.
 */
export async function getRankedAgents(
  q: RankedQuery = {},
): Promise<RankedResult> {
  const db = getPool();
  if (!db) return { agents: [], freshness: 0n, unavailable: true };

  const pruned = q.pruned ?? true;
  const limit = Math.min(q.limit ?? 25, 100);

  // Latency sorts ascending (faster is better); everything else descending.
  const sort = q.sort ?? "demand";
  const column = pruned ? SORT_COLUMN[sort] : "raw_average";
  const direction = sort === "latency" && pruned ? "asc" : "desc";

  const params: unknown[] = [];
  let where = "";
  if (q.category) {
    params.push(q.category);
    where = `where category = $${params.length}`;
  }
  params.push(limit);

  const sql = `
    select * from agent_rankings
    ${where}
    order by ${column} ${direction} nulls last, agent_id asc
    limit $${params.length}
  `;

  try {
    const { rows } = await db.query<RankingRow>(sql, params);
    const agents = rows.map(toAgentRow);
    const freshness = rows.reduce(
      (max, r) => (BigInt(r.freshness) > max ? BigInt(r.freshness) : max),
      0n,
    );
    return { agents, freshness, unavailable: false };
  } catch (error) {
    // A failed read must not blank the page. Surface it as unavailable so the
    // UI renders a designed error state rather than an empty success.
    console.error("[db] ranked agent query failed", error);
    return { agents: [], freshness: 0n, unavailable: true };
  }
}

/** Aggregate pruning counts across a category, for the toggle's copy. */
export async function getPruningSummary(
  category?: AgentCategory,
): Promise<{ counted: number; discarded: number; reasons: Record<string, number> }> {
  const db = getPool();
  if (!db) return { counted: 0, discarded: 0, reasons: {} };

  const params: unknown[] = [];
  let where = "";
  if (category) {
    params.push(category);
    where = `where category = $1`;
  }

  try {
    // Totals and the per-reason breakdown are computed separately. Doing both
    // in one query means joining each agent row against its reason keys, which
    // multiplies the row out and double-counts the totals.
    const totals = await db.query<{ counted: string; discarded: string }>(
      `select
         coalesce(sum(reviews_counted), 0)::text as counted,
         coalesce(sum(reviews_discarded), 0)::text as discarded
       from agent_rankings ${where}`,
      params,
    );

    const breakdown = await db.query<{ reason: string; total: string }>(
      `select e.key as reason, sum(e.value::numeric)::text as total
       from agent_rankings
       cross join lateral jsonb_each_text(discard_reasons) as e(key, value)
       ${where}
       group by e.key`,
      params,
    );

    const reasons: Record<string, number> = {};
    for (const r of breakdown.rows) reasons[r.reason] = Number(r.total);

    const row = totals.rows[0];
    if (!row) return { counted: 0, discarded: 0, reasons: {} };
    return {
      counted: Number(row.counted),
      discarded: Number(row.discarded),
      reasons,
    };
  } catch (error) {
    console.error("[db] pruning summary failed", error);
    return { counted: 0, discarded: 0, reasons: {} };
  }
}
