# 10 — Build Plan

## Ordering principle

Build in the order that maximises what survives if you run out of time. Every phase
ends with something deployable and demonstrable. If the build stops after any
phase, what exists should still be a coherent product rather than a half-wired
prototype.

The riskiest integrations (Altana sessions, ERC-8183) come before the most
sophisticated ones (PACE, coordinator), because a blocked integration discovered
late is fatal and a missing sophistication is survivable.

**Access to acquire on day one, before any code:**

- 8004scan Pro API key — apply through the Pro-Tier Upgrade Form, it is not instant
- BSC Testnet BNB from the faucet
- Altana testnet access and SDK version check
- Confirm `@bnbagent/sdk` version and the ERC-8183 deployment addresses on chain 97

---

## Phase 0 — Foundation

**Goal:** an empty but correct repo that deploys.

- pnpm workspace, Turborepo, TypeScript strict across all packages
- `packages/core` with the category constants and shared types from `07-DATA_MODEL.md`
- `packages/ui` with the tokens from `08-DESIGN_SYSTEM.md`, fonts loaded, the
  `Stave` primitive rendering static data
- `apps/web` scaffolded, deploying to Vercel on push
- Postgres and Redis provisioned, migrations runner wired
- Foundry project initialised, CI running `forge test` and `tsc --noEmit`
- `.env.example` complete

**Done when:** a placeholder arena page with three hardcoded staves is live at a
public URL and CI is green.

---

## Phase 1 — Data and trust

**Goal:** real BNB Chain agents, honestly scored. This is the main track's data
quality criterion and everything downstream depends on it.

- 8004scan ingest with cursor pagination and backoff
- Direct ERC-8004 registry reads via viem as fallback and cross-check
- Category classification from registration files, with `uncategorised` for
  ambiguous matches
- Feedback enrichment: settlement matching, reviewer age, tx count
- Cluster detection and `ClusterCorrelation`
- Weighting and Beta aggregation per `04-TRUST_SCORING.md`
- Performance rollups for the six metric slots
- `agent_rankings` materialised view, refreshed each cycle
- The scoring test suite including the Sybil fixture

**Done when:** the database holds real BSC agents across all four categories with
computed pruned and raw scores, and `pnpm test --filter scoring` passes including
the fixture tests.

**Watch for:** classification is the quiet risk here. If most agents land in
`uncategorised`, the arenas will be empty. Budget time to iterate on the matching
rules against real registration files, and be willing to hand-curate a seed set of
known-good agents per category so no arena is empty during judging.

---

## Phase 2 — The marketplace

**Goal:** the whole browse-and-compare experience, four categories at equal depth.

- Front door: intent input, four seed chips, categories visible without scrolling
  past decoration
- Intent parser — deterministic matcher first, handling all four chips perfectly;
  LLM path behind it for free text
- Arena index and per-category arenas reading from `agent_rankings`
- The prune toggle with its reorder choreography and the discarded-count copy
- Agent profile with all sections and `VerifyLink` on every external claim
- `/verify` methodology page
- Empty and error states designed for every surface
- Mobile down to 320px, keyboard operable, focus visible

**Done when:** a stranger can land, type an intent, reach a ranked list, open a
profile, and understand what the agent does — with no dead ends and no lorem.
Run the equal-depth audit: four arena rows and four profiles side by side.

---

## Phase 3 — Altana custody

**Goal:** the Altana track's mandatory criteria, all five, visible in the UI.

- Passkey account provisioning
- Session scope construction per category from the hire form
- `grantSession` with `register: true`, capturing the KeyStore transaction
- `describeScope()` driving the permissions preview — single source of truth
- Dashboard control center with active sessions
- Session detail page with the live transaction feed
- Revoke, with the resulting revert visible in the feed afterwards
- Altana Explorer links everywhere a session appears

**Done when:** a session can be granted and revoked end to end on testnet, both
transactions are visible in the Altana Explorer, and the permissions copy in the
hire flow matches the registered scope exactly.

**Watch for:** this is the phase most likely to surprise you. Verify the SDK's
session shape against the live testnet deployment early — before building the form
around an assumed API.

---

## Phase 4 — Agent runtimes

**Goal:** four agents that actually do their jobs on testnet.

