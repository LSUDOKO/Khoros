/**
 * Step 2 — Cluster detection. From docs/04-TRUST_SCORING.md.
 *
 * Build a bipartite graph of reviewers and agents. A reviewer sits in a
 * suspicious cluster when the subgraph reachable from them is small, densely
 * connected, and has little economic flow crossing its boundary.
 *
 *   clusterCorrelation = min(1, 0.45*reciprocity + 0.35*temporal + 0.20*funding)
 *
 * IMPORTANT — what the doc specifies and what it does not.
 *
 * docs/04 gives the three signal NAMES and their WEIGHTS, but no formula mapping
 * graph structure onto a [0,1] number for any of them. The definitions below are
 * ours, and they are stated here (and rendered on /verify) so nobody has to read
 * the source to learn what the number means. Each is deliberately simple and
 * computable from data we actually hold, rather than sophisticated and
 * unimplementable.
 *
 * A note on honesty: the doc's reciprocity signal says "addresses that this
 * reviewer's OWNER also controls", which needs address-linkage attribution — a
 * heuristic subsystem for deciding that two addresses share an operator. We do
 * not have that, and guessing at it would produce confident nonsense. Our
 * reciprocity therefore measures observable review-graph structure instead, and
 * `/verify` says so plainly. Funding provenance is computed only when funding
 * data is supplied, and contributes 0 otherwise rather than being invented.
 */

export type ReviewEdge = {
  reviewer: string;
  agentId: bigint;
  /** Unix seconds. Used for the temporal signal. */
  at: bigint;
  /** Settled payment behind this review, used to measure economic flow. */
  settledPaymentUsd: number;
};

export type FundingInfo = {
  /** Address that first funded this reviewer, if known. */
  funder?: string;
  /** Unix seconds when the reviewer was first funded. */
  fundedAt?: bigint;
};

export type ClusterSignals = {
  reciprocity: number;
  temporalCoincidence: number;
  fundingProvenance: number;
};

export type ClusterConfig = {
  weights: { reciprocity: number; temporal: number; funding: number };
  /** Reviews inside this window count as temporally coincident. Default 1 hour. */
  temporalWindowSeconds: number;
  /** A component at or below this size is "small" for the reciprocity signal. */
  smallComponentSize: number;
};

export const DEFAULT_CLUSTER_CONFIG: ClusterConfig = {
  weights: { reciprocity: 0.45, temporal: 0.35, funding: 0.2 },
  temporalWindowSeconds: 3600,
  smallComponentSize: 25,
};

export function clusterCorrelation(
  s: ClusterSignals,
  weights: ClusterConfig["weights"] = DEFAULT_CLUSTER_CONFIG.weights,
): number {
  return Math.min(
    1,
    weights.reciprocity * s.reciprocity +
      weights.temporal * s.temporalCoincidence +
      weights.funding * s.fundingProvenance,
  );
}

// ---------------------------------------------------------------------------
// Connected components over the bipartite reviewer/agent graph
// ---------------------------------------------------------------------------

type NodeId = string;

const reviewerNode = (a: string): NodeId => `r:${a.toLowerCase()}`;
const agentNode = (id: bigint): NodeId => `a:${id.toString()}`;

class DisjointSet {
  private parent = new Map<NodeId, NodeId>();

  find(x: NodeId): NodeId {
    const p = this.parent.get(x);
    if (p === undefined) {
      this.parent.set(x, x);
      return x;
    }
    if (p === x) return x;
    const root = this.find(p);
    this.parent.set(x, root); // path compression
    return root;
  }

