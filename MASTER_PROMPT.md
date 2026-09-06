# Prompts for Claude Code

How to use this file: copy the **kickoff prompt** into a fresh Claude Code session
in the repo root. Then run the phase prompts one at a time, each in its own
session, in order. Do not paste more than one phase at a time — long sessions drift
and the phase boundaries exist so each one ends somewhere deployable.

---

## Kickoff prompt

> I'm building **Khoros**, an intent-driven AI agent marketplace for BNB Smart
> Chain. It's a hackathon submission for BNB Chain's "Build the Era", competing for
> the $30,000 main track plus three partner bounties (TermiX $6,000, Altana 50,000
> XP, PancakeSwap 1,000 CAKE). The winning main-track submission gets adopted as
> the official BNB Agent Studio marketplace, so this needs to be production-grade,
> not a demo.
>
> The full specification is in this repo. Read `CLAUDE.md` first — it's the entry
> point and it indexes eleven docs in `docs/`. Then read `docs/02-ARCHITECTURE.md`
> and `docs/10-BUILD_PLAN.md`.
>
> Before writing any code, do three things and report back:
>
> 1. Tell me what you understand the product to be, in your own words, in about
>    150 words. I want to check the spec actually transferred.
> 2. List anything in the docs that's ambiguous, contradictory, or that you think
>    is wrong. Push back on it. I'd rather fix a bad decision now than build on it.
> 3. Verify the external dependencies are real and current before we design around
>    them. Specifically check: the current `@altananetwork/sdk` session API shape,
>    the `@bnbagent/sdk` ERC-8183 interface and its deployment addresses on BSC
>    Testnet (chain 97), and the 8004scan API endpoints and auth. Use web search
>    and the actual package docs. If any of them differ from what the docs assume,
>    tell me before we build around a wrong assumption.
>
> Don't start Phase 0 until I confirm.

---

## Standing rules to give Claude Code

Paste these once at kickoff. They hold for the whole build.

> **Rules for this project, in force for every session:**
>
> **Never fabricate a number.** No placeholder metrics presented as measured, no
> estimated benchmark results, no invented ROI. If a value isn't available yet,
> render an explicit empty state. TermiX judges will hire agents from this
> marketplace and compare results against our claims; a fabricated number that gets
> caught costs more than an unimpressive real one.
>
> **Never mock a chain interaction in shipped code.** Mocks are fine in tests. In
> the app, if a flow can't reach the chain yet, say so in the UI rather than faking
> a transaction hash.
>
> **Never add a bypass to the PACE verifier.** There will be a moment where a
> policy blocks a legitimate action and a skip flag looks like the fast fix. Don't.
> A safety layer with an off switch isn't a safety layer.
>
> **The four agent categories get equal depth, always.** Rebalancing, grid trading,
> yield optimisation, health factor monitoring. If you add a metric, chart, or
> section to one, add the equivalent to all four in the same commit. The rubric
> explicitly penalises submissions that treat one category as the main event.
>
> **Every claim links to a verifier.** Agent identity to 8004scan, sessions to the
> Altana Explorer, transactions to BscScan. If the UI asserts something, a judge
> must be able to check it in one click.
>
> **Follow the design system in `docs/08-DESIGN_SYSTEM.md` exactly.** It's a
> deliberate visual direction — the stave layout, Spectral and Archivo, the
> verdigris/brass/madder palette. Don't substitute a card grid, don't reach for
> Inter, don't add gradient washes or drop shadows. If something in it doesn't work
> in practice, tell me and we'll change the doc rather than drifting from it.
>
> **TypeScript strict, no `any`.** Money is `bigint` in base units. Timestamps are
> `bigint` unix seconds at chain boundaries.
>
> **Ask before assuming.** If a spec detail is missing or an SDK behaves differently
> than the docs describe, stop and tell me. Don't invent an interface and build on
> it.
>
> **Update the status block in `CLAUDE.md`** at the end of every phase.

---

## Phase prompts

Run these in order, one session each. Each references the docs rather than
restating them, so the specification stays in one place.

### Phase 0 — Foundation