- `bag init` scaffold per category, TypeScript
- Shared harness in `packages/core`: trigger loop, intent construction, telemetry
- Rebalancing: position monitoring, range calculation, the four-call sequence
- Grid: ladder construction, level crossing detection, fill recording
- Yield: multi-protocol APY reads, allocation optimisation, break-even horizon
- Health factor: HF derivation, VaR projection, the response ladder
- MegaFuel gas sponsorship
- Telemetry emission for triggered, executed, and blocked

**Done when:** each of the four has executed at least one real action on BSC
Testnet through its Altana session, with the transaction visible in the dashboard.

**Sequencing note:** build health factor and rebalancing first. They are the two
benchmark tasks in high-stakes categories, so they are on the critical path for
TermiX.

---

## Phase 5 — PACE

**Goal:** the safety layer, and the blocked-action feed that proves it works.

- `PolicyAttestedExecutor.sol` with the full Foundry test suite from
  `05-PACE_SAFETY.md`, deployed to testnet
- Verifier service: anvil fork simulation, policy evaluation, PDR signing
- Per-category policy definitions and invariants
- Runtime integration — no execution path that skips the verifier
- Blocked actions rendered in the dashboard with the failing invariant and observed
  value
- Verifier key in a KMS, not an env var

**Done when:** an intent that violates a policy is rejected with a legible reason
shown in the UI, and every revert test in the contract suite passes.

**Deliberately induce a block for the demo.** Configure a test engagement with a
tight slippage cap and let it reject a real action. A dashboard showing "blocked
before execution, here's why" is the clearest possible evidence the layer is real.

---

## Phase 6 — Commerce

**Goal:** escrowed hiring, and the coordinator that earns the Altana bonus.

- ERC-8183 `createJob` / `fundJob` in the hire flow
- Deliverable submission and optimistic settlement
- x402 settlement to agent wallets
- Feedback written back to the reputation registry with the settlement hash —
  closing the loop into trust scoring
- Coordinator agent: parent job, sub-jobs, per-specialist session scoping, shared
  capital constraint
- Live cascade rendering in the UI
- b402 seller side on the trust score and benchmark endpoints

**Done when:** a two-category intent produces a parent job and two sub-jobs on
testnet, each verifiable, and a settled job's payment hash appears as weight behind
a review in the trust score.

---

## Phase 7 — Benchmark

**Goal:** the TermiX report, real numbers.

- Manual branch recorder CLI
- Three task harnesses
- Multiple runs of each, committed to `bench/runs/`
- `/benchmark` surface with paired comparisons and `VerifyLink` on every hash
- PDF export
- Direct hire path from each task to the agent used

**Done when:** three tasks have been run both ways with real transactions, the
page renders them with honest sample sizes, and a judge can hire the benchmarked
agent from that page.

**Start the runs early.** Do not leave this to the end — the manual branches take
real wall-clock time and the liquidation task needs several runs to produce a
useful distribution.

---

## Phase 8 — Submission

**Goal:** everything a judge touches is polished and everything they check is true.

- Full pass on `11-SUBMISSION_CHECKLIST.md`
- Equal-depth audit across all four categories, final
- Every external claim resolves to a verifier
- Public deployment, no login, mobile and desktop, stable for the judging window
- Demo video: intent → compare → hire → session → agent acts → blocked action →
  revoke, in that order
- README with architecture, setup, and the honest limitations section
- Wallet addresses included in the submission (Altana track requires this)
- Agent Advantage Report PDF attached

---

## Definition of done, for any task

A task is not done until:

1. It works against real testnet state, not mocks
2. It handles its failure paths with designed states
3. It is keyboard operable and readable at 320px
4. Its claims link to a verifier
5. If it touches a category surface, all four categories were checked
6. It has a test where a test is meaningful
7. `CLAUDE.md` status is updated

---

## Standing risks

| Risk | Mitigation |
|------|-----------|
| 8004scan Pro key delayed | Apply day one; direct registry reads as fallback |
| Most agents land uncategorised | Iterate matching early; hand-curate a seed set per category |
| Altana SDK differs from docs | Verify against live testnet in phase 0, not phase 3 |
| ERC-8183 addresses unclear on 97 | Confirm early; the coordinator is bonus, not mandatory — cut it before cutting mandatory criteria |
| Verifier latency blows the 1-block target | Warm fork pool; cache state between simulations |
| An arena is empty at judging | Seed set per category, and empty states that invite rather than apologise |
| Benchmark runs left too late | Start phase 7 runs during phase 5 |
