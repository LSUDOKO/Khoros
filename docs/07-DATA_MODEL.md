# 07 — Data Model

## Principles

**On-chain is truth.** Every table here is a rebuildable projection of chain state
plus 8004scan data. If Postgres is dropped, a full indexer replay must reproduce it.
Never store something that exists nowhere else.

**Money is `bigint`.** Base units, always, with decimals carried alongside. A
`number` holding a token amount is a bug waiting for a large position.

**Timestamps are unix seconds as `bigint`** at chain boundaries and `Date` in the
UI layer. Convert once, at the edge.

---

## Core types

`packages/core/src/types.ts`

```ts
export const AGENT_CATEGORIES = [
  "rebalancing",
  "grid-trading",
  "yield-optimisation",
  "health-factor",
] as const;

export type AgentCategory = (typeof AGENT_CATEGORIES)[number];

export type Protocol =
  | "pancakeswap-v3"
  | "venus"
  | "lista"
  | "aave-v3";

export type Address = `0x${string}`;
export type Hash = `0x${string}`;

export type TokenAmount = {
  raw: bigint;
  decimals: number;
  token: Address;
};
```

### Agent

```ts
export type Agent = {
  // identity (ERC-8004)
  agentId: bigint;
  registry: string;                 // "eip155:56:0x..."
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
  category: AgentCategory | "uncategorised";
  categoryConfidence: number;
  protocols: Protocol[];

  // scoring (from packages/scoring)
  trust: TrustScore;

  // performance (from rollups)
  performance: PerformanceMetrics;
};

export type TrustModel = "reputation" | "crypto-economic" | "tee-attestation";

export type AgentService = {
  name: "web" | "A2A" | "MCP" | "OASF" | "ENS" | "DID" | "email";
  endpoint: string;
  version?: string;
};
```

### Trust score

```ts
export type TrustScore = {
  quality: number;          // F_a in [0,1]
  maturity: number;         // M_a, accumulated weight
  demandIndex: number;      // v(F,M) — the ranking value
  interval95: [number, number];

  reviewsCounted: number;
  reviewsDiscarded: number;
  discardReasons: {
    circularCluster: number;
    noPaymentEvidence: number;
    reviewerTooNew: number;
    revoked: number;
  };

  raw: {                    // unfiltered, for the toggle
    average: number;
    count: number;
  };

  computedAt: bigint;
};
```

### Performance

The six headline slots from `03-AGENT_CATEGORIES.md`, plus a sparkline series.

```ts
export type PerformanceMetrics = {
  returnValue: number;          // meaning per category
  returnLabel: string;          // "Fee APR" | "Grid profit" | ...
  maxDrawdownBps: number;
  activityCount30d: number;
  precisionBps: number;         // time-in-range, capture rate, etc.
  medianLatencyMs: number;
  scaleUsd: number;             // TVL managed or debt protected

  sparkline: { t: bigint; v: number }[];
  window: "7d" | "30d" | "90d";
  sampleSize: number;           // never hide a thin sample
};
```

`sampleSize` is rendered in the UI whenever it is small. A 30-day ROI from three
observations must not look like one from three hundred.

### Session

```ts
export type SessionScope = {
  calls: { to: Address; label: string }[];
  selectors: { sig: `0x${string}`; name: string }[];
  spend: { token: Address; limit: bigint; periodSeconds: number }[];
  expiry: bigint;
};

export type Session = {
  sessionKey: Address;
  wallet: Address;
  agentId: bigint;
  scope: SessionScope;
  grantTx: Hash;
  keystoreRegistered: boolean;
  revokedAt?: bigint;
  revokeTx?: Hash;
  status: "active" | "expired" | "revoked";
};
```

`describeScope(scope)` (see `06-INTEGRATIONS.md`) is the only source of the
permission copy. Nothing renders permissions from a separate string.

### Engagement

One user hiring one agent. Ties together session, job, boundaries, and telemetry.

```ts
export type Engagement = {
  id: string;
  user: Address;
  agentId: bigint;
  category: AgentCategory;

  session: Session;
  job: Erc8183Job;
  boundaries: CategoryBoundaries;   // discriminated union per category
  policyHash: Hash;

  capital: TokenAmount;
  createdAt: bigint;
  status: "active" | "paused" | "completed" | "revoked";

  parentEngagementId?: string;      // set for coordinator sub-hires
};
```

### Boundaries

Discriminated union — each category's configurable knobs.

