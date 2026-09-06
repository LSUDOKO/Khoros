# 04 — Trust Scoring and Sybil Pruning

## Why this exists

ERC-8004's Reputation Registry is permissionless. Anyone can write feedback about
any agent. Empirical study of the deployed ecosystem found that a majority of
reviewers across Ethereum, BSC, and Base participate in coordinated clusters —
on BSC specifically, roughly 59% of reviewers exhibit circular rating behaviour
where addresses rate each other's agents without any economic transaction
underneath.

A marketplace that renders `getSummary()` and calls it a rating is showing users a
number that a determined attacker produced for the cost of gas. This is the single
most common failure mode in agent directories and the easiest place for Khoros to
be visibly better.

**The principle:** a review is worth what the reviewer paid. Feedback backed by a
settled ERC-8183 job or x402 payment carries weight proportional to the money that
moved. Feedback with no economic footprint carries almost none.

---

## The pipeline

```
ERC-8004 Reputation Registry
  readAllFeedback(agentId)            → raw feedback records
         │
         v
  ┌──────────────────────────────────┐
  │ 1. Enrich                        │  attach settlement evidence
  │    match feedback → ERC-8183 job │  and reviewer history
  │    match feedback → x402 receipt │
  │    fetch reviewer first-seen     │
  └──────────────┬───────────────────┘
                 v
  ┌──────────────────────────────────┐
  │ 2. Cluster                       │  build reviewer↔agent bipartite graph
  │    detect circular components    │  score each reviewer's cluster
  │    compute ClusterCorrelation    │  correlation 0..1
  └──────────────┬───────────────────┘
                 v
  ┌──────────────────────────────────┐
  │ 3. Weight                        │  w_i per feedback record
  └──────────────┬───────────────────┘
                 v
  ┌──────────────────────────────────┐
  │ 4. Aggregate                     │  Beta posterior → F_a
  │                                  │  weight mass    → M_a
  │                                  │  demand index   → v(F,M)
  └──────────────┬───────────────────┘
                 v
        agent_scores table → arena ranking
```

---

## Step 1 — Enrichment

For each feedback record, gather:

| Field | Source | Use |
|-------|--------|-----|
| `settledPaymentUsd` | ERC-8183 job settlement matching (client, provider, window) or x402 receipt | Primary weight driver |
| `reviewerFirstSeen` | First outbound tx of the reviewer address | Age gate |
| `reviewerTxCount` | Address nonce | Secondary liveness signal |
| `reviewerDistinctAgents` | Reputation registry | Cluster input |
| `isRevoked` | Registry flag | Excluded entirely |

Matching feedback to settlement is heuristic — the registry does not carry a job
id. Match on (client address, agent id, timestamp within the job's settlement
window). Record the match confidence and treat unmatched feedback as
`settledPaymentUsd = 0` rather than guessing.

---

## Step 2 — Cluster detection

Build a bipartite graph of reviewers and agents. A reviewer sits in a suspicious
cluster when the subgraph reachable from them is small, densely connected, and has
little economic flow crossing its boundary.

`ClusterCorrelation` $\in [0,1]$ combines three signals:

1. **Reciprocity** — the reviewer's agents are reviewed by addresses that this
   reviewer's owner also controls or reviews. Circular rating rings score high.
2. **Temporal coincidence** — reviews clustered in tight time windows, often within
   the same block or a handful of blocks.
3. **Funding provenance** — reviewer addresses funded from a common source within a
   short window before reviewing.

Implement as connected-component analysis with a per-component density score, then
assign each reviewer their component's score. Cache per indexer cycle; this is the
expensive step.

```ts
type ClusterSignals = {
  reciprocity: number;      // 0-1
  temporalCoincidence: number;
  fundingProvenance: number;
};

function clusterCorrelation(s: ClusterSignals): number {
  // weighted, capped at 1
  return Math.min(1, 0.45 * s.reciprocity
                   + 0.35 * s.temporalCoincidence
                   + 0.20 * s.fundingProvenance);
}
```

---

## Step 3 — Weighting

Each feedback record $f_i$ from client $c_i$ receives:

$$w_i = \ln\!\big(1 + \text{SettledPaymentUSD}(f_i)\big)\ \cdot\ \mathbb{I}\big(\text{ClientAge}(c_i) > \tau\big)\ \cdot\ \big(1 - \text{ClusterCorrelation}(c_i)\big)$$

Reading the three factors:

**Logarithmic payment term.** A review backed by \$500 counts more than one backed
by \$5, but not a hundred times more. Log damping stops a single whale review from
dominating and stops payment-size gaming from being efficient. A review with no
settlement gets $\ln(1) = 0$ and drops out entirely.

