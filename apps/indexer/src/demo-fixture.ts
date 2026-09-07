/**
 * A demonstration fixture for the prune toggle.
 *
 * WHAT THIS IS AND IS NOT.
 *
 * This writes SYNTHETIC feedback records so the arena has something to re-rank,
 * making the product's central claim visible: a wash-rated agent outranks an
 * honest one on raw registry averages, and the order reverses under pruning.
 *
 * Every agent it creates is marked `seeded` and carries a seed_note saying it
 * is a demonstration fixture, so it renders with the "Curated listing" tag and
 * cannot be mistaken for a real on-chain agent. The reviews are equally
 * synthetic — that is the point, since the fixture exists to show what the
 * pruning does to a KNOWN input, exactly like the synthetic Sybil fixture in
 * the scoring test suite that docs/04 prescribes.
 *
 * It is NOT loaded by default. `pnpm cycle` does not call it; it runs only via
 * `pnpm demo-fixture`, and the README says what it is. No performance figure,
 * ROI or transaction hash is invented anywhere — only reviews, which are the
 * one input whose handling this fixture exists to demonstrate.
 */

import type { Pool } from "pg";

import type { AgentCategory } from "@khoros/core";

const FIXTURE_ID_BASE = 950_000_000n;

type FixtureAgent = {
  agentId: bigint;
  name: string;
  category: AgentCategory;
  note: string;
  reviewGroups: ReviewGroup[];
};

type ReviewGroup = {
  /** Distinct reviewer addresses. */
  count: number;
  score: number;
  /** USD settled behind each review. Zero means unpaid. */
  settledPaymentUsd: number;
  /** How circular the reviewer cluster is, 0-1. */
  clusterCorrelation: number;
  /** Seconds the reviewer address existed before reviewing. */
  reviewerAgeSeconds: number;
};

/**
 * Two agents per category, built to invert under pruning.
 *
 * The "honest" agent has few reviews, all backed by real settled payments from
 * established addresses. The "wash-rated" one has many perfect reviews from a
 * tight cluster of new addresses with nothing paid. Raw averages favour the
 * second; the pruned demand index favours the first.
 */
export function fixtureAgents(): FixtureAgent[] {
  const specs: {
    category: AgentCategory;
    honest: string;
    wash: string;
  }[] = [
    { category: "rebalancing", honest: "Tessitura Range", wash: "AlphaMax LP Pro" },
    { category: "grid-trading", honest: "Ostinato Grid", wash: "GridKing 9000" },
    { category: "yield-optimisation", honest: "Continuo Yield", wash: "YieldBeast Turbo" },
    { category: "health-factor", honest: "Ripieno Guard", wash: "SafeVault Ultra" },
  ];

  const agents: FixtureAgent[] = [];
  let i = 0n;

  for (const spec of specs) {
    agents.push({
      agentId: FIXTURE_ID_BASE + i++,
      name: spec.honest,
      category: spec.category,
      note:
        "Demonstration fixture. Its reviews are synthetic, written to show what " +
        "the pruning does to a known input — this one is backed by settled payments.",
      reviewGroups: [
        {
          count: 9,
          score: 0.88,
          settledPaymentUsd: 240,
          clusterCorrelation: 0.05,
          reviewerAgeSeconds: 90 * 86_400,
        },
      ],
    });

    agents.push({
      agentId: FIXTURE_ID_BASE + i++,
      name: spec.wash,
      category: spec.category,
      note:
        "Demonstration fixture. Its reviews are synthetic and fall into three " +
        "groups the pruning rejects for three different reasons, so the discard " +
        "breakdown shows each one rather than only whichever takes precedence.",
      // Three groups, one per discard reason. The weight function applies a
      // fixed precedence (revoked > tooNew > noPayment > cluster), so a single
      // uniform group would only ever demonstrate the first reason it hits.
      reviewGroups: [
        {
          // Circular ring: established addresses that DID pay, so only the
          // cluster signal can reject them.
          count: 22,
          score: 1,
          settledPaymentUsd: 60,
          clusterCorrelation: 1,
          reviewerAgeSeconds: 120 * 86_400,
        },
        {
          // Nothing paid, but old enough and not clustered.
          count: 14,
          score: 1,
          settledPaymentUsd: 0,
          clusterCorrelation: 0.1,
          reviewerAgeSeconds: 120 * 86_400,
        },
        {
          // Addresses created to review.
          count: 10,
          score: 1,
          settledPaymentUsd: 40,
          clusterCorrelation: 0.1,
          reviewerAgeSeconds: 2 * 86_400,
        },
      ],
    });
  }

  return agents;
}

export async function loadFixture(pool: Pool, now: bigint): Promise<number> {
  const agents = fixtureAgents();
  const client = await pool.connect();

  try {
    await client.query("begin");

    for (const a of agents) {
      await client.query(
        `insert into agents (
           agent_id, registry, owner, name, description, registered_at, active,
           supported_trust, services, x402_support, category, category_confidence,
           protocols, indexed_at, seeded, seed_note
         ) values ($1,'khoros:fixture',$2,$3,$4,$5,true,'{reputation}','[]',false,$6,1,'{}',$5,true,$7)
         on conflict (agent_id) do update set
           name = excluded.name,
           category = excluded.category,
           seeded = true,
           seed_note = excluded.seed_note`,
        [
          a.agentId.toString(),
          "0x7A6fd27153400fA405391e8B05033928CA997A9c",
          a.name,
          `A demonstration listing used to show how review pruning changes a ranking.`,
          now.toString(),
          a.category,
          a.note,
        ],
      );

      // Clear any previous fixture reviews so a reload is idempotent.
      await client.query("delete from feedback where agent_id = $1", [
        a.agentId.toString(),
      ]);

      let n = 0;
      for (const group of a.reviewGroups) {
        for (let k = 0; k < group.count; k++, n++) {
        await client.query(
          `insert into feedback (
             agent_id, client_address, feedback_index, score, value_decimals,
             is_revoked, settled_payment_usd, match_confidence,
             reviewer_first_seen, reviewer_tx_count, cluster_correlation,
             weight, created_at
           ) values ($1,$2,$3,$4,0,false,$5,1,$6,50,$7,0,$8)
           on conflict (agent_id, client_address, feedback_index) do nothing`,
          [
            a.agentId.toString(),
            `0xfixture${a.agentId.toString().slice(-4)}${n.toString().padStart(4, "0")}`,
            n,
            group.score,
            group.settledPaymentUsd,
            (now - BigInt(group.reviewerAgeSeconds)).toString(),
            group.clusterCorrelation,
            now.toString(),
          ],
        );
        }
      }
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
