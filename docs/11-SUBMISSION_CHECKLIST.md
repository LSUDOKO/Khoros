# 11 — Submission Checklist

Work through this before submitting. Every line traces to something a judge
explicitly scores. Anything unchecked is points left on the table.

---

## Eligibility — all tracks

- [ ] Submission is functional and publicly accessible for the whole judging window
- [ ] No login required to browse, compare, and inspect agents
- [ ] Agents surfaced on the marketplace are live on BSC
- [ ] One entry, one team
- [ ] Wallet address(es) included in the submission — **required for the Altana track**
- [ ] Repository public, README complete
- [ ] Demo video recorded and linked

---

## Main track — BNB Agent Studio Marketplace ($30,000 + adoption)

### Functionality

The stated bar: someone with zero Agent Studio knowledge gets from landing to an
activated agent without hitting a dead end.

- [ ] Front door takes a plain-language intent and returns matched agents
- [ ] Four seed chips work perfectly for a user who does not know what to type
- [ ] Browsing works as an equal path — no one is forced through the intent input
- [ ] Every category reachable in one click from the front door
- [ ] Agent profile explains what the agent does without jargon
- [ ] Hire flow completes in three signatures or fewer
- [ ] Account provisioning is part of the flow, not a prerequisite
- [ ] Every empty state gives a next action
- [ ] Every error says what happened and what to do
- [ ] Mobile down to 320px; keyboard operable throughout
- [ ] **Walkthrough test:** hand the URL to someone who has never seen it and watch
      them without helping. Any hesitation is a finding.

### Data quality

The stated bar: real-time, accurate data beyond basic counts, enough to make a
genuinely informed hiring decision.

- [ ] Trust scores are Sybil-pruned by default
- [ ] Prune toggle present, and flipping it visibly re-ranks
- [ ] Discarded review count shown with reasons broken down
- [ ] `/verify` explains the method, with parameters stated
- [ ] Reviews show the settled payment behind them
- [ ] Confidence intervals rendered — uncertainty is visible
- [ ] Sample sizes shown wherever they are small
- [ ] Six performance metrics per agent, not registration counts
- [ ] `supportedTrust` badges surfaced (TEE attestation, crypto-economic)
- [ ] Data freshness indicator present
- [ ] Every numeric claim links to BscScan, 8004scan, or the Altana Explorer

### Agent diversity

The stated bar: all four categories at equal depth. A submission treating one as
the main event scores poorly.

- [ ] Rebalancing — all eleven artifacts from `03-AGENT_CATEGORIES.md`
- [ ] Grid trading — all eleven
- [ ] Yield optimisation — all eleven
- [ ] Health factor monitoring — all eleven
- [ ] Same six metric slots, same order, all four
- [ ] Same profile sections, all four
- [ ] Same arena treatment and height allocation, all four
- [ ] Each has a working runtime with at least one real testnet execution
- [ ] No category arena is empty at judging time
- [ ] **Side-by-side audit performed:** screenshots of four arena rows and four
      profiles compared. If one looks thinner, it is thinner.

---

## TermiX Challenge ($6,000 / $3,000 / $1,000)

### Required artifact

- [ ] Agent Advantage Report included with the submission
- [ ] At least 3 real tasks run both ways — agent vs. without
- [ ] Time, cost, and output quality reported for each
- [ ] Actual outputs attached, not summarised
- [ ] At least one task from trading, stock, or security — **we have two**
- [ ] Every figure traces to a logged run with transaction hashes
- [ ] Sample sizes stated; single observations labelled as such
- [ ] Manual-branch operator and their familiarity disclosed

### Value of the services (30%)

- [ ] Agents genuinely work on testnet, not demos
- [ ] Pricing visible before hiring
- [ ] TermiX can hire from the marketplace without asking us anything
- [ ] Faucet and prerequisites linked from the benchmark page
- [ ] Path from benchmark task to hiring that exact agent

### Proven agent advantage (30%)