  union(a: NodeId, b: NodeId): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

export type Component = {
  reviewers: Set<string>;
  agents: Set<bigint>;
  edges: ReviewEdge[];
};

/** Partition the review graph into connected components. */
export function connectedComponents(edges: ReviewEdge[]): Component[] {
  const ds = new DisjointSet();
  for (const e of edges) {
    ds.union(reviewerNode(e.reviewer), agentNode(e.agentId));
  }

  const byRoot = new Map<NodeId, Component>();
  for (const e of edges) {
    const root = ds.find(reviewerNode(e.reviewer));
    let comp = byRoot.get(root);
    if (!comp) {
      comp = { reviewers: new Set(), agents: new Set(), edges: [] };
      byRoot.set(root, comp);
    }
    comp.reviewers.add(e.reviewer.toLowerCase());
    comp.agents.add(e.agentId);
    comp.edges.push(e);
  }

  return [...byRoot.values()];
}

// ---------------------------------------------------------------------------
// The three signals
// ---------------------------------------------------------------------------

/**
 * Reciprocity — how closed and densely interconnected the component is.
 *
 * Two observable properties distinguish a rating ring from an organic
 * neighbourhood:
 *
 *   density — the fraction of possible reviewer->agent pairs that exist. A ring
 *     where everyone rates everything approaches 1. Organic reviewers each touch
 *     a few agents, so density is low.
 *
 *   closure — how little settled economic value crosses the component boundary.
 *     A ring rates only itself and pays nothing, so almost no value flows.
 *
 * Both are scaled down for large components, because a big densely-connected
 * component is far more likely to be a popular agent's genuine audience than a
 * coordinated ring.
 */
export function reciprocitySignal(
  comp: Component,
  cfg: ClusterConfig = DEFAULT_CLUSTER_CONFIG,
): number {
  const r = comp.reviewers.size;
  const a = comp.agents.size;
  if (r === 0 || a === 0) return 0;

  // A single reviewer with a single agent is not evidence of anything.
  if (r === 1 && a === 1) return 0;

  const possiblePairs = r * a;
  const actualPairs = new Set(
    comp.edges.map((e) => `${e.reviewer.toLowerCase()}|${e.agentId}`),
  ).size;
  const density = actualPairs / possiblePairs;

  // Economic closure: rings are cheap, so they carry little settled value.
  const paidEdges = comp.edges.filter((e) => e.settledPaymentUsd > 0).length;
  const closure = 1 - paidEdges / comp.edges.length;

  // Small components are suspicious; large ones are probably organic.
  const sizeFactor =
    comp.reviewers.size <= cfg.smallComponentSize
      ? 1
      : cfg.smallComponentSize / comp.reviewers.size;

  return Math.min(1, density * closure * sizeFactor);
}

/**
 * Temporal coincidence — the fraction of a component's reviews that arrive
 * inside the same short window as several others.
 *
 * Organic reviews arrive spread over time. A ring is typically scripted, so its
 * reviews land within the same block or a handful of blocks. We sweep a window
 * over the sorted timestamps and take the largest fraction of the component's
 * reviews falling inside any one window.
 */
export function temporalSignal(
  comp: Component,
  cfg: ClusterConfig = DEFAULT_CLUSTER_CONFIG,
): number {
  const n = comp.edges.length;
  if (n < 2) return 0;

  const times = comp.edges.map((e) => Number(e.at)).sort((x, y) => x - y);

  let best = 0;
  let start = 0;
  for (let end = 0; end < times.length; end++) {
    while ((times[end] as number) - (times[start] as number) > cfg.temporalWindowSeconds) {
      start += 1;
    }
    best = Math.max(best, end - start + 1);
  }

  // A window holding only one review is no signal at all; scale so that
  // "all reviews in one window" is 1 and "no two together" is 0.
  return (best - 1) / (n - 1);
}

/**
 * Funding provenance — the fraction of a component's reviewers funded from the
 * same source.
 *
 * Returns 0 when no funding data is available, rather than guessing. An absent
 * signal must not look like a clean one, so callers that lack funding data get
 * a correlation built from the other two signals only.
 */
export function fundingSignal(
  comp: Component,
  funding: Map<string, FundingInfo>,
): number {
  const reviewers = [...comp.reviewers];
  if (reviewers.length < 2) return 0;

  const funders = new Map<string, number>();
  let known = 0;
  for (const r of reviewers) {
    const info = funding.get(r.toLowerCase());
    if (info?.funder) {
      known += 1;
      const key = info.funder.toLowerCase();
      funders.set(key, (funders.get(key) ?? 0) + 1);
    }
  }

  if (known < 2) return 0;

  let largest = 0;
  for (const count of funders.values()) largest = Math.max(largest, count);

  // Fraction of ALL reviewers sharing the most common funder. Dividing by the
  // total rather than by `known` keeps a component with one known pair from
  // scoring 1.0 on thin evidence.
  return largest / reviewers.length;
}

// ---------------------------------------------------------------------------
// Pipeline entry point
// ---------------------------------------------------------------------------

export type ClusterAnalysis = {
  /** Reviewer address (lowercased) -> correlation in [0,1]. */
  correlationByReviewer: Map<string, number>;
  /** Retained for diagnostics and for the /verify worked example. */
  components: { component: Component; signals: ClusterSignals; correlation: number }[];
};

/**
 * Compute a cluster correlation for every reviewer in the graph.
 *
 * Each reviewer is assigned their component's score, as docs/04 prescribes.
 * This is the expensive step; the indexer caches it per cycle.
 */
export function analyseClusters(
  edges: ReviewEdge[],
  funding: Map<string, FundingInfo> = new Map(),
  cfg: ClusterConfig = DEFAULT_CLUSTER_CONFIG,
): ClusterAnalysis {
  const components = connectedComponents(edges);
  const correlationByReviewer = new Map<string, number>();
  const detail: ClusterAnalysis["components"] = [];

  for (const component of components) {
    const signals: ClusterSignals = {
      reciprocity: reciprocitySignal(component, cfg),
      temporalCoincidence: temporalSignal(component, cfg),
      fundingProvenance: fundingSignal(component, funding),
    };
    const correlation = clusterCorrelation(signals, cfg.weights);

    for (const reviewer of component.reviewers) {
      correlationByReviewer.set(reviewer, correlation);
    }
    detail.push({ component, signals, correlation });
  }

  return { correlationByReviewer, components: detail };
}
