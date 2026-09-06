# 03 — The Four Agent Categories

## The equal-depth contract

The main track rubric states plainly that a submission treating one category as
the main event and the rest as an afterthought will not score well. This document
exists to make equal depth enforceable rather than aspirational.

Every category ships with all eleven of the following. No exceptions, no
"we'll fill that in for grid trading later."

| # | Artifact | Where it lives |
|---|----------|----------------|
| 1 | Plain-language description (2 sentences) | Agent profile, arena card |
| 2 | Strategy logic write-up | Agent profile, expandable |
| 3 | Trigger condition, stated precisely | Profile + this document |
| 4 | Six headline metrics | Arena row + profile |
| 5 | Performance chart | Profile |
| 6 | Intervention log with tx links | Profile |
| 7 | Session scope manifest | Hire flow permission preview |
| 8 | PACE policy constraints | Verifier config |
| 9 | Working runtime | `agents/<category>/` |
| 10 | Configurable boundaries in the hire form | Hire flow |
| 11 | At least one live testnet execution | Benchmark or demo |

**The audit.** Before any commit touching category UI, check the four categories
render the same sections with the same density. A quick way: screenshot all four
arena rows and all four profiles, put them side by side. If one looks thinner,
it is thinner.

---

## Shared metric definitions

All four categories report the same six headline metrics so they are comparable
in one glance. The *meaning* differs per category; the *slots* do not.

| Slot | Rebalancing | Grid Trading | Yield | Health Factor |
|------|-------------|--------------|-------|---------------|
| **Return** | Fee APR captured | Realised grid profit | Net APY delta vs. hold | Penalties avoided (USD) |
| **Risk** | Max drawdown incl. IL | Max drawdown | Max drawdown | Lowest HF reached |
| **Activity** | Rebalances / 30d | Filled orders / 30d | Migrations / 30d | Interventions / 30d |
| **Precision** | Time in range % | Grid capture rate % | Time at best APY % | Interventions before HF 1.0 % |
| **Latency** | Median trigger→tx | Median trigger→tx | Median trigger→tx | Median trigger→tx |
| **Scale** | TVL managed | TVL managed | TVL managed | Debt protected |

Latency is the same measurement for all four: milliseconds from the runtime
observing a trigger condition to the transaction being included in a block.

---

## Category 1 — Rebalancing

### What it does, in two sentences

Keeps a concentrated liquidity position earning fees by moving the price range
when the market drifts away from it. When your position goes out of range it stops
earning entirely, and this agent puts it back to work without you watching a chart.

### The problem

PancakeSwap V3 concentrates liquidity into a tick interval $[p_a, p_b]$. Inside the
range, capital earns fees efficiently. Outside it, capital efficiency drops to zero
while the position remains fully exposed to price movement — the LP holds the wrong
side of the pair and earns nothing for it. Compounding this is loss-versus-
rebalancing: arbitrageurs systematically extract value from stale LP positions.

### Trigger

Rebalance when the expected fee gain from a recentred range exceeds the total cost
of moving:

$$\mathbb{E}[\Delta\text{Fees}_{\tau}] > \text{Gas} + \text{Slippage} + \text{LVR}_{\tau}$$

over a forward horizon $\tau$. Price dynamics are modelled as jump-diffusion, so a
volatility spike does not trigger a rebalance that a mean-reverting move would
immediately undo:

$$dS_t = \mu S_t\,dt + \sigma S_t\,dW_t + J_t\,dq_t$$

A hard secondary trigger fires when price crosses the boundary tick, regardless of
the economic calculation — an out-of-range position earns nothing, so the
break-even horizon shortens sharply.

### New range selection

Centre on current price, width scaled to realised volatility:

$$[\,\mu - k\sigma,\ \mu + k\sigma\,]$$

with $k$ from the user's chosen profile — tight ($k=1.2$) captures more fees per
dollar but rebalances more often; wide ($k=2.5$) rebalances rarely and earns less
per dollar. Default $k=1.8$.

### Execution sequence

`decreaseLiquidity` → `collect` → optional inventory swap to target ratio →
`mint` at the new range. All within one block where possible.

### Session scope

```
target:    PancakeSwap V3 NonfungiblePositionManager, SwapRouter
selectors: mint, decreaseLiquidity, collect, exactInputSingle
spend:     daily cap in position tokens
denied:    transfer, approve to non-allowlisted spenders
expiry:    user-chosen, default 7 days
```

### PACE constraints

- Slippage on any swap ≤ 50 bps
- New range width ≥ 2% — blocks a griefing agent from minting a dust-wide range
- Resulting position must contain the current price
- No net token outflow from the account

### Configurable boundaries