- [ ] `/benchmark` renders both branches side by side
- [ ] Elapsed-time bars at true proportion
- [ ] Cost split into gas and opportunity cost
- [ ] All transaction hashes are `VerifyLink`s
- [ ] Raw run records committed to the repo

### High-stakes categories and track record (20%)

- [ ] Trading task present (PancakeSwap V3 range recovery)
- [ ] Security task present (Venus liquidation defense)
- [ ] Trading agents show win rate, the window it covers, and the risk taken
- [ ] Drawdown reported alongside every return figure

### Marketplace quality (20%)

- [ ] Find, compare, hire works without instructions
- [ ] Comparison across agents is possible in one view

---

## Best Built with Altana (50,000 XP)

### Mandatory qualification — all five

- [ ] Live on-chain transactions visible in the Altana explorer (testnet counts)
- [ ] Agents operate on their own Altana wallets
- [ ] Sessions carry real limits: call allowlist, spend cap, expiry
- [ ] Sessions registered in the KeyStore — integration reads on-chain
- [ ] Real on-chain transactions executed through a session key
- [ ] User-facing control: a user can see what their agent may do, and revoke it,
      inside the product

### Verification

- [ ] Altana Explorer links on every session surface
- [ ] Permissions preview matches the registered scope byte for byte
- [ ] Revoke produces an on-chain transaction
- [ ] A post-revoke agent action reverts, and the revert is visible in the feed
- [ ] Wallet addresses included in the submission

### Bonus

- [ ] ERC-8183 agent hiring via the Altana ERC-8183 SDK (`hireErc8183Agent`)
- [ ] Coordinator cascade: parent job plus sub-jobs, each verifiable
- [ ] Cascade rendered live in the UI, not just claimed
- [ ] x402/b402 seller side implemented with the x402 server SDK
- [ ] Altana composable skills used where they fit (Venus, Lista, PancakeSwap, Aave)

---

## PancakeSwap Challenge (1,000 CAKE)

The stated bar: a real benefit to PancakeSwap traders or liquidity providers.

- [ ] Rebalancing agent manages PancakeSwap V3 concentrated liquidity
- [ ] Grid trading agent executes on the PancakeSwap V3 router
- [ ] Yield agent routes to PancakeSwap pools as a destination
- [ ] Health factor agent uses PancakeSwap for deleverage swaps
- [ ] PancakeSwap-specific metrics surfaced: fee APR, time in range, IL avoided,
      volume generated
- [ ] TWAP used for decisions, spot only for display — sandwich resistance
- [ ] User funds never leave the user's account under any session scope
- [ ] Benefit stated concretely on the PancakeSwap-facing surfaces, with numbers
      from real runs

---

## AltLayer / 8004scan

- [ ] 8004scan Pro API integrated
- [ ] ERC-8004 identity, reputation, and validation data all surfaced
- [ ] Agent profiles link back to 8004scan
- [ ] Sybil pruning applied to registry feedback
- [ ] Direct registry reads as cross-check, with disagreements logged

---

## Honesty audit

Do this last, deliberately, looking for reasons to fail yourself.

- [ ] Every number on the site came from a real run or a real chain read
- [ ] No placeholder or illustrative figure is presented as measured
- [ ] Nothing claims mainnet when it ran on testnet
- [ ] The README has a limitations section that names what does not work yet
- [ ] Known gaps are stated in the UI where a user would otherwise assume otherwise
- [ ] No PACE bypass flag exists anywhere in the codebase
- [ ] The demo video shows the real product, not a mockup
- [ ] Anything a judge might reasonably check, we have already checked

TermiX will hire agents and compare results against claims. Altana will read the
KeyStore. BNB Chain judges will click through to 8004scan. Assume every assertion
gets verified, because it will be.

---

## Final deployment

- [ ] Production URL live and stable
- [ ] Testnet clearly labelled as testnet, framed as a deliberate choice
- [ ] Seeded agents present in all four categories
- [ ] At least one active engagement running live during judging
- [ ] At least one blocked action visible in the demo dashboard
- [ ] Telemetry feed live
- [ ] Error monitoring on
- [ ] Someone available if a judge asks a question during the window
