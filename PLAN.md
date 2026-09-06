# Khoros — Analysis and Delivery Plan

**Written:** 2026-09-06. **Deadline:** 2026-09-09 (submissions 5 Aug – 9 Sep, UTC).
**Time remaining: ~3 days.**

---

## 1. The headline finding

The spec in `files/` is excellent and it is a **~8–10 week plan**. You have three days.

Evidence: the build plan has nine phases, each ending in a deployable milestone.
A subagent analysis of the trust-scoring slice alone (docs 04 + 07, excluding the
intent parser and performance rollups) estimated **12–18 developer-days**, with
Sybil cluster detection at 3–5 days and settlement matching at 2–3 days. Doc 03
requires eleven artifacts across four categories at *enforced equal depth*, which
is inherently 4× and explicitly forbids shipping three and stubbing one.

So the plan below is **not** the build plan in `10-BUILD_PLAN.md`. It is a triage
plan that maximises score per remaining hour. Following the original phase order
would produce a beautiful Phase 0–2 and nothing that satisfies any bounty.

---

## 2. What I verified as real (before designing around it)

The spec's own kickoff prompt demands dependency verification first. Done:

| Dependency | Status | Notes |
|---|---|---|
| Hackathon + deadline | **Confirmed** | 5 Aug – 9 Sep 2026; judging 9–23 Sep; winners 5 Nov |
| Prize structure | **Confirmed** | $30k main + adoption; TermiX $6k/$3k/$1k; Altana 50k XP; PancakeSwap 1,000 CAKE |
| `@altananetwork/sdk` | **Real**, v0.9.0 (pub. 2026-09-02) | Actively maintained |
| `@bnbagent/sdk` | **Real**, v0.5.5 (pub. 2026-08-27) | |
| BSC Testnet (97) support | **Confirmed in SDK** | `BNB_TESTNET`, dedicated `TESTNET_RELAY_URL` (`https://testnet-relay.altana.network`), KeyStore deployed |
| ERC-8183 on chain 97 | **Confirmed, real addresses** | commerce `0xa206c0…B0DE`, router `0xD7d36D…6F25`, policy `0xd6a421…1cEA`, registry `0x8004A8…BD9e`, payment token `0xc70B87…5565` |
| `hireErc8183Agent` | **Exists** — the Altana bonus criterion is directly reachable | Also `buildHireCalls`, `getErc8183Job`, `settleErc8183Job`, `submitErc8183Deliverable` |
| `grantSession` / `revokeSession` / `registerSessionKey` | **Exist** | `register?: boolean` defaults **true** — KeyStore registration is real, as the Altana track requires |
| x402 | **Exists** (`fetchWithX402`, `signX402Payment`, Permit2/EIP-3009 builders) | |
| ERC-8004 helpers | **Exist** (`getErc8004Agent`, `registerErc8004Agent`, …) | |

**Verdict: the integration surface is real and the Altana track is genuinely
winnable.** That is the single most valuable thing to know before triaging.

### Where the spec is wrong about the SDK

These would each have cost hours of debugging mid-build:

