# 01 — Product Specification

## The user we are designing for

A BNB Chain DeFi user with real capital deployed and no knowledge of BNB Agent
Studio. They have an LP position on PancakeSwap, a borrow on Venus, or stablecoins
sitting idle. They have heard agents can automate this. They have no idea which
agent to trust, what an agent will actually do with their money, or how to stop it.

Every design decision answers one of their three questions:

1. **Which agent should I hire?** → Sybil-pruned arena, category depth, real metrics.
2. **What will it do with my money?** → Plain-language permissions, PACE simulation.
3. **How do I stop it?** → One-transaction revoke, always visible.

A second audience matters for judging: the hackathon judge who has fifteen minutes,
has already looked at eight other marketplaces, and is checking whether yours does
anything the others don't. They should hit something surprising within thirty
seconds of landing.

---

## Screen inventory

| Route | Screen | Primary job |
|-------|--------|-------------|
| `/` | Front door | Take an intent, show the four categories, prove the arena exists |
| `/arena` | Arena index | All four leaderboards, side by side, equal weight |
| `/arena/[category]` | Category arena | One category in depth, ranked, filterable |
| `/agent/[id]` | Agent profile | Everything known about one agent, verifiable |
| `/hire/[id]` | Hire flow | Configure, provision wallet, grant session, escrow |
| `/dashboard` | Control center | Active agents, live telemetry, permissions, revoke |
| `/dashboard/session/[key]` | Session detail | Exact permissions, transaction feed, revoke |
| `/benchmark` | Agent Advantage | Live manual-vs-agent comparison, three tasks |
| `/verify` | Trust methodology | How pruning works, why raw scores mislead |

---

## Journey 1 — Intent to hire (the main track journey)

This is the journey judges will walk. It must have no dead ends.

### Step 1 — Land

The front door opens on a single input with the label **"What's your financial
goal?"** Below it, four intent chips seed the flow for someone who doesn't know
what to type:

- `Keep my PancakeSwap CAKE/USDT position in range`
- `Protect my Venus borrow from liquidation`
- `Grid trade BNB between $500 and $700`
- `Move my stablecoins to the best yield on BNB Chain`

Below the fold, the four category arenas are visible immediately — a user who
prefers browsing never has to use the input at all. Both paths reach the same place.

**Acceptance:** A first-time visitor can reach a ranked list of agents in one
action, whether they type, click a chip, or scroll and click a category.

### Step 2 — Parse

The intent parser classifies free text into one or more of four categories and
extracts any parameters it can find (asset pair, price range, health factor
threshold, capital amount).

Output shape:

```ts
type ParsedIntent = {
  categories: AgentCategory[];        // one or more, ordered by confidence
  params: {
    pair?: string;                    // "CAKE/USDT"
    capitalUsd?: number;
    priceRange?: { min: number; max: number };
    healthFactorFloor?: number;
    protocols?: Protocol[];
  };
  confidence: number;                 // 0-1
  restated: string;                   // plain-language restatement for confirmation
};
```

The UI shows the restatement before results: *"Looking for agents that keep a
concentrated liquidity position in range on PancakeSwap V3."* The user can edit
it. Never silently guess — always show what was understood.

When confidence is low, fall back to showing all four categories rather than
guessing wrong. An honest "here's everything, pick a category" beats a confident
mismatch.

**Acceptance:** Every one of the four seed chips parses to the correct single
category. A multi-category intent ("protect my loan and reinvest the yield")
returns two categories and offers the coordinator flow.

### Step 3 — Compare

Matched agents appear ranked by pruned trust score. Each row shows enough to
decide without opening the profile: name, category, trust score, 30-day net ROI,
max drawdown, median execution latency, total value settled, and a sparkline of
recent performance.

The **Sybil-pruned** toggle sits at the top of the list. Flipping it re-ranks the
list and shows how many reviews were discarded and why. This is the thirty-second
surprise for a judge.

**Acceptance:** Toggling changes the visible ranking. The count of discarded
reviews is shown with a link to `/verify` explaining the method.

### Step 4 — Understand

The agent profile answers "what does this thing actually do" without jargon:

- **What it does** — two sentences in plain language, then the strategy logic
  in detail for those who want it.
- **What it's allowed to do** — the exact session scope this agent requests:
  contracts, functions, spend cap, expiry. Shown before hiring, not after.
- **Track record** — performance chart, intervention log, every entry linked to
  a BscScan transaction.