**Age gate.** $\tau$ defaults to 7 days from the reviewer's first on-chain activity.
Addresses created to review are excluded. This is a hard indicator, not a taper,
because the failure mode it blocks is cheap and high volume.

**Cluster complement.** A reviewer fully inside a circular ring contributes nothing;
an independent reviewer contributes fully.

```ts
export function feedbackWeight(f: EnrichedFeedback, cfg: ScoringConfig): number {
  if (f.isRevoked) return 0;

  const ageOk = f.reviewerAgeSeconds > cfg.minReviewerAgeSeconds;
  if (!ageOk) return 0;

  const payment = Math.log1p(f.settledPaymentUsd);
  if (payment === 0) return 0;

  return payment * (1 - f.clusterCorrelation);
}
```

---

## Step 4 — Aggregation

### Quality — Beta posterior

Weighted Beta reputation with a uniform prior, so an agent with no history sits at
0.5 rather than at 0 or 1:

$$\alpha_a = 1 + \sum_{i \in \mathcal{F}_{\text{pos}}} w_i s_i,\qquad
\beta_a = 1 + \sum_{j \in \mathcal{F}_{\text{neg}}} w_j (1 - s_j)$$

$$F_a = \frac{\alpha_a}{\alpha_a + \beta_a}$$

$s_i \in [0,1]$ is the registry score normalised by its `valueDecimals`. Positive
and negative split at 0.5.

### Maturity — accumulated economic weight

$$M_a = \sum_{i=1}^{n} w_i$$

Maturity is how much verified economic history stands behind the quality estimate.
An agent at $F_a = 0.95$ with $M_a = 0.8$ has one small settled job. An agent at
$F_a = 0.88$ with $M_a = 240$ has a track record. The second is the safer hire and
the ranking must reflect that.

### Demand index — the ranking value

$$v(F_a, M_a) = F_a \cdot \big(1 - e^{-\lambda M_a}\big)$$

The exponential term saturates: early history moves the ranking a lot, and past a
point more history barely helps, which stops incumbents from being unassailable.
Default $\lambda = 0.05$, tuned so $M_a \approx 60$ reaches ~95% of the ceiling.

### Confidence interval

Report the Beta posterior interval so the UI can show uncertainty honestly:

$$\text{CI}_{95} = \text{BetaInv}(0.025,\ \alpha_a,\ \beta_a),\ \text{BetaInv}(0.975,\ \alpha_a,\ \beta_a)$$

A wide interval renders as a wide band on the trust score. New agents look
uncertain because they *are* uncertain, and that is useful information.

---

## What the UI shows

The arena defaults to ranking by $v(F_a, M_a)$.

The **prune toggle** switches between:

- **Verified** (default) — pruned scores, and a line stating how many reviews were
  discarded: *"Ranking uses 214 payment-backed reviews. term1,891 reviews were
  discarded: 1,204 from circular rating clusters, 687 with no payment behind them."*
- **Unfiltered** — raw registry averages, with a warning that these are
  unauthenticated and the ranking will differ.

Watching the ranking reorder when the toggle flips is the demonstration. Make that
transition legible — animate the reorder so a judge sees which agents fall.

On the agent profile, each review row shows the settled payment that backs it.
Reviews with no payment appear only in unfiltered mode, greyed, labelled
"no payment recorded".

`/verify` explains the method in prose with the formulas available for anyone who
wants them, and states the parameter values in use.

---

## Configuration

```ts
export const SCORING_DEFAULTS = {
  minReviewerAgeSeconds: 7 * 24 * 3600,
  lambda: 0.05,
  clusterWeights: { reciprocity: 0.45, temporal: 0.35, funding: 0.20 },
  positiveThreshold: 0.5,
  recomputeIntervalMinutes: 15,
} as const;
```

Every parameter is a named constant, surfaced on `/verify`, and changeable without
touching logic. Judges may reasonably disagree with a threshold; they should be
able to see exactly what it is.

---

## Testing

The scoring package must have tests covering:

1. **Known Sybil fixture** — a synthetic cluster of 20 addresses circularly rating
   5 agents with zero settlement. Assert every weight is 0 and the agents' scores
   collapse to the prior.
2. **Legitimate fixture** — 30 independent reviewers with varied settled payments.
   Assert weights are positive and monotone in payment size.
3. **Mixed fixture** — assert pruning changes the ranking order, and assert the
   discarded-count reported to the UI matches the count of zero-weight records.
4. **Prior behaviour** — an agent with no feedback scores exactly 0.5 with maximum
   interval width.
5. **Saturation** — $v$ increases in $M$ and approaches $F$ asymptotically.

These tests are also the honest answer to "how do you know it works" during
judging. Being able to run them live is worth more than a claim in a slide.