1. **`describeScope()` does not exist.** Docs 06 and 08 build the entire
   permissions UI on it (`PermissionList` "renders `describeScope()` output,
   never takes free text"). **You must write it yourself** as a pure function
   over `SessionPermissions`. Keep the spec's intent — derive English from the
   scope object, never hand-write it — but own the function.
2. **`grantSession` signature differs.** Actual:
   `grantSession(wallet, adminSigner, opts, config)` — four positional args, not
   one options bag. `opts` is `{permissions, expiry, sessionSigner?, register?}`.
3. **Permissions shape differs.** Real type is
   `{calls?: CallPermission[], spend?: SpendPermission[]}` where `CallPermission`
   is `{signature, to}` — a **`signature` string, not a separate `selectors[]`
   array**. Doc 06's `selectors: ["mint"]` shape is invented.
4. **`createAccount({authenticator:"passkey"})` is invented.** Real:
   `createPasskeyWallet({name, rpId?, networks})`; for Node/tests,
   `createWallet({signer: createHeadlessPasskey()})`.
5. **Session key persistence is a real footgun the docs miss.** If `sessionSigner`
   is omitted the SDK generates a key that exists **only in process memory** — lose
   it and the grant is permanently unusable. Generate your own key, persist it,
   use `serializeSession`/`deserializeSession`.
6. **Chain-ID incoherence.** Doc 06 grants sessions on `BNB` (chain 56) but
   creates jobs on 97. A session on mainnet cannot authorise a testnet tx. **Use
   `BNB_TESTNET` throughout for execution**; chain 56 is read-only for agent data.

### The PACE design hole (architectural, not cosmetic)

`PolicyAttestedExecutor.executePolicyAttested` has **no access control and no
`msg.sender` binding**, and it executes via
`intent.targetContract.call{value:...}` — meaning the *executor contract* is
`msg.sender`, so it must hold the funds. That makes it a pooled hot wallet with a
global nonce space, shared by every user. This contradicts doc 06, where the
Altana session key is the actor, and contradicts the verifier, which simulates by
impersonating the *user's* account — so the simulated state diff is not the
executed state diff. Also: `maxSlippageBps` is in the intent hash but **never
checked on-chain**; the function isn't `payable` despite forwarding value;
`ExecutionRejected` is declared and never emitted; expired-intent and expired-PDR
share one error, so two of the ten prescribed tests can both pass with a check
deleted.

**Resolution for a 3-day build:** do not deploy a fund-holding executor. Let the
Altana session key be the sole executor (it already enforces the call allowlist,
spend cap, and expiry *on-chain, at validator level* — which is exactly what the
Altana track asks for), and run PACE as a **pre-execution gate in the runtime**
that must return a signed PDR before the session key is used. You keep the safety
story and the "no bypass" rule, you lose only the on-chain attestation contract —
which no bounty actually requires. Say so plainly in the README.

---

## 3. Scoring reality: where the points actually are

| Track | Prize | Hard gate | Realistically reachable in 3 days? |
|---|---|---|---|
| **Altana** | 50,000 XP, winner-takes-all | 5 mandatory criteria, all mechanical | **Yes — highest ratio of points to effort.** Every criterion maps to an SDK call that exists. |
| **Main** | $30,000 + adoption | Functionality, data quality, agent diversity | **Partially.** Functionality and data quality are achievable; agent diversity at equal depth is the expensive one. |
| **PancakeSwap** | 1,000 CAKE | Real benefit to LPs/traders | **Yes, if** the rebalancing agent genuinely runs on V3. |
| **TermiX** | $6k/$3k/$1k | Agent Advantage Report, ≥3 real tasks both ways | **No, not honestly.** See below. |

### TermiX is the one to consciously drop (or scope to one task)

The report needs ≥3 tasks run *both ways* with real transactions. The manual
branches are human wall-clock — doc 09's own example is ~18 min per manual run of
task 1, task 3's manual branch is deliberately *long* (detection delay is the
metric), and the doc asks for several runs each for a distribution. Task 2's
headline number depends on a **real liquidation bot** taking your collateral on
testnet — an external actor you don't control.

