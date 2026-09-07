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
  Address,
  AgentCategory,
  AgentCategoryOrUncategorised,
  AgentRow,
  AgentSort,
  Protocol,
  TrustScore,
  Hash,
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

// ---------------------------------------------------------------------------
// Agent detail
// ---------------------------------------------------------------------------

/** Everything the profile page renders about one agent. */
export type AgentDetail = {
  agentId: bigint;
  name: string;
  description: string;
  image?: string;
  owner: Address;
  category: AgentCategoryOrUncategorised;
  protocols: Protocol[];
  supportedTrust: string[];
  trust: TrustScore;
  performance: PerformanceMetrics;
};

export async function getAgent(agentId: bigint): Promise<AgentDetail | undefined> {
  const db = getPool();
  if (!db) return undefined;

  try {
    const { rows } = await db.query<RankingRow>(
      `select * from agent_rankings where agent_id = $1`,
      [agentId.toString()],
    );
    const r = rows[0];
    if (!r) return undefined;

    return {
      agentId: BigInt(r.agent_id),
      name: r.name,
      description: r.description ?? "",
      image: r.image ?? undefined,
      owner: r.owner as Address,
      category: r.category as AgentCategoryOrUncategorised,
      protocols: (r.protocols ?? []) as Protocol[],
      supportedTrust: r.supported_trust ?? [],
      trust: toTrustScore(r),
      performance: toPerformance(r),
    };
  } catch (error) {
    console.error("[db] agent detail query failed", error);
    return undefined;
  }
}

/**
 * One review as the profile renders it.
 *
 * docs/04: "each review row shows the settled payment that backs it. Reviews
 * with no payment appear only in unfiltered mode, greyed, labelled 'no payment
 * recorded'."
 */
export type ReviewRow = {
  clientAddress: Address;
  score: number;
  settledPaymentUsd: number;
  settlementJobId?: bigint;
  weight: number;
  discardReason?: string;
  createdAt: bigint;
};

export async function getAgentReviews(
  agentId: bigint,
  opts: { pruned?: boolean; limit?: number } = {},
): Promise<ReviewRow[]> {
  const db = getPool();
  if (!db) return [];

  const pruned = opts.pruned ?? true;
  const limit = Math.min(opts.limit ?? 20, 100);

  try {
    const { rows } = await db.query<{
      client_address: string;
      score: number;
      settled_payment_usd: string;
      settlement_job_id: string | null;
      weight: number;
      discard_reason: string | null;
      created_at: string;
    }>(
      `select client_address, score, settled_payment_usd, settlement_job_id,
              weight, discard_reason, created_at
       from feedback
       where agent_id = $1 ${pruned ? "and weight > 0" : ""}
       order by weight desc, created_at desc
       limit $2`,
      [agentId.toString(), limit],
    );

    return rows.map((r) => ({
      clientAddress: r.client_address as Address,
      score: r.score,
      settledPaymentUsd: Number(r.settled_payment_usd),
      settlementJobId: r.settlement_job_id ? BigInt(r.settlement_job_id) : undefined,
      weight: r.weight,
      discardReason: r.discard_reason ?? undefined,
      createdAt: BigInt(r.created_at),
    }));
  } catch (error) {
    console.error("[db] reviews query failed", error);
    return [];
  }
}

/**
 * The intervention log — every action this agent has taken, with its tx.
 * Artifact 6 of the eleven, and required at equal depth for all four categories.
 */
export type InterventionRow = {
  kind: "executed" | "blocked" | "triggered";
  tx?: Hash;
  at: bigint;
  detail: string;
  latencyMs?: number;
};