```ts
export type CategoryBoundaries =
  | { kind: "rebalancing";
      widthProfile: "tight" | "balanced" | "wide";
      maxSlippageBps: number;
      maxRebalancesPerDay: number;
      minSecondsBetween: number;
      dailyGasBudget: bigint; }
  | { kind: "grid-trading";
      priceMin: number; priceMax: number;
      levels: number;
      spacing: "geometric" | "arithmetic";
      lowerWeighting: number;
      dailySpendCap: bigint;
      maxSlippageBps: number;
      stopOutPrice?: number; }
  | { kind: "yield-optimisation";
      riskProfile: "conservative" | "balanced" | "aggressive";
      maxConcentrationBps: number;
      minSpreadBps: number;
      minHoldSeconds: number;
      protocolAllowlist: Protocol[]; }
  | { kind: "health-factor";
      hfFloor: number;
      hfTarget: number;
      reserveAuthorised: bigint;
      preferredResponse: "collateral-first" | "deleverage-first";
      maxInterventionsPerDay: number;
      predictiveConfidence: number; };
```

### Job

```ts
export type Erc8183Job = {
  jobId: bigint;
  client: Address;
  provider: Address;
  evaluator: Address;
  budget: TokenAmount;
  state: "open" | "funded" | "submitted" | "completed" | "rejected" | "expired";
  expiry: bigint;
  taskUri: string;
  createTx: Hash;
  fundTx?: Hash;
  settleTx?: Hash;
  settledPaymentUsd?: number;   // feeds trust scoring
};
```

### Telemetry

Every agent action, executed or blocked.

```ts
export type TelemetryEvent =
  | { kind: "executed";
      engagementId: string;
      intentHash: Hash;
      target: Address;
      selector: `0x${string}`;
      tx: Hash;
      gasUsed: bigint;
      latencyMs: number;
      stateDelta: StateDelta;
      at: bigint; }
  | { kind: "blocked";
      engagementId: string;
      intentHash: Hash;
      reason: string;
      failedInvariant: string;
      observed: string;
      expected: string;
      at: bigint; }
  | { kind: "triggered";
      engagementId: string;
      trigger: string;
      at: bigint; };
```

Blocked events render in the dashboard with the same prominence as executed ones.
They are evidence the safety layer works.

---

## Database schema

Postgres. Migrations in `apps/indexer/migrations/`.

```sql
create table agents (
  agent_id            numeric(78,0) primary key,
  registry            text not null,
  owner               text not null,
  name                text not null,
  description         text,
  image               text,
  registered_at       bigint not null,
  active              boolean not null default true,
  supported_trust     text[] not null default '{}',
  services            jsonb not null default '[]',
  x402_support        boolean not null default false,
  category            text not null default 'uncategorised',
  category_confidence real not null default 0,
  protocols           text[] not null default '{}',
  indexed_at          bigint not null
);
create index on agents (category, active);

create table feedback (
  id                   bigserial primary key,
  agent_id             numeric(78,0) not null references agents(agent_id),
  client_address       text not null,
  feedback_index       bigint not null,
  score                real not null,
  tag1                 text,
  tag2                 text,
  is_revoked           boolean not null default false,
  -- enrichment
  settled_payment_usd  numeric(20,6) not null default 0,
  settlement_job_id    numeric(78,0),
  match_confidence     real not null default 0,
  reviewer_first_seen  bigint,
  reviewer_tx_count    bigint,
  cluster_correlation  real not null default 0,
  weight               double precision not null default 0,
  created_at           bigint not null,
  unique (agent_id, client_address, feedback_index)
);
create index on feedback (agent_id) where weight > 0;

create table agent_scores (
  agent_id           numeric(78,0) primary key references agents(agent_id),
  quality            double precision not null,
  maturity           double precision not null,
  demand_index       double precision not null,
  interval_low       double precision not null,
  interval_high      double precision not null,
  reviews_counted    integer not null,
  reviews_discarded  integer not null,
  discard_reasons    jsonb not null,
  raw_average        double precision,
  raw_count          integer,
  computed_at        bigint not null
);
create index on agent_scores (demand_index desc);

create table performance (
  agent_id          numeric(78,0) references agents(agent_id),
  window            text not null,
  return_value      double precision,
  return_label      text,
  max_drawdown_bps  integer,
  activity_30d      integer,
  precision_bps     integer,
  median_latency_ms integer,
  scale_usd         double precision,
  sample_size       integer not null,
  sparkline         jsonb not null default '[]',
  computed_at       bigint not null,
  primary key (agent_id, window)
);

create table sessions (
  session_key           text primary key,
  wallet                text not null,
  agent_id              numeric(78,0) not null,
  scope                 jsonb not null,
  grant_tx              text not null,
  keystore_registered   boolean not null default false,
  expiry                bigint not null,
  revoked_at            bigint,
  revoke_tx             text,
  status                text not null
);
create index on sessions (wallet, status);

create table engagements (
  id                    text primary key,
  user_address          text not null,
  agent_id              numeric(78,0) not null,
  category              text not null,
  session_key           text references sessions(session_key),
  job_id                numeric(78,0),
  boundaries            jsonb not null,
  policy_hash           text not null,
  capital_raw           numeric(78,0) not null,
  capital_token         text not null,
  capital_decimals      integer not null,
  parent_engagement_id  text references engagements(id),
  status                text not null,
  created_at            bigint not null
);
create index on engagements (user_address, status);

create table jobs (
  job_id               numeric(78,0) primary key,
  client               text not null,
  provider             text not null,
  evaluator            text not null,
  budget_raw           numeric(78,0) not null,
  budget_token         text not null,
  state                text not null,
  expiry               bigint not null,
  task_uri             text,
  create_tx            text,
  fund_tx              text,
  settle_tx            text,
  settled_payment_usd  numeric(20,6)
);

create table telemetry (
  id              bigserial primary key,
  engagement_id   text not null references engagements(id),
  kind            text not null,
  intent_hash     text,
  payload         jsonb not null,
  at              bigint not null
);
create index on telemetry (engagement_id, at desc);
create index on telemetry (kind, at desc);
```