You cannot honestly produce this by Sept 9, and the honesty rules are the loudest
thing in the entire spec ("a fabricated number that gets caught costs more than an
unimpressive real one"). **Fabricating the report to chase $6k would put the
$30k main track at risk**, because the same judges read the same claims.

Do this instead: run **one** task (LP range recovery) both ways, once or twice,
for real. Publish it at `/benchmark` labelled honestly as a single observation
with the operator's familiarity disclosed. That is a legitimate partial entry, it
strengthens the main track's credibility rather than undermining it, and it costs
hours rather than days.

---

## 4. The plan

Priority order. Each block ends somewhere demonstrable — if you stop anywhere, what
exists is coherent.

### Day 0 (today, remaining hours) — unblock everything

Do these first because they have external latency or gate everything downstream.

- [ ] **Apply for the 8004scan Pro API key now.** Doc 10 says it is not instant.
      If it does not arrive, the fallback is direct ERC-8004 registry reads via
      `getErc8004Agent` — which is already in the SDK. Do not block on it.
- [ ] **Get BSC Testnet BNB** from `https://testnet.bnbchain.org/faucet-smart`,
      for at least two addresses (agent + manual branch).
- [ ] **Spike the Altana happy path in one throwaway script**, headless:
      `createWallet({signer: createHeadlessPasskey()})` → `grantSession(...,
      {register: true})` → `execute` a trivial call → `revokeSession` → confirm the
      next execute fails. **~40 lines. Nothing else starts until this works.**
      This is the whole Altana track in miniature, and doc 10 explicitly warns
      this phase is the one most likely to surprise you.
- [ ] Move `files/` → `docs/`, commit. It is currently untracked.
- [ ] Scaffold: Next.js 14 + TS strict + Tailwind, single app. **Skip Turborepo,
      skip the multi-package monorepo, skip Redis** — they cost hours and score
      nothing. One app, one `lib/`, Postgres only.

### Day 1 — Marketplace shell + real data + Altana sessions

**Morning — data.** Ingest real BSC agents (8004scan if the key landed, else
direct registry reads). Classify into the four categories. **Doc 10's warning is
the real risk here: if most agents land `uncategorised`, every arena is empty.**
Budget explicitly for hand-curating a seed set per category — the docs authorise
this, and an empty arena at judging is fatal.

Implement trust scoring, but **only the parts that are fully specified**: the
weight function, Beta aggregation, demand index, and confidence intervals are
pure functions of ~50 lines and are directly transcribable. **Cut the Sybil
cluster detection to a documented heuristic** — the three signals (reciprocity,
temporal coincidence, funding provenance) have *no definitions* in doc 04, only
weights (0.45/0.35/0.20) over undefined inputs, and "reviewer's owner also
controls" needs an entire address-linkage subsystem. Ship temporal coincidence +
zero-payment as the pruning signals, state the method precisely on `/verify`, and
name the unimplemented signals in the limitations section. That is honest and it
still visibly re-ranks.

**Afternoon — the surface.** Front door, four seed chips, the deterministic intent
matcher (the LLM path is optional and must not be a demo dependency), arena index,
per-category arena, agent profile, `/verify`. Build `Stave`, `TrustBar`,
`MetricRow`, `PruneToggle`, `VerifyLink` per doc 08 — the design system is
distinctive and cheap to honour, and it is what makes a judge look twice in the
first thirty seconds. Get the **prune toggle reorder animation** right; doc 08
calls it the one piece of choreography in the product and it is the demonstration
of the central claim.

**Evening — Altana.** Hire flow, session scope built per category, `grantSession`
with `register: true`, your own `describeScope()` driving the permissions copy,
dashboard, session detail, **revoke**. Altana Explorer links everywhere.

### Day 2 — Agents, PACE gate, commerce

- **Two runtimes, done properly: rebalancing and health-factor.** Doc 10 names
  these as the critical path. Then grid and yield at the same UI/data depth even
  if their strategy logic is simpler — **equal depth is a scoring gate, and it is
  about the eleven artifacts, most of which are UI and docs, not strategy code.**
  This is the key insight for the deadline: you can satisfy equal depth without
  four equally sophisticated quant engines, as long as every category has all
  eleven artifacts and at least one real testnet execution.
- **Cut the expensive strategy math.** The jump-diffusion/LVR rebalance trigger
  and the rolling-VaR predictive HF trigger are genuine quant work. Ship the hard
  triggers (boundary tick crossed; `HF ≤ 1.15`), which are trivial and demo
  identically. Document the economic model as designed-but-not-implemented.
- **PACE as a runtime gate** (per §2): fork-simulate, evaluate policy, sign a PDR,
  refuse to execute without one. No bypass flag, anywhere. **Deliberately induce a
  block** with a tight slippage cap and render it in the dashboard — doc 10 is
  right that this is the clearest evidence the layer is real.
- **ERC-8183 hire** via `hireErc8183Agent` / `buildHireCalls`. Real addresses on
  97 are confirmed. This is the Altana *bonus* criterion and it is a few calls.
- **One real testnet execution per category**, hashes captured. This is
  simultaneously artifact #11 for all four categories, the main track's "agents
  are live" bar, and the Altana mandatory "real tx through a session key".

### Day 3 — Benchmark (scoped), honesty audit, submit

- One benchmark task, run for real, honestly labelled. Build the manual recorder
  CLI first so timings are captured live rather than reconstructed.
- **The honesty audit from doc 11, done adversarially.** Grep for any PACE bypass.
  Confirm nothing claims mainnet that ran on testnet. Confirm no illustrative
  figure is presented as measured. This protects the main track.
- README with an explicit **limitations section** naming: cluster detection
  simplified, executor contract not deployed, TermiX report partial, economic
  triggers not implemented. Doc 11 is right — judges respect a stated limitation
  more than a discovered gap.
- Equal-depth audit: four arena rows, four profiles, side by side.
- Wallet addresses in the submission (**required for Altana**).
- Demo video: intent → compare w/ prune toggle → hire → permissions → agent acts
  → blocked action → revoke.
- Deploy public, no login, mobile, stable through the judging window.

---

## 5. Cuts, stated explicitly

Cut, with what it costs:

| Cut | Costs |
|---|---|
| Turborepo / multi-package monorepo / Redis | Nothing scored. Pure setup time. |
| `PolicyAttestedExecutor.sol` + 10 Foundry tests | The on-chain attestation story. No bounty requires it; the session key enforces limits on-chain already. |
| Full Sybil cluster detection (3 signals + owner linkage) | Some data-quality credit. Mitigated by documenting the method honestly. |
| Jump-diffusion/LVR + rolling-VaR triggers | Strategy sophistication. Hard triggers demo identically. |
| TermiX tasks 2 and 3 | ~$6k track, realistically unreachable honestly. Task 2 depends on an uncontrolled external liquidator. |
| Coordinator cascade (multi-category sub-jobs) | Altana *bonus* only. Doc 10 explicitly says cut this before anything mandatory. Do it only if Day 2 finishes early. |
| LLM intent path | Nothing — the deterministic matcher must handle the four chips perfectly anyway, and doc 02 says the demo must not depend on an external model. |

**Not cut, ever:** the four categories at equal depth, pruned-by-default scoring,
the revoke path, real testnet transactions, and every honesty rule. Each of those
is a gate rather than a score.

---

## 6. The one decision I need from you

**Which do you want optimised for?**

- **(A) Altana track, winner-takes-all 50k XP** — highest points-per-hour, every
  criterion is mechanical and the SDK is confirmed to support all five. Narrower.
- **(B) Main track $30k + adoption** — much larger prize and the strategic one
  (adoption as the official marketplace), but "agent diversity at equal depth" is
  the expensive gate and the field is competing on exactly this.
- **(C) Both, weighted to Altana** — my recommendation. The work overlaps
  substantially: the hire flow, sessions, dashboard, and revoke serve both tracks.
  Day 1 is shared; the divergence is only in how much Day 2 goes to category
  breadth versus Altana bonus depth.

Default if you say nothing: **(C)**.
