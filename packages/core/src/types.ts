/**
 * Shared domain types. Transcribed from docs/07-DATA_MODEL.md.
 *
 * Conventions that hold everywhere in this file:
 *   - money is `bigint` in base units, with its decimals carried alongside
 *   - timestamps are `bigint` unix seconds at chain boundaries
 *   - nothing here is `any`; unknown shapes are `unknown` and narrowed at the edge
 */

export const AGENT_CATEGORIES = [
  "rebalancing",
  "grid-trading",
  "yield-optimisation",
  "health-factor",
] as const;

export type AgentCategory = (typeof AGENT_CATEGORIES)[number];

/** Ranking and profile surfaces also render agents we could not classify. */
export type AgentCategoryOrUncategorised = AgentCategory | "uncategorised";

export const PROTOCOLS = [
  "pancakeswap-v3",
  "venus",
  "lista",
  "aave-v3",
] as const;

export type Protocol = (typeof PROTOCOLS)[number];

export type Address = `0x${string}`;
export type Hash = `0x${string}`;
export type Selector = `0x${string}`;

export type TokenAmount = {
  raw: bigint;
  decimals: number;
  token: Address;
};

// ---------------------------------------------------------------------------
// Agent identity (ERC-8004)
// ---------------------------------------------------------------------------

export type TrustModel = "reputation" | "crypto-economic" | "tee-attestation";

export type AgentServiceName =
  | "web"
  | "A2A"
  | "MCP"
  | "OASF"
  | "ENS"
  | "DID"
  | "email";

export type AgentService = {
  name: AgentServiceName;
  endpoint: string;
  version?: string;
};

export type Agent = {
  // identity (ERC-8004)
  agentId: bigint;
  registry: string; // "eip155:56:0x..."
  owner: Address;
  name: string;
  description: string;
  image?: string;
  registeredAt: bigint;
  active: boolean;
  supportedTrust: TrustModel[];
  services: AgentService[];
  x402Support: boolean;

  // khoros classification
  category: AgentCategoryOrUncategorised;
  categoryConfidence: number;
  protocols: Protocol[];

  // scoring (from packages/scoring)
  trust: TrustScore;

  // performance (from rollups)
  performance: PerformanceMetrics;
};

// ---------------------------------------------------------------------------
// Trust
// ---------------------------------------------------------------------------

export type DiscardReasons = {
  circularCluster: number;
  noPaymentEvidence: number;
  reviewerTooNew: number;
  revoked: number;
};

export type TrustScore = {
  quality: number; // F_a in [0,1]
  maturity: number; // M_a, accumulated weight
  demandIndex: number; // v(F,M) — the ranking value
  interval95: [number, number];

  reviewsCounted: number;
  reviewsDiscarded: number;
  discardReasons: DiscardReasons;

  raw: {
    // unfiltered, for the toggle
    average: number;
    count: number;
  };

  computedAt: bigint;
};

// ---------------------------------------------------------------------------
// Performance — the six headline slots from docs/03-AGENT_CATEGORIES.md
// ---------------------------------------------------------------------------

export type PerformanceWindow = "7d" | "30d" | "90d";

export type SparklinePoint = { t: bigint; v: number };

export type PerformanceMetrics = {
  returnValue: number; // meaning per category
  returnLabel: string; // "Fee APR" | "Grid profit" | ...
  maxDrawdownBps: number;
  activityCount30d: number;
  precisionBps: number; // time-in-range, capture rate, etc.
  medianLatencyMs: number;
  scaleUsd: number; // TVL managed or debt protected

  sparkline: SparklinePoint[];
  window: PerformanceWindow;
  sampleSize: number; // never hide a thin sample
};

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export type SessionScope = {
  calls: { to: Address; label: string }[];
  selectors: { sig: Selector; name: string }[];
  spend: { token: Address; limit: bigint; periodSeconds: number }[];
  expiry: bigint;
};

export type SessionStatus = "active" | "expired" | "revoked";

export type Session = {
  sessionKey: Address;
  wallet: Address;
  agentId: bigint;
  scope: SessionScope;
  grantTx: Hash;
  keystoreRegistered: boolean;
  revokedAt?: bigint;
  revokeTx?: Hash;
  status: SessionStatus;
};

// ---------------------------------------------------------------------------
// Boundaries — the configurable knobs, one variant per category
// ---------------------------------------------------------------------------