> Build Phase 0 from `docs/10-BUILD_PLAN.md`.
>
> Set up the monorepo: pnpm workspaces, Turborepo, TypeScript strict everywhere.
> Create `packages/core` with the shared types from `docs/07-DATA_MODEL.md` and
> `packages/ui` with the design tokens from `docs/08-DESIGN_SYSTEM.md` — palette,
> Spectral and Archivo loaded, the type scale, and a `Stave` component rendering
> hardcoded placeholder data so I can see the visual direction early.
>
> Scaffold `apps/web` as Next.js 14 App Router, deploying to Vercel. Provision
> Postgres and Redis, wire a migrations runner. Initialise Foundry. CI runs
> `forge test` and `tsc --noEmit` on push. Write a complete `.env.example`.
>
> Done when a placeholder arena page with three staves is live at a public URL and
> CI is green. Show me the URL and a screenshot of the stave before moving on — I
> want to check the visual direction lands before we build the rest on top of it.

### Phase 1 — Data and trust

> Build Phase 1. Read `docs/04-TRUST_SCORING.md` fully first — this phase is
> almost entirely that document.
>
> Build the indexer: 8004scan ingest with cursor pagination and backoff, direct
> ERC-8004 registry reads via viem as fallback and cross-check, category
> classification from registration files. Then the trust pipeline — feedback
> enrichment, cluster detection, weighting, Beta aggregation, demand index,
> confidence intervals. Then the performance rollups for the six metric slots and
> the `agent_rankings` materialised view.
>
> Write the scoring tests including the synthetic Sybil fixture described in that
> doc. Those tests are also our evidence during judging that the pruning works, so
> make them legible.
>
> One thing to watch: category classification is the quiet risk. If most agents
> land in `uncategorised`, every arena will be empty. Report the classification
> distribution when you're done, and if it's bad, we'll iterate on the matching
> rules before moving on.

### Phase 2 — Marketplace

> Build Phase 2 — the full browse and compare experience.
>
> Front door with the intent input and four seed chips per `docs/01-PRODUCT_SPEC.md`.
> Build the intent parser as a deterministic matcher first that handles all four
> chips perfectly, with an LLM path behind it for free text — the demo must not
> depend on an external model being up.
>
> Arena index and per-category arenas from `agent_rankings`. The prune toggle with
> its reorder animation — that's the one piece of choreography in the product, per
> the design system, so make it land. Agent profiles with `VerifyLink` on every
> external claim. The `/verify` methodology page.
>
> Design the empty and error states, don't default them. Mobile to 320px, keyboard
> operable, visible focus.
>
> When you're done, run the equal-depth audit: screenshot all four arena rows and
> all four profiles side by side and tell me honestly whether any category looks
> thinner than the others.

### Phase 3 — Altana

> Build Phase 3. Read `docs/06-INTEGRATIONS.md`, the Altana section, and the Altana
> checklist in `docs/11-SUBMISSION_CHECKLIST.md` — all five mandatory criteria have
> to be visible in the UI, not just present in code.
>
> Before building the form, verify the live SDK against BSC Testnet: confirm the
> actual shape of `grantSession`, that `register: true` writes to the KeyStore, and
> what the revoke call looks like. If it differs from the doc, tell me first.
>
> Then: Passkey account provisioning, session scope construction per category from
> the hire form, `grantSession` with KeyStore registration, and `describeScope()`
> as the single source of the permissions copy — derive the English from the scope
> object, never write it separately or the two will drift and the UI will lie.
>
> Dashboard control center, session detail with live feed, revoke with the
> resulting revert visible afterwards. Altana Explorer links everywhere a session
> appears.
>
> Done when a session is granted and revoked on testnet and both transactions are
> visible in the Altana Explorer. Send me the explorer links.

### Phase 4 — Agent runtimes

> Build Phase 4 — the four agent runtimes. `docs/03-AGENT_CATEGORIES.md` has the
> strategy logic for each.
>
> Scaffold with `bag init` per category, TypeScript. Build the shared harness in
> `packages/core` first — trigger loop, intent construction, verifier call,
> telemetry emission — then the four strategies on top of it.
>
> Build health factor and rebalancing first. They're the two benchmark tasks in
> TermiX's high-stakes categories, so they're on the critical path.
>
> Wire MegaFuel gas sponsorship. Emit telemetry for triggered, executed, and
> blocked — blocked matters as much as executed, it feeds the dashboard evidence.
>
> Done when each of the four has executed a real action on BSC Testnet through its
> Altana session, visible in the dashboard. Send me the four transaction hashes.

### Phase 5 — PACE