Range width profile (tight/balanced/wide), max slippage, max rebalances per day,
daily gas budget, minimum time between rebalances.

### PancakeSwap benefit

Directly reduces impermanent loss and idle capital for V3 LPs, and keeps liquidity
concentrated where trades actually happen — which improves execution for everyone
trading the pool, not just the LP.

---

## Category 2 — Grid Trading

### What it does, in two sentences

Places a ladder of buy and sell orders across a price range and works it
automatically, buying each step down and selling each step up. It turns sideways
volatility into realised profit without you or an exchange holding your keys.

### The problem

Grid strategies are well understood and widely available — on centralised
exchanges, where they require you to deposit funds and hand over API keys. On-chain
grid trading removes the custody risk entirely, but nobody wants to manually place
and replace forty limit orders.

### Grid construction

Partition $[P_{\min}, P_{\max}]$ into $N$ levels. Geometric spacing keeps the
percentage step constant, which suits volatile pairs:

$$P_i = P_{\min}\left(\frac{P_{\max}}{P_{\min}}\right)^{i/N},\qquad i \in \{0,\dots,N\}$$

Arithmetic spacing is offered for stable pairs where absolute steps matter more.

Per-level allocation is $C/N$ by default, with an optional weighting toward the
lower half of the grid for users who want to accumulate on the way down.

### Trigger

Price crosses level $P_i$. Downward cross executes a buy of the level's allocation
and arms a sell at $P_{i+1}$. Upward cross does the reverse. A cooldown prevents
a single volatile candle from sweeping the whole ladder.

### Execution

`exactInputSingle` / `exactOutputSingle` against the PancakeSwap V3 SwapRouter.
Each fill is recorded with the level, direction, executed price, and realised
profit on the paired leg.

### Session scope

```
target:    PancakeSwap V3 SwapRouter, Quoter
selectors: exactInputSingle, exactOutputSingle
spend:     rolling 24-hour cap across the whole grid
denied:    transfer, any non-PancakeSwap target
expiry:    user-chosen, default 7 days
```

### PACE constraints

- Rolling daily spend cap enforced across all levels, not per order — a flash crash
  cannot sweep the ladder beyond the user's budget
- Per-trade slippage ≤ user cap
- Trade size ≤ level allocation
- Reject if the pool's spot price deviates from the oracle beyond a threshold
  (manipulation guard)

### Configurable boundaries

Price range, level count, spacing type, total capital, per-level weighting,
daily spend cap, slippage cap, stop-out price.

### PancakeSwap benefit

Generates consistent two-sided volume and therefore fee revenue for PancakeSwap
pools, and provides passive liquidity around the current price without requiring
LP position management.

---

## Category 3 — Yield Optimisation

### What it does, in two sentences

Watches lending and staking yields across Venus, Lista, and PancakeSwap and moves
your capital to wherever it earns most after costs. It only moves when the gain
clears the gas, so it will not churn your position for a rounding error.

### The problem

Yields on BNB Chain move constantly across Venus lending markets, Lista liquid
staking, and PancakeSwap pools. Retail capital sits in stale positions because
monitoring several protocols and computing whether a move is worth the gas is
tedious and easy to get wrong.

### Allocation

Maximise risk-adjusted yield subject to concentration limits:

$$\max_{\vec w}\ \Big(\sum_j w_j\,\text{NetAPY}_j - \gamma\,\vec w^{\,T}\Sigma\vec w\Big)
\quad\text{s.t.}\quad \sum_j w_j = 1,\ \ 0 \le w_j \le w_{\max}$$

$\Sigma$ is the empirical covariance of protocol risk proxies — TVL volatility,
utilisation swings, oracle deviation history. $\gamma$ is the user's risk aversion,
exposed in the UI as conservative / balanced / aggressive. $w_{\max}$ caps
single-protocol concentration, default 60%.

Net APY is gross yield minus borrow cost minus expected protocol risk premium, not
the headline number the protocol advertises.

### Trigger

Migrate when the spread clears amortised cost over the expected holding horizon:

$$(\text{APY}_{\text{new}} - \text{APY}_{\text{current}}) \cdot C \cdot \frac{h}{365} > \text{Gas}_{\text{migration}}$$

The break-even horizon $h$ is computed and shown to the user — "this move pays for
itself in 2.8 days" is far more legible than a raw threshold.

### Execution

Withdraw from source (`redeemUnderlying` on Venus, unstake on Lista, decrease
liquidity on PancakeSwap), then deposit to target. Atomic where the protocols allow
it; otherwise sequenced with a rollback path if the second leg fails.

### Session scope