export async function getAgentInterventions(
  agentId: bigint,
  limit = 20,
): Promise<InterventionRow[]> {
  const db = getPool();
  if (!db) return [];

  try {
    const { rows } = await db.query<{
      kind: string;
      payload: Record<string, unknown>;
      at: string;
    }>(
      `select t.kind, t.payload, t.at
       from telemetry t
       join engagements e on e.id = t.engagement_id
       where e.agent_id = $1
       order by t.at desc
       limit $2`,
      [agentId.toString(), limit],
    );

    return rows.map((r) => {
      const p = r.payload ?? {};
      const kind = r.kind as InterventionRow["kind"];
      const detail =
        kind === "blocked"
          ? `${String(p.reason ?? "Blocked")} — ${String(p.failedInvariant ?? "")}`
          : kind === "triggered"
            ? String(p.trigger ?? "Trigger observed")
            : String(p.summary ?? "Action executed");

      return {
        kind,
        tx: typeof p.tx === "string" ? (p.tx as Hash) : undefined,
        at: BigInt(r.at),
        detail,
        latencyMs: typeof p.latencyMs === "number" ? p.latencyMs : undefined,
      };
    });
  } catch (error) {
    console.error("[db] interventions query failed", error);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Engagements — the dashboard's read model
// ---------------------------------------------------------------------------

export type EngagementRow = {
  id: string;
  agentId: bigint;
  agentName: string;
  category: AgentCategoryOrUncategorised;
  sessionKey?: Address;
  sessionStatus?: string;
  grantTx?: Hash;
  revokeTx?: Hash;
  keystoreRegistered: boolean;
  expiry?: bigint;
  scope?: unknown;
  jobId?: bigint;
  status: string;
  createdAt: bigint;
};

export async function getEngagements(
  userAddress?: string,
): Promise<{ rows: EngagementRow[]; unavailable: boolean }> {
  const db = getPool();
  if (!db) return { rows: [], unavailable: true };

  const params: unknown[] = [];
  let where = "";
  if (userAddress) {
    params.push(userAddress.toLowerCase());
    where = "where lower(e.user_address) = $1";
  }

  try {
    const { rows } = await db.query<{
      id: string;
      agent_id: string;
      agent_name: string | null;
      category: string;
      session_key: string | null;
      session_status: string | null;
      grant_tx: string | null;
      revoke_tx: string | null;
      keystore_registered: boolean | null;
      expiry: string | null;
      scope: unknown;
      job_id: string | null;
      status: string;
      created_at: string;
    }>(
      `select e.id, e.agent_id, a.name as agent_name, e.category,
              e.session_key, s.status as session_status, s.grant_tx, s.revoke_tx,
              s.keystore_registered, s.expiry, s.scope,
              e.job_id, e.status, e.created_at
       from engagements e
       left join sessions s on s.session_key = e.session_key
       left join agents a on a.agent_id = e.agent_id
       ${where}
       order by e.created_at desc
       limit 50`,
      params,
    );

    return {
      unavailable: false,
      rows: rows.map((r) => ({
        id: r.id,
        agentId: BigInt(r.agent_id),
        agentName: r.agent_name ?? `Agent #${r.agent_id}`,
        category: r.category as AgentCategoryOrUncategorised,
        sessionKey: (r.session_key as Address) ?? undefined,
        sessionStatus: r.session_status ?? undefined,
        grantTx: (r.grant_tx as Hash) ?? undefined,
        revokeTx: (r.revoke_tx as Hash) ?? undefined,
        keystoreRegistered: r.keystore_registered ?? false,
        expiry: r.expiry ? BigInt(r.expiry) : undefined,
        scope: r.scope,
        jobId: r.job_id ? BigInt(r.job_id) : undefined,
        status: r.status,
        createdAt: BigInt(r.created_at),
      })),
    };
  } catch (error) {
    console.error("[db] engagements query failed", error);
    return { rows: [], unavailable: true };
  }
}

/** Telemetry for one engagement, newest first. */
export async function getEngagementTelemetry(
  engagementId: string,
  limit = 50,
): Promise<InterventionRow[]> {
  const db = getPool();
  if (!db) return [];

  try {
    const { rows } = await db.query<{
      kind: string;
      payload: Record<string, unknown>;
      at: string;
    }>(
      `select kind, payload, at from telemetry
       where engagement_id = $1 order by at desc limit $2`,
      [engagementId, limit],
    );

    return rows.map((r) => {
      const p = r.payload ?? {};
      const kind = r.kind as InterventionRow["kind"];
      return {
        kind,
        tx: typeof p.tx === "string" ? (p.tx as Hash) : undefined,
        at: BigInt(r.at),
        detail:
          kind === "blocked"
            ? `${String(p.reason ?? "Blocked")} — ${String(p.failedInvariant ?? "")}`
            : kind === "triggered"
              ? String(p.trigger ?? "Trigger observed")
              : String(p.summary ?? "Action executed"),
        latencyMs: typeof p.latencyMs === "number" ? p.latencyMs : undefined,
      };
    });
  } catch (error) {
    console.error("[db] telemetry query failed", error);
    return [];
  }
}
