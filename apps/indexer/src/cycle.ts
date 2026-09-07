/**
 * The indexer cycle. From docs/02 and docs/10 phase 1.
 *
 *   ingest → classify → score → roll up → refresh the ranking view
 *
 * Everything the arena renders comes out of this. It is idempotent: every write
 * is an upsert keyed on chain identity, so replaying converges to the same rows
 * rather than duplicating them (docs/02: "any table must be reconstructible by
 * replaying the indexer from genesis").
 */

import type { Pool } from "pg";

import { aggregate, defaultScoringConfig } from "@khoros/scoring";
import type { EnrichedFeedback } from "@khoros/scoring";

import { classificationDistribution } from "./classify.js";
import {
  categoryDistribution,
  refreshRankings,
  upsertAgents,
  upsertPerformance,
  upsertScore,
} from "./persist.js";
import { buildSeedAgents, buildSeedPerformance } from "./seed.js";
import { createRegistryClient, readAgents, type IndexedAgent } from "./sources/registry.js";

export type CycleOptions = {
  pool: Pool;
  /** Read agent identity from BSC mainnet; execution stays on testnet. */
  chainId?: 56 | 97;
  rpcUrl?: string;
  /** How many registry ids to walk this cycle. */
  registryCount?: number;
  fromId?: bigint;
  /** Include the curated seed set, so no category arena is empty. */
  includeSeed?: boolean;
  now?: bigint;
};

export type CycleReport = {
  registryAgentsRead: number;
  seedAgentsWritten: number;
  agentsPersisted: number;
  scoresComputed: number;
  /** The distribution docs/10 asks to report — the quiet risk of this phase. */
  classification: Record<string, number>;
  categoriesInDatabase: Record<string, number>;
  durationMs: number;
};

/**
 * Read this agent's feedback for scoring.
 *
 * Reads from the `feedback` table, which the reputation ingest populates. An
 * agent with no feedback scores at the prior (0.5, demand index 0), which is
 * correct and is what the arena shows for a new agent.
 */
async function loadFeedback(pool: Pool, agentId: bigint): Promise<EnrichedFeedback[]> {
  const { rows } = await pool.query<{
    client_address: string;
    feedback_index: string;
    score: number;
    is_revoked: boolean;
    settled_payment_usd: string;
    settlement_job_id: string | null;
    match_confidence: number;
    reviewer_first_seen: string | null;
    reviewer_tx_count: string | null;
    cluster_correlation: number;
    created_at: string;
  }>(
    `select client_address, feedback_index, score, is_revoked,
            settled_payment_usd, settlement_job_id, match_confidence,
            reviewer_first_seen, reviewer_tx_count, cluster_correlation, created_at
     from feedback where agent_id = $1`,
    [agentId.toString()],
  );

  return rows.map((r) => {
    const createdAt = BigInt(r.created_at);
    const firstSeen = r.reviewer_first_seen ? BigInt(r.reviewer_first_seen) : createdAt;

    return {
      agentId,
      clientAddress: r.client_address,
      feedbackIndex: BigInt(r.feedback_index),
      score: r.score,
      isRevoked: r.is_revoked,
      settledPaymentUsd: Number(r.settled_payment_usd),
      settlementJobId: r.settlement_job_id ? BigInt(r.settlement_job_id) : undefined,
      matchConfidence: r.match_confidence,
      // Age at the time of the review, which is what the gate asks about.
      reviewerAgeSeconds: Number(createdAt - firstSeen),
      reviewerTxCount: r.reviewer_tx_count ? Number(r.reviewer_tx_count) : 0,
      clusterCorrelation: r.cluster_correlation,
      createdAt,
    };
  });
}

export async function runCycle(opts: CycleOptions): Promise<CycleReport> {
  const started = Date.now();
  const now = opts.now ?? BigInt(Math.floor(Date.now() / 1000));
  const chainId = opts.chainId ?? 56;
  const pool = opts.pool;

  const all: IndexedAgent[] = [];

  // --- 1. Ingest from the live ERC-8004 registry --------------------------

  let registryAgentsRead = 0;
  if ((opts.registryCount ?? 0) > 0) {
    try {
      const client = createRegistryClient(chainId, opts.rpcUrl);
      const agents = await readAgents(client, chainId, {
        fromId: opts.fromId ?? 1n,
        count: opts.registryCount ?? 0,
        concurrency: 6,
      });
      all.push(...agents);
      registryAgentsRead = agents.length;
    } catch (error) {
      // A registry outage must not abort the cycle: the seed set and existing
      // rows still serve. docs/02's failure posture — degrade toward doing
      // nothing, never toward acting without checks.
      console.warn("[cycle] registry ingest failed:", error);
    }
  }

  // --- 2. The curated seed set --------------------------------------------

  const seeds = opts.includeSeed === false ? [] : buildSeedAgents(now);
  all.push(...seeds);

  // --- 3. Persist ----------------------------------------------------------

  const agentsPersisted = await upsertAgents(pool, all, now);

  // Mark the curated ones so they can never pass as discovered.
  if (seeds.length > 0) {
    await pool.query(
      `update agents set seeded = true, seed_note = m.note
       from (values ${seeds
         .map((_, i) => `($${i * 2 + 1}::numeric, $${i * 2 + 2}::text)`)
         .join(",")}) as m(id, note)
       where agents.agent_id = m.id`,
      seeds.flatMap((s) => [s.agentId.toString(), s.seedNote]),
    );
  }

  // --- 4. Score ------------------------------------------------------------

  const cfg = defaultScoringConfig();
  let scoresComputed = 0;

  for (const agent of all) {
    const feedback = await loadFeedback(pool, agent.agentId);
    const score = aggregate(feedback, cfg, now);
    await upsertScore(pool, agent.agentId, score);
    scoresComputed += 1;

    // Persist each record's weight and discard reason, so the profile can show
    // why a review did or did not count.
    for (const w of score.weights) {
      await pool.query(
        `update feedback set weight = $3
         where agent_id = $1 and client_address = $2`,
        [agent.agentId.toString(), w.clientAddress, w.weight],
      );
    }
  }

  // --- 5. Performance rollups ---------------------------------------------

  for (const seed of seeds) {
    await upsertPerformance(pool, buildSeedPerformance(seed, now));
  }

  // --- 6. Refresh the ranking view ----------------------------------------

  await refreshRankings(pool);

  return {
    registryAgentsRead,
    seedAgentsWritten: seeds.length,
    agentsPersisted,
    scoresComputed,
    classification: classificationDistribution(all.map((a) => a.classification)),
    categoriesInDatabase: await categoryDistribution(pool),
    durationMs: Date.now() - started,
  };
}
