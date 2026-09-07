-- Mark curated agents as curated.
--
-- docs/10-BUILD_PLAN.md authorises a hand-curated seed set per category so no
-- arena is empty at judging time. src/sources/REGISTRY_FINDINGS.md documents
-- why one is needed: the live ERC-8004 registry on BSC is dominated by
-- name-spam and bulk duplicates, and zero of a 150-id sample classify into any
-- of the four DeFi categories.
--
-- The flag exists so a curated entry can never be mistaken for a discovered
-- one. Every surface that renders a seeded agent labels it, and the honesty
-- audit can find them with a single query.

alter table agents
  add column if not exists seeded boolean not null default false;

-- Why this agent is in the seed set, and where its data came from. Rendered in
-- the UI next to the seeded label, so the provenance travels with the row.
alter table agents
  add column if not exists seed_note text;

create index if not exists agents_seeded_idx on agents (seeded);

-- Rebuild the ranking view so the flag reaches the arena.
drop materialized view if exists agent_rankings;
create materialized view agent_rankings as
select
  a.agent_id, a.name, a.description, a.image, a.category,
  a.owner, a.supported_trust, a.active, a.protocols, a.x402_support,
  a.seeded, a.seed_note,
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

create unique index if not exists agent_rankings_pk on agent_rankings (agent_id);
create index if not exists agent_rankings_demand_idx on agent_rankings (category, demand_index desc);
create index if not exists agent_rankings_raw_idx on agent_rankings (category, raw_average desc);
