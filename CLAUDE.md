# Khoros

> The canonical front door for AI agents on BNB Smart Chain.

Khoros is an intent-driven agent marketplace. A user describes a financial
goal in plain language, Khoros matches them to verified on-chain agents across
four DeFi categories, and they hire one in a few clicks — with self-custodial
wallets, scoped permissions, and a track record they can actually trust.

The name is from *khoros* (χορός), a chorus: many voices performing in
coordination under one conductor. The user is the conductor. The agents are the
chorus. That metaphor runs through the product and the visual design.

---

## Read this first

This file is the entry point. Before doing substantial work, read the doc that
covers your task:

| Doc | Read it when you are working on |
|-----|--------------------------------|
| `docs/01-PRODUCT_SPEC.md` | User journeys, screens, copy, acceptance criteria |
| `docs/02-ARCHITECTURE.md` | Repo layout, services, request flows, deployment |
| `docs/03-AGENT_CATEGORIES.md` | The four agent types and their strategy logic |
| `docs/04-TRUST_SCORING.md` | Sybil pruning, reputation math, ranking |
| `docs/05-PACE_SAFETY.md` | Policy simulation, PDR signing, the executor contract |
| `docs/06-INTEGRATIONS.md` | Altana, 8004scan, BNB Agent Studio, PancakeSwap, Venus, Lista |
| `docs/07-DATA_MODEL.md` | Types, schemas, database tables, API contracts |
| `docs/08-DESIGN_SYSTEM.md` | Palette, type, layout, component rules |
| `docs/09-BENCHMARK_HARNESS.md` | The TermiX Agent Advantage Report engine |
| `docs/10-BUILD_PLAN.md` | Phase order, dependencies, definition of done |
| `docs/11-SUBMISSION_CHECKLIST.md` | Every hackathon requirement, track by track |

Do not read all of them at once. Read `02-ARCHITECTURE.md` plus the one that
matches the task.

---

## What we are building, in one page

**The problem.** BNB Smart Chain has ~200,000 agents registered under ERC-8004 —
more than any other network. There is no place to find them, compare them, or
hire them. They are uncoordinated scripts with no verifiable track record. Capital
cannot flow to them because nobody can tell a good agent from a predatory one.

**The product.** Khoros has seven layers:

1. **Intent front door.** One input: "What's your financial goal?" A parser maps
   plain language to one or more of the four agent categories and returns ranked
   matches. No browsing required, but browsing still works.

2. **Sybil-pruned arena.** Live leaderboards per category. Agents ranked by a
   payment-weighted Beta reputation score that discards circular wash-ratings.
   A visible toggle shows raw vs. pruned scores so the filtering is legible.

3. **Four first-class categories.** Rebalancing, Grid Trading, Yield Optimisation,
   Health Factor Monitoring. Identical depth in UI, data, and strategy logic.
   Treating one as the main event and the rest as garnish is an explicit
   scoring failure.

4. **Altana control center.** Passkey-provisioned smart accounts. Scoped session
   keys registered on-chain in the Altana KeyStore. A permissions panel in plain
   language and a one-transaction revoke.

5. **PACE safety layer.** Every agent action is simulated against forked chain
   state and signed into a Policy Decision Record before it can execute. A
   compromised agent planner produces no valid PDR and therefore no transaction.

6. **ERC-8183 commerce.** Escrowed hiring. For multi-category intents, a
   coordinator agent hires specialist sub-agents through escrowed sub-jobs.

7. **Agent Advantage benchmark.** A live in-product engine that runs the same
   task manually and via agent, and reports latency, gas, cost, and outcome
   quality with verifiable transaction hashes.

**Who judges this.** Four independent panels: BNB Chain (main track),
TermiX, Altana, PancakeSwap. Every feature above maps to at least one rubric.
See `docs/11-SUBMISSION_CHECKLIST.md`.

---

## Non-negotiable rules

These are not preferences. Breaking one costs a track.

1. **Four categories, equal depth.** Every category gets the same number of
   metrics, the same card layout, the same detail page sections, the same
   strategy documentation. If you add a chart to one, add the equivalent to all
   four. Audit this before every commit that touches category UI.

2. **Never display raw reputation as the default.** Default ranking is always the
   pruned score. Raw is available behind a toggle, labelled as unfiltered.

