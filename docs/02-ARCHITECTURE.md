# 02 — Architecture

## Shape of the system

Khoros is four deployables and one contract set.

```
                    ┌───────────────────────────────┐
                    │   web (Next.js, Vercel)       │
                    │   marketplace · arena · hire  │
                    │   dashboard · benchmark       │
                    └──────┬─────────────────┬──────┘
                           │                 │
              read models  │                 │  session grants,
              trust scores │                 │  job creation
                           v                 v
        ┌──────────────────────────┐   ┌─────────────────────────┐
        │  indexer (Node, Railway) │   │  chain (BSC 56 / 97)    │
        │  8004scan ingest         │   │  ERC-8004 registries    │
        │  sybil pruning           │   │  ERC-8183 commerce      │
        │  performance rollups     │   │  Altana KeyStore        │
        │  → Postgres + Redis      │   │  PolicyAttestedExecutor │
        └──────────────────────────┘   │  PancakeSwap · Venus    │
                                       │  Lista · Aave           │
        ┌──────────────────────────┐   └──────────┬──────────────┘
        │  verifier (Node, Fly)    │              ^
        │  fork simulation         │              │
        │  policy evaluation       │  signed PDR  │
        │  PDR signing             │──────────────┘
        └──────────────────────────┘              ^
                                                  │
        ┌──────────────────────────┐              │
        │  agents (Agent Studio v2)│──────────────┘
        │  rebalancing · grid      │   execute via session key
        │  yield · health-factor   │
        └──────────────────────────┘
```

**Why these boundaries.** The indexer is slow and batch-oriented; the web app must
be fast, so it only reads precomputed models. The verifier holds a signing key and
must be isolated from anything user-facing. The agents are long-running processes
with their own lifecycle and must survive a web deploy.

---

## Repository layout

Monorepo, pnpm workspaces, Turborepo for task orchestration.

```
khoros/
├── CLAUDE.md
├── docs/                          # these documents
├── apps/
│   ├── web/                       # Next.js 14 App Router
│   │   ├── app/
│   │   │   ├── page.tsx                    # front door
│   │   │   ├── arena/
│   │   │   │   ├── page.tsx                # all four leaderboards
│   │   │   │   └── [category]/page.tsx     # one category in depth
│   │   │   ├── agent/[id]/page.tsx
│   │   │   ├── hire/[id]/page.tsx
│   │   │   ├── dashboard/
│   │   │   │   ├── page.tsx
│   │   │   │   └── session/[key]/page.tsx
│   │   │   ├── benchmark/page.tsx
│   │   │   ├── verify/page.tsx
│   │   │   └── api/
│   │   │       ├── intent/route.ts         # intent parsing
│   │   │       ├── agents/route.ts         # ranked agent queries
│   │   │       └── telemetry/route.ts      # SSE live feed
│   │   ├── components/
│   │   │   ├── arena/                      # Stave, Leaderboard, PruneToggle
│   │   │   ├── agent/                      # ProfileHeader, TrackRecord
│   │   │   ├── hire/                       # PermissionPreview, Boundaries
│   │   │   └── primitives/                 # design system components
│   │   └── lib/
│   │       ├── altana/                     # session grant, revoke, keystore reads
│   │       ├── bnbagent/                   # ERC-8183 job lifecycle
│   │       ├── chain/                      # viem clients, contract reads
│   │       └── intent/                     # parser + restatement
│   ├── indexer/                   # agent ingest, scoring, rollups
│   │   ├── src/
│   │   │   ├── sources/8004scan.ts
│   │   │   ├── sources/registry.ts         # direct ERC-8004 reads
│   │   │   ├── scoring/prune.ts            # sybil weight computation
│   │   │   ├── scoring/beta.ts             # Beta reputation
│   │   │   ├── rollups/performance.ts      # ROI, drawdown, latency
│   │   │   └── jobs/                       # scheduled tasks
│   └── verifier/                  # PACE simulation + PDR signing
│       ├── src/
│       │   ├── simulate.ts                 # anvil fork execution
│       │   ├── policy.ts                   # policy evaluation
│       │   ├── sign.ts                     # PDR EIP-191 signing
│       │   └── server.ts
├── agents/                        # Agent Studio v2 runtimes
│   ├── rebalancing/
│   ├── grid-trading/
│   ├── yield-routing/
│   └── health-factor/
├── contracts/                     # Foundry
│   ├── src/
│   │   ├── PolicyAttestedExecutor.sol
│   │   ├── KhorosRegistry.sol              # marketplace listing metadata
│   │   └── interfaces/
│   ├── test/
│   └── script/
├── packages/
│   ├── core/                      # shared types, category definitions
│   ├── scoring/                   # the trust math, used by indexer + tests
│   └── ui/                        # design tokens, shared primitives
└── bench/                         # TermiX harness
    ├── tasks/
    │   ├── lp-range-recovery.ts
    │   ├── venus-liquidation-defense.ts
    │   └── yield-migration.ts
    └── report/
```

