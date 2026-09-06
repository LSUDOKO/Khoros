-- Khoros schema. Transcribed from docs/07-DATA_MODEL.md.
--
-- Principle: on-chain is truth. Every table here is a rebuildable projection of
-- chain state plus 8004scan data. If this database is dropped, a full indexer
-- replay must reproduce it. Nothing is stored here that exists nowhere else.

create table if not exists agents (
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
create index if not exists agents_category_active_idx on agents (category, active);

create table if not exists feedback (
  id                   bigserial primary key,
  agent_id             numeric(78,0) not null references agents(agent_id) on delete cascade,
  client_address       text not null,
  feedback_index       bigint not null,
  score                real not null,
  -- The registry reports scores with a valueDecimals scale. Keeping it lets a
  -- replay reproduce the normalisation from this table alone, which the
  -- "rebuildable projection" principle requires.
  value_decimals       integer not null default 0,
  tag1                 text,
  tag2                 text,
  is_revoked           boolean not null default false,
  -- enrichment
  settled_payment_usd  numeric(20,6) not null default 0,
  settlement_job_id    numeric(78,0),
  match_confidence     real not null default 0,
  reviewer_first_seen  bigint,
  reviewer_tx_count    bigint,
  reviewer_distinct_agents integer,
  cluster_correlation  real not null default 0,
  weight               double precision not null default 0,
  -- Why a record was discarded, so the UI breakdown always reconciles with the
  -- total. Null when the record counted.
  discard_reason       text,
  created_at           bigint not null,
  unique (agent_id, client_address, feedback_index)
);
create index if not exists feedback_weighted_idx on feedback (agent_id) where weight > 0;

create table if not exists agent_scores (
  agent_id           numeric(78,0) primary key references agents(agent_id) on delete cascade,
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
create index if not exists agent_scores_demand_idx on agent_scores (demand_index desc);

create table if not exists performance (
  agent_id          numeric(78,0) references agents(agent_id) on delete cascade,
  -- NOTE: "window" is a reserved word in SQL (the window-function clause).
  -- Renamed to window_label so every query does not need quoting.
  window_label      text not null,
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
  primary key (agent_id, window_label)
);

create table if not exists sessions (
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
create index if not exists sessions_wallet_status_idx on sessions (wallet, status);

create table if not exists engagements (
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
create index if not exists engagements_user_status_idx on engagements (user_address, status);

create table if not exists jobs (
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

create table if not exists telemetry (
  id              bigserial primary key,
  engagement_id   text not null references engagements(id) on delete cascade,
  kind            text not null,
  intent_hash     text,
  payload         jsonb not null,
  at              bigint not null
);
create index if not exists telemetry_engagement_idx on telemetry (engagement_id, at desc);
create index if not exists telemetry_kind_idx on telemetry (kind, at desc);

-- ---------------------------------------------------------------------------
-- The ranking view — what the arena reads. One query, no joins at request time.
-- ---------------------------------------------------------------------------

drop materialized view if exists agent_rankings;
create materialized view agent_rankings as
select
  a.agent_id, a.name, a.description, a.image, a.category,
  a.owner, a.supported_trust, a.active, a.protocols, a.x402_support,
  s.quality, s.maturity, s.demand_index,
  s.interval_low, s.interval_high,
  s.reviews_counted, s.reviews_discarded, s.discard_reasons,
  s.raw_average, s.raw_count,
  p.return_value, p.return_label, p.max_drawdown_bps,
  p.activity_30d, p.precision_bps, p.median_latency_ms,
  p.scale_usd, p.sample_size, p.sparkline,
  greatest(s.computed_at, coalesce(p.computed_at, 0)) as freshness
from agents a
join agent_scores s using (agent_id)
left join performance p on p.agent_id = a.agent_id and p.window_label = '30d'
where a.active;

-- `refresh materialized view concurrently` REQUIRES a unique index on the view.
-- docs/07 declares only the two non-unique sort indexes, so the concurrent
-- refresh it also specifies would fail at runtime without this.
create unique index if not exists agent_rankings_pk on agent_rankings (agent_id);

-- Two sort indexes because the prune toggle sorts on a different column.
create index if not exists agent_rankings_demand_idx on agent_rankings (category, demand_index desc);
create index if not exists agent_rankings_raw_idx on agent_rankings (category, raw_average desc);