- **Identity** — ERC-8004 agent ID, owner address, registration date, all linked
  to 8004scan.
- **Reviews** — pruned by default, each showing the settled payment that backs it.

**Acceptance:** Every numeric claim on this page resolves to an external verifier
in one click.

### Step 5 — Configure and hire

The hire flow is four panels on one page, not a wizard with hidden steps:

1. **Capital** — how much, which token, from which wallet.
2. **Boundaries** — strategy parameters in plain language with sensible defaults
   pre-filled from the parsed intent. Rebalance trigger, slippage cap, daily spend
   limit, session expiry.
3. **Permissions preview** — the literal session scope rendered as English
   sentences: *"This agent can call PancakeSwap V3 Position Manager. It can mint,
   collect, and decrease liquidity. It cannot transfer your tokens anywhere. It can
   spend at most 100 USDT per day. It stops working in 7 days."*
4. **Confirm** — one signature provisions the Altana account if needed, one
   transaction grants the session, one creates the ERC-8183 escrow.

**Acceptance:** From clicking Hire to an active agent is at most three signatures
and under two minutes. The permissions preview matches byte-for-byte what gets
registered in the KeyStore.

### Step 6 — Watch and control

The dashboard lists active agents with live telemetry. Each proposed action shows
its PACE verification state before it executes. Every executed action links to
BscScan.

The revoke button is always visible, never behind a menu, and never requires
confirmation beyond the wallet signature itself.

**Acceptance:** Revoke produces an on-chain transaction visible in the Altana
Explorer, and the next agent action reverts.

---

## Journey 2 — Multi-category coordination

Triggered when the parser returns more than one category, or when the user picks
"Hire as a team" on the arena.

The coordinator agent posts an ERC-8183 parent job, then sub-jobs for each
specialist. The UI shows this as a live sequence — parent funded, sub-job posted,
specialist accepted, work delivered, settled — with each state change linked to a
transaction.

This is the Altana bonus criterion and it needs to be visibly *doing something*,
not a checkbox in a feature list.

**Acceptance:** A two-category intent produces at least three on-chain jobs
(parent plus two sub-jobs), each verifiable, each with its own session scope.

---

## Journey 3 — Prove the advantage

`/benchmark` is the TermiX Agent Advantage Report rendered as a live product
surface rather than a PDF attachment.

Three tasks, each showing manual and agent execution side by side:

| Task | Domain | Why it's here |
|------|--------|---------------|
| PancakeSwap V3 range recovery | Trading | High-stakes category TermiX weights above general-purpose |
| Venus liquidation defense | Security | Second high-stakes category, largest dollar delta |
| Cross-protocol yield migration | Yield | Shows the opportunity-cost dimension |

For each: elapsed time, gas spent, dollars lost or preserved, output quality, and
the transaction hashes for both branches. The manual branch is a recorded run with
timestamps, not an estimate.

**Acceptance:** Every number on this page traces to a logged run. The page states
plainly when a figure is a single observation rather than an average.

---

## Copy rules

The interface talks like a knowledgeable person, not a protocol spec.

| Say | Not |
|-----|-----|
| Trust score | Pruned Beta reputation vector |
| What this agent can do | Session key permission scope |
| Checked before running | Policy Decision Record attestation |
| Stop this agent | Revoke session authority |
| Reviews backed by real payments | x402-verified feedback weighting |

The technical vocabulary still appears — on `/verify`, in tooltips, and in the
agent profile's detail sections. It is available to anyone who wants it and never
blocks anyone who doesn't.

Buttons name their outcome. "Hire this agent" produces "Agent hired". "Stop this
agent" produces "Agent stopped". The verb never changes between the action and its
confirmation.

Empty states are invitations. An arena with no agents in a category says what to
do next, not "No data available".

Errors say what happened and what to do. "The rebalance simulation failed because
slippage would have exceeded your 0.5% cap. Raise the cap or wait for the pool to
settle." Never "Transaction reverted".

---

## What we are deliberately not building

Scope discipline matters more than feature count. These are out:

- **Reverse auctions for agent selection.** Interesting, unscored by any rubric,
  large build. Mention as roadmap, do not build.
- **Cross-chain agent discovery.** BNB Chain is the brief.
- **Agent authoring tools.** Agent Studio already does this. We are the front door,
  not the workshop.
- **Token, points, or airdrop mechanics.** Nothing in the rubric rewards it.
- **Social feed, comments, follows.** Reviews are payment-backed or absent.