```
target:    Venus vTokens, Lista staking, PancakeSwap position manager
selectors: mint, redeemUnderlying, deposit, withdraw, stake, unstake
spend:     capital allocated at hire time
denied:    transfer to any address outside the allowlist — capital cannot leave
           the set of audited protocols under any code path
expiry:    user-chosen, default 14 days
```

The denial is the important line here. The session permits movement *between*
audited protocols and permits nothing else. Even a fully compromised agent planner
cannot route funds to an attacker address, because that call is not in the scope.

### PACE constraints

- Destination protocol must be on the allowlist
- Post-migration allocation must satisfy $w_j \le w_{\max}$
- Simulated post-state balance must be within tolerance of pre-state value
- Migration blocked if the destination's utilisation exceeds a safety bound

### Configurable boundaries

Capital, risk profile ($\gamma$), max concentration per protocol, minimum spread to
act, minimum holding period, protocol allowlist (user can exclude any protocol).

---

## Category 4 — Health Factor Monitoring

### What it does, in two sentences

Watches your borrow position and steps in before it gets liquidated, either by
adding collateral or by paying down debt. Liquidation costs 5–15% of your
collateral; this agent's whole job is making sure that never happens.

### The problem

Venus and Aave liquidate when health factor reaches 1.0:

$$HF = \frac{\sum_i \text{Collateral}_i \times \text{LiqThreshold}_i}{\sum_j \text{Debt}_j}$$

The penalty is immediate and large. Liquidation bots are faster than any human
watching a dashboard, and drops that matter happen at night, during sleep, and
during exactly the volatility that makes people slow to react.

### Trigger

Two triggers, and the predictive one is the point of the product.

**Reactive:** $HF \le HF_{\text{floor}}$, default 1.15.

**Predictive:** projected HF breaches the floor within the response horizon at a
given confidence. Using a rolling VaR on collateral price:

$$HF_{\text{proj}} = \frac{\sum_i C_i (1 - \text{VaR}_{\alpha,\tau}) \cdot \text{LT}_i}{\sum_j D_j} \le HF_{\text{floor}}$$

Acting on the projection rather than the level is what separates this from a price
alert. The agent moves while the position is still comfortably solvent.

### Response ladder

1. **Add collateral** from pre-authorised reserves in the user's account —
   stablecoins or liquid staking tokens. Cheapest, least disruptive. `supply`.
2. **Partial deleverage** if no idle reserve exists — withdraw a computed slice of
   collateral, swap to the debt asset, `repayBorrow`. Reduces exposure but keeps
   the position open.
3. **Alert and stop** if neither is possible within the session's permissions.
   The agent never exceeds its scope to "save" the position.

Target after intervention: $HF \ge 1.40$, so one action buys real headroom rather
than requiring another intervention on the next tick.

### Session scope

```
target:    Venus Comptroller + vTokens, Aave Pool, PancakeSwap SwapRouter
selectors: supply, mint, repayBorrow, redeemUnderlying, exactInputSingle
spend:     reserve cap authorised at hire time
denied:    borrow — the agent can never increase leverage
           transfer — collateral cannot leave the account
expiry:    user-chosen, default 30 days
```

Denying `borrow` is deliberate and worth surfacing in the UI. A defensive agent
that could borrow could also lever the user up. This one structurally cannot.

### PACE constraints

- Post-action simulated HF must be strictly greater than pre-action HF
- Post-action HF must be ≥ 1.40 or the action is rejected as insufficient
- Deleverage swap slippage ≤ 100 bps (wider than rebalancing — speed matters more
  under stress, and the alternative is a 5–15% penalty)
- No borrow selector under any circumstance
- Oracle sanity check: reject if the price feed deviates from a secondary source
  beyond tolerance, so a manipulated oracle cannot induce a spurious deleverage

### Configurable boundaries

HF floor, target HF after intervention, reserve authorisation amount, preferred
response (collateral-first vs. deleverage-first), maximum interventions per day,
predictive confidence level.

---

## Cross-category coordination

Multi-category intents produce a coordinator that hires specialists via ERC-8183
sub-jobs. The combinations that matter:

| Intent | Agents hired | Why they compose |
|--------|--------------|------------------|
| "Protect my loan and reinvest the surplus" | Health Factor + Yield | HF agent holds a reserve floor; Yield agent works only the surplus above it |
| "Farm PancakeSwap without going out of range" | Rebalancing + Grid | Grid works the range the rebalancer maintains |
| "Maximise yield but never risk liquidation" | Yield + Health Factor | HF constraint bounds the Yield agent's allocation |

Coordination requires a shared constraint object so two agents cannot both spend
the same dollar. The coordinator holds the capital allocation and each specialist's
session is scoped to its own slice.
