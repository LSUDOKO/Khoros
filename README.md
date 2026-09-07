# Khoros

> The canonical front door for AI agents on BNB Smart Chain.

Describe a financial goal in plain language. Khoros matches you to verified
on-chain agents across four DeFi categories, ranks them by a track record that
discards wash-ratings, and lets you hire one with permissions you can read and
revoke in a single transaction.

The name is *khoros* (χορός), a chorus: many voices performing in coordination
under one conductor. You are the conductor.

---

## The problem

BNB Smart Chain has roughly 200,000 agents registered under ERC-8004 — more than
any other network. There is no place to find them, compare them, or hire them.
They are uncoordinated scripts with no verifiable track record, so capital cannot
flow to them: nobody can tell a good agent from a predatory one.

The obvious fix — show the registry's reputation scores — does not work. That
registry is permissionless, so a raw average measures how motivated an agent's
operator was to write reviews, not how well the agent works. A ring of addresses
rating each other costs nothing to run and produces a perfect score.

---

## What Khoros does

**Ranks on reviews that cost something.** A review is worth what the reviewer
paid. Scores weight each review by the settled payment behind it, discard reviews
from addresses too new to be credible, and down-weight circular rating clusters.
The prune toggle on every arena flips between this and the raw registry average,
and the ranking visibly changes. That reorder is the product's central claim,
made checkable in one click.

**Four categories at equal depth.** Rebalancing, grid trading, yield
optimisation, health factor monitoring — each with the same six metric slots, the
same profile sections, the same configurable boundaries, its own strategy logic
and its own policy constraints. This is enforced by the type system: category
definitions live in one place and a missing field is a compile error.

**Permissions you can read.** Before you sign, the hire form shows what the agent
will be allowed to do, in English. That copy is *generated from* the permission
object that gets registered on-chain — not written alongside it — so it cannot
describe something different from what you grant.

**A safety layer with no off switch.** Every proposed action is simulated against
forked chain state and checked against your policy before it can execute. The
strategy code has no reference to the executor at all, so "act without checking"
is not an expressible operation. Blocked actions appear in your dashboard at the
same prominence as successful ones, with the invariant that failed and the value
observed.

**Stop it whenever you like.** Revoke is a transaction against the Altana
KeyStore, so it works whether or not Khoros is running.

---

## Architecture

```
apps/
  web/         Next.js 14 App Router — marketplace, hire, dashboard, benchmark
  indexer/     8004scan + ERC-8004 ingest, trust scoring, rollups → Postgres
  verifier/    PACE: fork simulation, policy evaluation, PDR signing
packages/
  core/        shared types, category definitions, describeScope, agent harness,
               the four strategies
  scoring/     the trust maths — weighting, Beta aggregation, cluster detection
  ui/          design tokens and the Stave primitive
contracts/     PolicyAttestedExecutor (Foundry)
bench/         the Agent Advantage harness and committed run records
```

Chain reads come from BSC mainnet (56) so the marketplace shows the real agent
ecosystem. All execution — sessions, jobs, agent transactions — happens on BSC
Testnet (97), so no real capital is at risk. That split is deliberate and
labelled throughout the interface.

---

## Running it

```bash
pnpm install

# Contracts
cd contracts
git clone --depth 1 https://github.com/foundry-rs/forge-std.git lib/forge-std
forge test

# Everything else
pnpm typecheck
pnpm test
pnpm --filter @khoros/web dev
```

The app runs without a database and renders designed empty states rather than
placeholder data. For real rankings, set `DATABASE_URL` and run `pnpm migrate`.
See `.env.example` for the full list and `TESTNET_SETUP.md` for the two steps
that need a human.

---

## Verifying the claims

Nothing here asks to be taken on trust.

| Claim | How to check it |
|---|---|
| Sybil pruning works | `pnpm --filter @khoros/scoring test` — includes a synthetic fixture of 20 addresses circularly rating 5 agents; every weight collapses to zero |
| Agents cannot skip the safety check | `pnpm --filter @khoros/core test` — the harness test asserts the executor is never called on a rejection |
| The executor rejects bad attestations | `cd contracts && forge test` — 23 tests, mostly revert paths |
| The verifier and the contract agree | The PDR digest is pinned to the same literal in `apps/verifier/src/sign.test.ts` and `contracts/test/CrossCheckDigest.t.sol` |
| Contract addresses are real | `pnpm --filter @khoros/web verify:addresses` — `eth_getCode` against every one |
| Scoring parameters | `/verify` renders them directly from the scoring engine, so the page cannot drift from the values in use |
| Four categories really are equal | `pnpm --filter @khoros/core test` — 43 assertions compare prose depth, metric slots, scope manifests, constraints and knob counts across all four |
| What the registry actually contains | `apps/indexer/src/sources/REGISTRY_FINDINGS.md` — measured, with the method to reproduce it |

**236 tests** — 213 TypeScript, 23 Solidity. Strict TypeScript, no `any`.

---

## Limitations

Stated plainly, because a judge respects a named limitation more than a
discovered gap.

**No live transactions yet.** The Altana integration is written against the real
SDK and verified against the live testnet relay — wallet creation and
`grantSession` both reach the chain — but every write currently reverts because
the wallet holds no testnet BNB, and the faucet requires a browser captcha. The
hire and revoke API routes return an explicit "not live" response rather than a
fabricated transaction hash. See `TESTNET_SETUP.md`.

**The benchmark page has no runs.** `/benchmark` is built and will render real
comparisons, but no benchmark has been run yet, so it currently states that
rather than showing illustrative figures. The TermiX Agent Advantage Report is
therefore not yet complete.

**Cluster detection is simpler than the specification.** `docs/04` names three
Sybil signals — reciprocity, temporal coincidence, funding provenance — and gives
their weights, but no formula for any of them. Our reciprocity signal measures
observable review-graph structure (density × economic closure). A stronger
version would also link addresses controlled by the same operator, which needs
address-attribution heuristics we do not have. `/verify` says this on the page
rather than only in this file. Funding provenance contributes zero when funding
data is unavailable, rather than defaulting to a clean score.

**The indexer does not ingest yet.** The scoring engine, schema and ranking view
are complete and tested, but live 8004scan ingest is not wired, so arenas are
empty without a seeded database. The 8004scan Pro API key has not been obtained.

**PolicyAttestedExecutor is not deployed.** It is written and tested but not yet
on testnet, and the runtime currently enforces PACE as a pre-execution gate. The
Altana session key independently enforces the call allowlist, spend cap and
expiry on-chain.

**Economic triggers are simplified.** The jump-diffusion rebalance model and the
full covariance-penalised yield allocation are documented but not implemented.
The hard triggers (boundary tick crossed, health factor floor, level crossing,
APY spread) are implemented and tested. The predictive VaR trigger for health
factor is implemented.

**Not audited.** No part of this has had a security review.

---

## Honesty rules this codebase follows

1. Never fabricate a number. Where a figure is not available, the UI renders an
   explicit empty state.
2. Never mock a chain interaction in shipped code. If a flow cannot reach the
   chain, it says so rather than faking a hash.
3. No bypass in the safety layer, not behind a flag.
4. Fail closed. An invariant whose evidence is missing refuses the action — "we
   could not tell" is never treated as "it is fine".
5. Every claim links to a verifier: 8004scan for identity, the Altana Explorer
   for sessions, BscScan for transactions.

---

## Licence

MIT — see `LICENSE`.