export type RebalancingBoundaries = {
  kind: "rebalancing";
  widthProfile: "tight" | "balanced" | "wide";
  maxSlippageBps: number;
  maxRebalancesPerDay: number;
  minSecondsBetween: number;
  dailyGasBudget: bigint;
};

export type GridTradingBoundaries = {
  kind: "grid-trading";
  priceMin: number;
  priceMax: number;
  levels: number;
  spacing: "geometric" | "arithmetic";
  lowerWeighting: number;
  dailySpendCap: bigint;
  maxSlippageBps: number;
  stopOutPrice?: number;
};

export type YieldOptimisationBoundaries = {
  kind: "yield-optimisation";
  riskProfile: "conservative" | "balanced" | "aggressive";
  maxConcentrationBps: number;
  minSpreadBps: number;
  minHoldSeconds: number;
  protocolAllowlist: Protocol[];
};

export type HealthFactorBoundaries = {
  kind: "health-factor";
  hfFloor: number;
  hfTarget: number;
  reserveAuthorised: bigint;
  preferredResponse: "collateral-first" | "deleverage-first";
  maxInterventionsPerDay: number;
  predictiveConfidence: number;
};

export type CategoryBoundaries =
  | RebalancingBoundaries
  | GridTradingBoundaries
  | YieldOptimisationBoundaries
  | HealthFactorBoundaries;

// ---------------------------------------------------------------------------
// Commerce (ERC-8183)
// ---------------------------------------------------------------------------

export type JobState =
  | "open"
  | "funded"
  | "submitted"
  | "completed"
  | "rejected"
  | "expired";

export type Erc8183Job = {
  jobId: bigint;
  client: Address;
  provider: Address;
  evaluator: Address;
  budget: TokenAmount;
  state: JobState;
  expiry: bigint;
  taskUri: string;
  createTx: Hash;
  fundTx?: Hash;
  settleTx?: Hash;
  settledPaymentUsd?: number; // feeds trust scoring
};

// ---------------------------------------------------------------------------
// Engagement
// ---------------------------------------------------------------------------

export type EngagementStatus = "active" | "paused" | "completed" | "revoked";

export type Engagement = {
  id: string;
  user: Address;
  agentId: bigint;
  category: AgentCategory;

  session: Session;
  job: Erc8183Job;
  boundaries: CategoryBoundaries;
  policyHash: Hash;

  capital: TokenAmount;
  createdAt: bigint;
  status: EngagementStatus;

  parentEngagementId?: string; // set for coordinator sub-hires
};

// ---------------------------------------------------------------------------
// Telemetry
// ---------------------------------------------------------------------------

/**
 * What a simulation observed changing. Kept deliberately open — each category
 * decodes its own protocol state — but never `any`.
 */
export type StateDelta = Record<string, unknown>;

export type TelemetryEvent =
  | {
      kind: "executed";
      engagementId: string;
      intentHash: Hash;
      target: Address;
      selector: Selector;
      tx: Hash;
      gasUsed: bigint;
      latencyMs: number;
      stateDelta: StateDelta;
      at: bigint;
    }
  | {
      kind: "blocked";
      engagementId: string;
      intentHash: Hash;
      reason: string;
      failedInvariant: string;
      observed: string;
      expected: string;
      at: bigint;
    }
  | {
      kind: "triggered";
      engagementId: string;
      trigger: string;
      at: bigint;
    };

// ---------------------------------------------------------------------------
// Intent parsing
// ---------------------------------------------------------------------------

export type ParsedIntentParams = {
  pair?: string;
  capitalUsd?: number;
  priceRange?: { min: number; max: number };
  healthFactorFloor?: number;
  protocols?: Protocol[];
};

export type ParsedIntent = {
  categories: AgentCategory[]; // one or more, ordered by confidence
  params: ParsedIntentParams;
  confidence: number; // 0-1
  restated: string; // plain-language restatement for confirmation
};

// ---------------------------------------------------------------------------
// API contracts (docs/07-DATA_MODEL.md)
// ---------------------------------------------------------------------------

export type AgentRow = {
  agentId: bigint;
  name: string;
  category: AgentCategoryOrUncategorised;
  protocols: Protocol[];
  trust: TrustScore;
  performance: PerformanceMetrics;
};

export type PruningSummary = {
  enabled: boolean;
  reviewsCounted: number;
  reviewsDiscarded: number;
  reasons: Record<string, number>;
};

export type AgentsResponse = {
  agents: AgentRow[];
  pruning: PruningSummary;
  freshness: bigint;
  nextCursor?: string;
};

export type AgentSort = "demand" | "return" | "latency" | "scale";