### The ranking view

What the arena reads. One query, no joins at request time.

```sql
create materialized view agent_rankings as
select
  a.agent_id, a.name, a.description, a.image, a.category,
  a.owner, a.supported_trust, a.active,
  s.quality, s.maturity, s.demand_index,
  s.interval_low, s.interval_high,
  s.reviews_counted, s.reviews_discarded, s.discard_reasons,
  s.raw_average, s.raw_count,
  p.return_value, p.return_label, p.max_drawdown_bps,
  p.activity_30d, p.precision_bps, p.median_latency_ms,
  p.scale_usd, p.sample_size, p.sparkline,
  greatest(s.computed_at, p.computed_at) as freshness
from agents a
join agent_scores s using (agent_id)
left join performance p on p.agent_id = a.agent_id and p.window = '30d'
where a.active;

create index on agent_rankings (category, demand_index desc);
create index on agent_rankings (category, raw_average desc);
```

Refresh concurrently at the end of each indexer cycle. Two indexes because the
prune toggle sorts by a different column and must stay fast.

---

## API contracts

### `POST /api/intent`

```ts
// request
{ text: string }

// response
{
  categories: AgentCategory[];
  params: {
    pair?: string;
    capitalUsd?: number;
    priceRange?: { min: number; max: number };
    healthFactorFloor?: number;
    protocols?: Protocol[];
  };
  confidence: number;
  restated: string;
}
```

Low confidence returns all four categories with `confidence < 0.4`, and the UI
shows the browse view rather than a guess.

### `GET /api/agents`

```
?category=rebalancing
&pruned=true            (default true)
&sort=demand|return|latency|scale
&limit=25&cursor=...
```

```ts
{
  agents: AgentRow[];
  pruning: {
    enabled: boolean;
    reviewsCounted: number;
    reviewsDiscarded: number;
    reasons: Record<string, number>;
  };
  freshness: number;        // unix seconds of last index
  nextCursor?: string;
}
```

The `pruning` block is aggregate across the returned set and drives the copy under
the toggle.

### `GET /api/telemetry/:engagementId` — SSE

```
event: executed
data: { intentHash, tx, latencyMs, stateDelta, at }

event: blocked
data: { intentHash, reason, failedInvariant, observed, expected, at }
```

---

## Invariants worth testing

1. Every `feedback.weight > 0` row has `settled_payment_usd > 0`.
2. `reviews_counted + reviews_discarded` equals the total feedback rows for the agent.
3. No engagement is active with an expired or revoked session.
4. Every telemetry `executed` event has a corresponding on-chain transaction.
5. Sum of sub-engagement capital never exceeds parent engagement capital.
6. `agent_rankings` row count equals active agent count with a score.
