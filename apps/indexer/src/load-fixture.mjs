#!/usr/bin/env node
/**
 * Load the demonstration fixture, then rescore and refresh.
 * See src/demo-fixture.ts for what this is and is not.
 */
import { createPool, refreshRankings, upsertScore, upsertPerformance } from "./persist.js";
import { loadFixture, fixtureAgents } from "./demo-fixture.js";
import { aggregate, defaultScoringConfig } from "@khoros/scoring";
import { CATEGORY_DEFINITIONS } from "@khoros/core";

const url = process.env.DATABASE_URL;
if (!url) { process.stdout.write("DATABASE_URL is not set.\n"); process.exit(1); }

const pool = createPool(url);
const now = BigInt(Math.floor(Date.now() / 1000));
const n = await loadFixture(pool, now);
process.stdout.write(`Loaded ${n} demonstration agents with synthetic reviews.\n\n`);

const cfg = defaultScoringConfig();
for (const a of fixtureAgents()) {
  const { rows } = await pool.query(
    `select client_address, feedback_index, score, is_revoked, settled_payment_usd,
            reviewer_first_seen, cluster_correlation, created_at
     from feedback where agent_id = $1`, [a.agentId.toString()]);

  const feedback = rows.map(r => ({
    agentId: a.agentId,
    clientAddress: r.client_address,
    feedbackIndex: BigInt(r.feedback_index),
    score: r.score,
    isRevoked: r.is_revoked,
    settledPaymentUsd: Number(r.settled_payment_usd),
    matchConfidence: 1,
    reviewerAgeSeconds: Number(BigInt(r.created_at) - BigInt(r.reviewer_first_seen)),
    reviewerTxCount: 50,
    clusterCorrelation: r.cluster_correlation,
    createdAt: BigInt(r.created_at),
  }));

  const score = aggregate(feedback, cfg, now);
  await upsertScore(pool, a.agentId, score);
  for (const w of score.weights) {
    await pool.query(`update feedback set weight=$3 where agent_id=$1 and client_address=$2`,
      [a.agentId.toString(), w.clientAddress, w.weight]);
  }
  await upsertPerformance(pool, {
    agentId: a.agentId, window: "30d", returnValue: 0,
    returnLabel: CATEGORY_DEFINITIONS[a.category].metrics.return,
    maxDrawdownBps: 0, activityCount30d: 0, precisionBps: 0, medianLatencyMs: 0,
    scaleUsd: 0, sampleSize: 0, sparkline: [], computedAt: now,
  });

  process.stdout.write(
    `  ${a.name.padEnd(20)} raw=${score.raw.average.toFixed(2)} (n=${score.raw.count})  ` +
    `pruned demand=${score.demandIndex.toFixed(4)}  counted=${score.reviewsCounted} discarded=${score.reviewsDiscarded}\n`);
}

await refreshRankings(pool);
process.stdout.write("\nRankings refreshed.\n");
await pool.end();