> Build Phase 5 — the safety layer. `docs/05-PACE_SAFETY.md` has the contract and
> the verifier design.
>
> Start with `PolicyAttestedExecutor.sol` and its full Foundry suite. The revert
> tests matter more than the happy path — reused nonce, wrong signer, mutated
> payload, selector swap, foreign chainid, malleable signature, reentrant replay.
> All ten from the table. Deploy to testnet.
>
> Then the verifier service: anvil fork simulation, policy evaluation as a pure
> function of state diff and policy, PDR signing. Per-category policies and
> invariants. Wire it into the runtimes with no path that skips it.
>
> Render blocked actions in the dashboard with the failing invariant and the
> observed value.
>
> Then deliberately induce a block for the demo — set up a test engagement with a
> tight slippage cap and let it reject a real action. A dashboard showing "blocked
> before execution, here's why" is the clearest evidence this layer is real.
>
> Verifier key goes in a KMS, not an env var.

### Phase 6 — Commerce

> Build Phase 6 — ERC-8183 escrowed hiring and the coordinator.
>
> `createJob` and `fundJob` in the hire flow, deliverable submission, optimistic
> settlement, x402 payout. Then write feedback back to the reputation registry with
> the settlement hash — that closes the loop, because payment-backed reviews are
> exactly the ones that survive our pruning.
>
> Then the coordinator for multi-category intents: parent job, sub-jobs per
> specialist, each with its own session scoped to its own slice of capital so two
> agents can't spend the same dollar. Use `hireErc8183Agent` from the Altana
> ERC-8183 SDK — the bonus criterion names it specifically.
>
> Render the cascade live in the UI. Parent funded, sub-job posted, accepted,
> delivered, settled, with a transaction link at each step. A judge watching that
> happen is worth more than a claim in the README.
>
> Also implement the b402 seller side on the trust score and benchmark endpoints.
>
> If this phase runs long, the coordinator is bonus and can be cut. Don't cut it
> before anything mandatory.

### Phase 7 — Benchmark

> Build Phase 7 — the TermiX Agent Advantage harness. `docs/09-BENCHMARK_HARNESS.md`
> is the spec, and its honesty section is the most important part of it.
>
> Build the manual-branch recorder CLI first — it starts a monotonic clock on the
> trigger and prompts through each step, so timings are recorded live rather than
> reconstructed afterwards.
>
> Then the three task harnesses: PancakeSwap V3 range recovery, Venus liquidation
> defense, cross-protocol yield migration. Run each several times, both branches,
> on testnet. Commit the raw run records.
>
> Every number on `/benchmark` comes from a real run with a transaction hash. State
> sample sizes. Label single observations. Disclose who ran the manual branch and
> how familiar they were with the interface — if it was one of us, the manual branch
> is faster than a real user's, which makes the comparison conservative and more
> credible.
>
> Then the `/benchmark` surface, the PDF export, and a direct path from each task
> to hiring the agent that ran it.

### Phase 8 — Submission

> Final phase. Work through `docs/11-SUBMISSION_CHECKLIST.md` line by line and
> report what's unchecked.
>
> Run the equal-depth audit one more time. Verify every external claim resolves to
> a verifier. Confirm the deployment is public, has no login, works on mobile, and
> is stable.
>
> Then the honesty audit at the bottom of that checklist — do it deliberately,
> looking for reasons to fail us. Search the codebase for any PACE bypass. Check
> that nothing claims mainnet when it ran on testnet. Check that no illustrative
> figure is presented as measured.
>
> Write the README with architecture, setup, and a limitations section that names
> honestly what doesn't work yet. Judges respect a stated limitation more than they
> respect a gap they discover.
>
> Then give me a demo video shot list in the order: intent → compare with the prune
> toggle → hire → session permissions → agent acts → blocked action → revoke.

---

## Prompts for when things go sideways

**When a phase is running long:**

> We're over budget on this phase. Look at `docs/10-BUILD_PLAN.md` and
> `docs/11-SUBMISSION_CHECKLIST.md` and tell me what in the current phase is
> mandatory for a track versus what's bonus. Cut bonus before mandatory. Tell me
> what you're cutting and what it costs us before you cut it.

**When an SDK doesn't match the docs:**

> Stop building around it. Show me what the SDK actually does versus what
> `docs/06-INTEGRATIONS.md` assumes. Then propose either a change to our approach
> or a change to the doc. Don't paper over the difference — we'll build on this for
> weeks.

**When you're unsure whether something is honest enough:**

> Assume a judge will check this specific claim. What would they find? If the
> answer is anything other than "exactly what we said", fix the claim rather than
> the presentation.

**Before any commit that touches a category surface:**

> Run the equal-depth audit. Four arena rows, four profiles, side by side. Tell me
> honestly if one is thinner. The rubric penalises this explicitly and it's the
> easiest thing to let slip.