3. **The agent never holds a raw private key.** All execution goes through an
   Altana session key with a call allowlist, a selector allowlist, a spend cap,
   and an expiry. There is no code path where an agent signs with an EOA key.

4. **No transaction executes without a valid PDR.** The on-chain executor reverts
   unsigned or mismatched intents. Do not add a bypass, not even behind a flag.

5. **Never fabricate performance numbers.** Benchmark results, ROI figures, and
   latency measurements come from real runs with real transaction hashes. TermiX
   judges will hire from the marketplace and check. A fabricated number that gets
   caught costs more than a modest real one.

6. **Testnet is fine, fake is not.** BSC Testnet (chain 97) transactions count for
   every track. Mocked transactions count for nothing. If a flow cannot reach the
   chain yet, mark it clearly as not-yet-live rather than faking a hash.

7. **Every claim links to a verifier.** Agent identity links to 8004scan. Sessions
   link to the Altana Explorer. Transactions link to BscScan. A judge should be
   able to independently confirm anything the UI asserts.

8. **Public and functional during judging.** The deployment must be reachable
   without a login, on mobile and desktop, for the whole judging window.

---

## Stack

| Concern | Choice |
|---------|--------|
| App | Next.js 14 App Router, TypeScript strict |
| Styling | Tailwind, tokens from `docs/08-DESIGN_SYSTEM.md` |
| Chain reads | viem, BSC mainnet (56) for data, testnet (97) for execution |
| Agent registry | 8004scan Pro API + direct ERC-8004 registry reads |
| Agent wallets | `@altananetwork/sdk` — Passkeys, sessions, KeyStore |
| Agent commerce | `@bnbagent/sdk` — ERC-8183 jobs, x402 settlement |
| Agent runtime | BNB Agent Studio v2 (`bag init`), MegaFuel paymaster |
| DeFi | PancakeSwap V3, Venus, Lista DAO, Aave V3 |
| Contracts | Foundry, Solidity 0.8.24 |
| Persistence | Postgres (Neon/Supabase) + Redis for the score cache |
| Deploy | Vercel (app), Railway or Fly (indexer + verifier) |

---

## Conventions

**TypeScript.** Strict mode on. No `any` in committed code — use `unknown` and
narrow. Money is `bigint` in base units, never `number`. Every value that crosses
a chain boundary carries its decimals with it.

**Naming.** Chain-facing types use protocol vocabulary (`agentId`, `jobId`,
`sessionKey`). User-facing copy never does — the UI says "trust score", not
"pruned Beta reputation vector".

**Errors.** Chain calls, API calls, and simulations all fail routinely. Every one
returns a typed result rather than throwing into the void. UI states are
`idle | loading | ready | empty | error`, and `empty` and `error` are designed,
not afterthoughts.

**Commits.** Conventional commits. Scope by layer: `feat(arena):`,
`fix(altana):`, `docs(spec):`.

**Testing.** Contracts get Foundry tests including the revert paths. The scoring
engine gets unit tests with a fixture of known Sybil clusters. The four agent
strategies get deterministic tests against recorded chain state.

---

## Current status

Update this section as you go. It is how a fresh session knows where things stand.

- [x] Phase 0 — repo scaffold, tokens, CI
- [~] Phase 1 — indexer + trust scoring *(scoring engine, schema, classifier and registry reader done; live ingest cycle + 8004scan key pending)*
- [x] Phase 2 — marketplace UI, four categories *(front door, arena, prune choreography, profile, hire, /verify — equal depth enforced by 43 tests)*
- [~] Phase 3 — Altana sessions + control center *(SDK verified against live testnet, grant/revoke/dashboard/revoke UI done; blocked on faucet funding)*
- [x] Phase 4 — agent runtimes *(harness + all four strategies, 42 tests; live execution blocked on funding)*
- [~] Phase 5 — PACE verifier + executor *(contract 23 tests, policy evaluator 49 tests, digest cross-checked; fork simulation + deploy pending)*
- [ ] Phase 6 — ERC-8183 hiring + coordinator
- [~] Phase 7 — benchmark harness *(types, recorder CLI, /benchmark surface done; no runs recorded yet)*
- [~] Phase 8 — polish, deploy, submission *(README + limitations, honesty audit clean; deploy pending)*

See `docs/10-BUILD_PLAN.md` for what each phase means and when it is done.