---

## Request flows

### Flow A — Load a category arena

```
browser → GET /arena/rebalancing
  → server component reads Postgres view `agent_rankings`
    (precomputed: pruned score, ROI, drawdown, latency, sparkline points)
  → renders staves server-side, streams
  → client hydrates only the prune toggle and sort controls
```

Nothing in this path calls the chain or 8004scan. If the indexer is down the arena
still renders, with a staleness marker. Target: under 400ms to first byte.

### Flow B — Parse an intent

```
browser → POST /api/intent { text }
  → classify against category schema
  → extract params via structured extraction
  → return { categories, params, confidence, restated }
  → client shows restatement, then queries /api/agents with the parsed filter
```

Keep the classifier swappable. Start with a deterministic keyword-plus-schema
matcher so the demo never depends on an external model being up, and layer an LLM
call behind it for free-form text. The deterministic path must handle all four
seed chips perfectly.

### Flow C — Hire an agent

```
browser → hire form submit
  1. ensure Altana account
       altana.createAccount({ passkey }) if none exists
  2. build session scope from form + agent manifest
       calls:    [PancakeSwapV3PositionManager]
       selectors:[mint, decreaseLiquidity, collect]
       spend:    { token: USDT, limit, period: "day" }
       expiry:   now + 7d
  3. altana.grantSession({ ..., register: true })   → tx 1, KeyStore
  4. bnbagent.createJob({ provider, budget, evaluator })  → tx 2, escrow
  5. persist { agentId, sessionKey, jobId, scope } to Postgres
  6. notify agent runtime that a new engagement exists
```

The session scope shown in the permissions preview must be the same object passed
to `grantSession`. Derive the English rendering from the object — never write the
copy separately, or they will drift.

### Flow D — Agent executes an action

```
agent runtime detects trigger (price drift / HF breach / yield spread)
  → builds TransactionIntent
  → POST verifier /simulate { intent, policyHash, sessionKey }
      verifier forks BSC at current block
      executes the calldata against the fork
      evaluates: target allowlisted? selector allowlisted? spend within cap?
                 slippage within bound? session unexpired? invariants hold?
      on pass  → sign PDR, return { pdr, simulationReport }
      on fail  → return { rejected, reason } and log it visibly
  → agent submits { intent, pdr, payload } to PolicyAttestedExecutor
      via Altana session key, gas sponsored by MegaFuel
  → executor verifies signature, nonce, hash binding → calls target protocol
  → telemetry written; dashboard SSE pushes to any watching client
```

Rejected simulations are a feature, not an error. Surface them in the dashboard as
"blocked before execution" — it is the clearest possible demonstration that the
safety layer works.

### Flow E — Settle

```
agent submits deliverable attestation → EvaluatorRouter
  → optimistic window opens
  → window elapses without challenge
  → escrow releases to agent wallet via x402
  → feedback written to ERC-8004 Reputation Registry with the settled payment hash
  → indexer picks it up next cycle; the payment hash gives the review real weight
```

The loop closes here: payment-backed reviews are exactly the reviews that survive
pruning, so the marketplace's own settlements strengthen its own trust signal.

---

## Data stores

**Postgres** holds the read models. Everything the web app renders comes from here.

**Redis** caches the ranked lists per category with the prune flag as part of the
key, and holds the SSE fan-out for live telemetry.

**On-chain is the source of truth** for identity, reputation, sessions, jobs, and
settlement. Postgres is a derived, rebuildable cache. Any table must be
reconstructible by replaying the indexer from genesis. Never store state in
Postgres that exists nowhere else.

---

## Environments

| Env | Chain | Purpose |
|-----|-------|---------|
| Local | anvil fork of BSC | Development, contract tests, verifier fork target |
| Testnet | BSC Testnet (97) | All live execution, sessions, jobs, benchmark runs |
| Read | BSC Mainnet (56) | Agent registry and reputation data only, never writes |

Reading real mainnet agent data while executing on testnet is deliberate: the
marketplace shows the real 200k-agent ecosystem, while execution stays safe and
faucet-funded. Label this clearly in the UI so it reads as a choice, not a bug.

---

## Failure posture

| Dependency down | Behaviour |
|-----------------|-----------|
| 8004scan API | Arena serves last-good rankings with a staleness badge |
| Indexer | Same; scores freeze, nothing breaks |
| Verifier | Agents stop executing. This is correct — no PDR, no action |
| RPC | Read paths use cached models; write paths surface a clear retry |
| Altana | Hire flow blocks with an explicit message; existing sessions unaffected |

The system is designed so that every failure degrades toward *doing nothing*
rather than toward *acting without checks*.

---

## Performance targets

| Path | Target |
|------|--------|
| Arena first byte | < 400 ms |
| Intent parse round trip | < 800 ms |
| PACE simulation | < 500 ms p95 |
| Trigger to on-chain inclusion | < 1 BSC block after simulation |
| Indexer full cycle | < 10 min for the BSC agent set |
