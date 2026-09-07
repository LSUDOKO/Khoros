# Submission status

Worked through `docs/11-SUBMISSION_CHECKLIST.md` line by line. This records what
is done, what is not, and what still needs a human — honestly, because the
checklist's own honesty audit says to look for reasons to fail ourselves.

---

## Demo video shot list

The order `docs/10` prescribes, which is also the order that makes the argument:

1. **Intent** — land on the front door, type "protect my Venus borrow and put
   the rest to work", show the restatement naming two categories and offering
   the coordinator.
2. **Compare** — reach a category arena. Flip the prune toggle. The ranking
   visibly reorders and agents that fall are marked. Read the discard line
   aloud: how many reviews were set aside and why. This is the thirty-second
   surprise; give it room.
3. **Hire** — open the hire form. Change the daily cap and show the permissions
   sentence changing with it, because it is generated from the same object that
   reaches the chain.
4. **Session permissions** — the dashboard. What the agent may do, in English,
   with its KeyStore link.
5. **Agent acts** — an execution in the live feed, with its BscScan link.
6. **Blocked action** — an action refused before execution, showing the failing
   invariant and the observed value. Do not skip past this; it is the clearest
   evidence the safety layer is real.
7. **Revoke** — stop the agent, then show the next attempt reverting.

Shots 5–7 need a funded testnet wallet (see `TESTNET_SETUP.md`).

---

## Eligibility

| Item | Status |
|---|---|
| Functional and publicly accessible | **Not yet deployed** |
| No login to browse, compare, inspect | Done — no auth anywhere in the app |
| Agents surfaced are live on BSC | Reader works against the live registry; see the caveat below |
| Wallet addresses in the submission | Pending funding |
| Repository public, README complete | Done, with a limitations section |
| Demo video | Pending the above |

---

## Main track

### Functionality

- [x] Front door takes plain language and returns matched agents
- [x] Four seed chips, each asserted to route correctly by test
- [x] Browsing works as an equal path — the arenas sit below the fold
- [x] Every category reachable in one click
- [x] Profile explains what the agent does without jargon
- [x] Account provisioning is part of the hire flow, not a prerequisite
- [x] Every empty state gives a next action
- [x] Every error says what happened and what to do
- [x] Mobile to 320px; six metric slots reflow to 3×2 rather than hiding
- [x] Keyboard operable, 44px targets, visible focus, semantic table
- [ ] Hire completes in three signatures — **blocked on funding**
- [ ] Walkthrough test with a stranger — not yet done

### Data quality

- [x] Trust scores Sybil-pruned by default
- [x] Prune toggle re-ranks visibly, with a 420ms FLIP reorder
- [x] Discarded count shown with reasons broken down
- [x] `/verify` explains the method with parameters read from the engine
- [x] Reviews show the settled payment behind them
- [x] Confidence intervals rendered as a ghost bar
- [x] Sample sizes shown wherever small, and called out below n=10
- [x] Six performance metrics per agent, not registration counts
- [x] `supportedTrust` badges surfaced
- [x] Data freshness indicator, which goes madder past an hour
- [x] Every numeric claim links to a verifier

### Agent diversity

- [x] All four categories: description, strategy, trigger, six metrics, chart,
      intervention log, scope manifest, PACE constraints, runtime, boundaries
- [x] Same six metric slots, same order, all four
- [x] Same profile sections, all four
- [x] Same arena treatment and height allocation
- [x] **Equal-depth audit automated** — 43 assertions, not a screenshot check
- [ ] One real testnet execution per category — **blocked on funding**
- [ ] No category arena empty at judging — needs the seed set loaded

---

## TermiX

- [ ] Agent Advantage Report — **not complete.** No runs recorded.
- [x] `/benchmark` renders both branches with true-proportion bars
- [x] Manual recorder captures timings live on a monotonic clock
- [x] Run records validate: no hashes, no operator, no elapsed time → rejected
- [x] Sample sizes stated; single observations labelled
- [x] Faucet and prerequisites linked from the benchmark page
- [x] Path from the benchmark page to the arena

The report needs three tasks run both ways with real transactions. The manual
branches are human wall-clock and cannot be shortcut. This is the largest
outstanding gap and it is stated as such rather than filled with estimates.

---

## Altana

### Mandatory

- [x] Sessions carry real limits: call allowlist, spend cap, expiry
- [x] Sessions registered in the KeyStore (`register: true`, explicit)
- [x] User-facing control: see what the agent may do, and revoke, in-product
- [ ] Live on-chain transactions in the explorer — **blocked on funding**
- [ ] Agents operating on their own Altana wallets — same
- [ ] Real transactions through a session key — same

### Verification

- [x] Altana Explorer links on every session surface
- [x] Permissions preview matches the registered scope **by construction** —
      both are `describeScope()` over the same object
- [ ] Revoke produces an on-chain transaction — blocked on funding
- [ ] Post-revoke action reverts, visible in the feed — the spike proves the
      path; it needs gas to run

### Bonus

- [x] `hireErc8183Agent` integrated
- [x] Coordinator plan with the shared-capital constraint, 23 tests
- [ ] Cascade rendered live in the UI
- [ ] x402/b402 seller side

---

## PancakeSwap

- [x] Rebalancing agent manages V3 concentrated liquidity
- [x] Grid agent executes on the V3 router
- [x] Yield agent routes to PancakeSwap as a destination
- [x] Health factor agent uses PancakeSwap for deleverage swaps
- [x] V3 addresses verified with `eth_getCode` on both chains
- [x] User funds never leave the user's account under any scope — the yield
      scope denies `transfer` entirely, so capital structurally cannot route
      to an attacker
- [ ] PancakeSwap-specific metrics from real runs
- [ ] TWAP for decisions — the oracle-deviation guard is implemented; a full
      TWAP read is not

---

## Honesty audit

Run adversarially, looking for reasons to fail.

- [x] No PACE bypass flag anywhere — grepped; only vendored forge-std and
      comments stating there is none
- [x] No hardcoded transaction hash or plausible metric in any shipped view
- [x] No mock, stub, lorem or placeholder data in a shipped path
- [x] No `Math.random` — the policy evaluator is provably pure, 50-iteration test
- [x] No `any` outside Next's generated types
- [x] Nothing claims mainnet where testnet ran; the split is labelled in the footer
- [x] README limitations section names six gaps
- [x] Curated listings carry a `seeded` flag through to a visible label, so one
      can never pass as auto-discovered
- [x] Where a figure is unavailable, the UI renders an empty state rather than a
      zero that looks like a measurement

---

## What needs a human

1. **Fund `0x7A6fd27153400fA405391e8B05033928CA997A9c`** at
   <https://testnet.bnbchain.org/faucet-smart>. This one step unblocks most of
   the Altana track, the per-category executions, and shots 5–7 of the video.
2. **Apply for the 8004scan Pro key** — not instant, and the fallback reader
   already works.
3. **Provision Postgres** and run `pnpm migrate`.
4. **Deploy** to Vercel and record the video.
