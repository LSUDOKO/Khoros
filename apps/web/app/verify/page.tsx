/**
 * /verify — the trust methodology page.
 *
 * docs/04-TRUST_SCORING.md: "explains the method in prose with the formulas
 * available for anyone who wants them, and states the parameter values in use."
 *
 * Parameter values are read from the scoring package rather than retyped, so
 * this page cannot drift from the numbers actually in use. That matters: judges
 * may reasonably disagree with a threshold, and they should be able to see
 * exactly what it is.
 */

import { SCORING_DEFAULTS } from "@khoros/scoring";

export const metadata = {
  title: "How trust works — Khoros",
  description:
    "The Sybil pruning method, the reputation maths, and every parameter in use.",
};

export default function VerifyPage(): React.ReactElement {
  const cfg = SCORING_DEFAULTS;

  return (
    <div className="site-shell prose-page">
      <div className="page-head">
        <h1 className="khoros-title">How trust works</h1>
        <p className="lede">
          A review is worth what the reviewer paid. Everything below follows from
          that one idea.
        </p>
      </div>

      <h2>Why raw ratings mislead</h2>
      <p>
        The ERC-8004 Reputation Registry is permissionless: anyone can write a
        review about anyone, for free. That is the right design for an open
        registry, but it means a raw average measures how motivated an agent&rsquo;s
        operator was to write reviews, not how well the agent works. A ring of
        addresses rating each other costs nothing to run and produces a perfect
        score.
      </p>
      <p>
        So Khoros ranks on reviews that have a settled payment behind them. Those
        are expensive to fake, because faking one means actually paying for a job.
      </p>

      <h2>The four steps</h2>

      <h3 className="khoros-label">1. Enrichment</h3>
      <p>
        Each review is matched against ERC-8183 job settlements and x402 receipts
        to find the payment behind it. The registry carries no job id, so the
        match is heuristic — client address, agent id, and a settlement window.
        We record a match confidence, and unmatched reviews are treated as having
        no payment rather than being guessed at.
      </p>

      <h3 className="khoros-label">2. Cluster detection</h3>
      <p>
        Reviewers and agents form a bipartite graph. We split it into connected
        components and score each one on three signals, then assign every
        reviewer their component&rsquo;s score:
      </p>
      <ul>
        <li>
          <strong>Reciprocity</strong> — how dense the component is and how
          little settled value crosses its boundary. A ring where everyone rates
          everything and nobody pays scores high. Large components are scaled
          down, because a big densely-connected component is far more likely to
          be a popular agent&rsquo;s genuine audience than a coordinated ring.
        </li>
        <li>
          <strong>Temporal coincidence</strong> — the largest share of a
          component&rsquo;s reviews landing inside a single short window. Scripted
          reviews arrive together; organic ones do not.
        </li>
        <li>
          <strong>Funding provenance</strong> — the share of a component&rsquo;s
          reviewers funded from a common source.
        </li>
      </ul>

      <div className="formula">
        clusterCorrelation = min(1, {cfg.clusterWeights.reciprocity} ×
        reciprocity + {cfg.clusterWeights.temporal} × temporal +{" "}
        {cfg.clusterWeights.funding} × funding)
      </div>

      <div className="notice" data-tone="risk">
        <p>
          <strong>Stated limitation.</strong> The reciprocity signal we compute
          measures observable review-graph structure. A stronger version would
          also link addresses controlled by the same operator, which needs
          address-attribution heuristics we do not have. Rather than approximate
          that and present the result as if it were the stronger signal, we
          compute what we can actually observe and say so here. Funding
          provenance contributes zero when funding data is unavailable, rather
          than defaulting to a clean score.
        </p>
      </div>

      <h3 className="khoros-label">3. Weighting</h3>
      <div className="formula">
        w = ln(1 + settledPaymentUSD) × [reviewerAge &gt; τ] × (1 −
        clusterCorrelation)
      </div>
      <p>
        The payment term is logarithmic, so a $500 review counts more than a $5
        one but not a hundred times more — that stops a single large review
        dominating and makes payment-size gaming inefficient. A review with no
        settlement gets ln(1) = 0 and drops out entirely. The age gate is a hard
        cut rather than a taper, because the failure mode it blocks — addresses
        created to review — is cheap and high volume.
      </p>

      <h3 className="khoros-label">4. Aggregation</h3>
      <div className="formula">
        α = 1 + Σ w·s over positives &nbsp;&nbsp; β = 1 + Σ w·(1−s) over
        negatives
        <br />
        quality F = α / (α + β)
        <br />
        maturity M = Σ w
        <br />
        demand index v = F × (1 − e<sup>−λM</sup>)
        <br />
        CI₉₅ = [BetaInv(0.025, α, β), BetaInv(0.975, α, β)]
      </div>
      <p>
        The uniform prior puts an agent with no history at exactly 0.5 rather
        than at 0 or 1. Maturity is how much verified economic history stands
        behind the estimate — an agent at 0.95 quality from one small settled job
        should not outrank one at 0.88 from a long track record, and the demand
        index is what makes sure it does not. The exponential saturates, so early
        history moves the ranking a lot and later history barely does, which
        stops incumbents from becoming unassailable.
      </p>
      <p>
        The confidence interval is reported so uncertainty is visible. A new
        agent looks uncertain because it <em>is</em> uncertain, and that is
        useful information rather than something to hide behind a single number.
      </p>

      <h2>Parameters in use</h2>
      <p>
        These are read directly from the scoring engine, so this table cannot
        drift from the values actually applied.
      </p>
      <div className="scroll-x">
        <table className="param-table">
          <thead>
            <tr>
              <th>Parameter</th>
              <th>Value</th>
              <th>What it does</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>minReviewerAgeSeconds</td>
              <td>
                {cfg.minReviewerAgeSeconds.toLocaleString("en-US")} (
                {cfg.minReviewerAgeSeconds / 86_400} days)
              </td>
              <td>
                How long a reviewer address must have existed before its review
                counts.
              </td>
            </tr>
            <tr>
              <td>λ (lambda)</td>
              <td>{cfg.lambda}</td>
              <td>
                Saturation rate of the demand index. Tuned so roughly 60
                accumulated weight reaches about 95% of the ceiling.
              </td>
            </tr>
            <tr>
              <td>positiveThreshold</td>
              <td>{cfg.positiveThreshold}</td>
              <td>The score above which a review counts as positive.</td>
            </tr>
            <tr>
              <td>clusterWeights</td>
              <td>
                {cfg.clusterWeights.reciprocity} / {cfg.clusterWeights.temporal}{" "}
                / {cfg.clusterWeights.funding}
              </td>
              <td>Reciprocity, temporal coincidence, funding provenance.</td>
            </tr>
            <tr>
              <td>recomputeIntervalMinutes</td>
              <td>{cfg.recomputeIntervalMinutes}</td>
              <td>How often the whole pipeline recomputes.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>Why a discarded review is still shown</h2>
      <p>
        Pruning is a ranking decision, not a censorship one. Every review remains
        visible under the unfiltered toggle, and an agent&rsquo;s profile shows the
        settled payment behind each review that counted. If we discard a review,
        the count and the reason appear next to the ranking — you can always see
        how much was set aside and why.
      </p>

      <h2>How to check this yourself</h2>
      <p>
        Agent identity links to 8004scan, sessions to the Altana Explorer, and
        every transaction to BscScan. The scoring engine ships with its test
        suite, including a synthetic fixture of twenty addresses circularly
        rating five agents with no settlement behind any of it — the test asserts
        every weight collapses to zero and the agents fall back to the prior.
        Those tests run with <code>pnpm test</code>.
      </p>
    </div>
  );
}
