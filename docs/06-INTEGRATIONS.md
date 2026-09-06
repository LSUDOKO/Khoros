# 06 — Integrations

Every integration here maps to a judging requirement. The right-hand column says
which, so nothing gets built that nobody scores.

| Integration | Scored by |
|-------------|-----------|
| Altana sessions + KeyStore | Altana track (mandatory) |
| Altana ERC-8183 SDK | Altana bonus |
| x402 / b402 server SDK | Altana bonus |
| 8004scan Pro API | Main track data quality |
| BNB Agent Studio v2 | Main track (the agents being surfaced) |
| PancakeSwap V3 | PancakeSwap track |
| Venus, Lista, Aave | Main track category depth |

---

## Altana — self-custodial agent wallets

**Docs:** `docs.altana.network` · **SDK:** `@altananetwork/sdk` ·
**Skills:** `skills.altana.network`

Altana is the qualification gate for its own track. The stated bar is: agents on
their own Altana wallets, sessions with real limits (call allowlist, spend cap,
expiry), sessions registered in the KeyStore so integration reads on-chain, real
transactions through a session key, and user-facing revocation inside the product.

Every one of those five is a UI surface, not just a code path.

### Account provisioning

```ts
import { createClient, BNB } from "@altananetwork/sdk";

const altana = createClient({ chains: [BNB] });

// Passkey-backed account — no seed phrase, no extension
const account = await altana.createAccount({
  authenticator: "passkey",
  label: "Khoros",
});
```

Passkeys are worth the effort. Face ID or Touch ID onboarding is a materially
better first-run experience than a seed phrase, and the main track weights the
zero-knowledge-user journey heavily.

### Granting a session

```ts
const session = await altana.grantSession({
  wallet: userWallet,
  signer: userAdminSigner,
  permissions: {
    calls: [
      { to: PANCAKE_V3_POSITION_MANAGER },
      { to: PANCAKE_V3_SWAP_ROUTER },
    ],
    selectors: ["mint", "decreaseLiquidity", "collect", "exactInputSingle"],
    spend: [{
      token: BSC_USD,
      limit: parseUnits("100", 18),
      period: "day",
    }],
  },
  expiry: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
  register: true,   // ← required: writes to the on-chain KeyStore
});
```

`register: true` is not optional. The Altana criterion is explicit that sessions
must be readable on-chain rather than taken on trust from a pitch. After granting,
capture the transaction hash and surface an Altana Explorer link everywhere that
session appears.

### Rendering permissions in English

The permission preview must be derived from the scope object, never written by
hand, or the two will drift and the UI will lie.

```ts
export function describeScope(scope: SessionScope): string[] {
  return [
    `Can call ${scope.calls.map(c => contractName(c.to)).join(" and ")}.`,
    `Can use ${scope.selectors.map(friendlySelector).join(", ")}.`,
    `Cannot move your tokens to any other address.`,
    `Can spend up to ${fmt(scope.spend[0].limit)} ${symbol(scope.spend[0].token)} per day.`,
    `Stops working ${formatRelative(scope.expiry)}.`,
  ];
}
```

### Revocation

```ts
await altana.revokeSession({ wallet, signer, sessionKey });
```

One transaction, immediate effect, no key rotation, no moving funds. The button is
always visible on the dashboard and on the session detail page. After revoking,
verify the next agent action reverts — and show that revert in the feed, because it
is the proof the revocation was real.

### Composable skills

Altana ships production skills relevant to three of our four categories: Aave V3
Lending, Venus Lending, Lista Liquid Staking, PancakeSwap Liquidity, PancakeSwap
Trading, Copy Trade, Token Radar, Wallet Tracker, Four.meme Trading, x402 API
Payments. Prefer these over hand-rolled protocol calls — they are the integration
the track's judges are looking for.

---

## 8004scan — agent discovery and identity

**API:** `8004scan.io/developers` · Pro tier free for hackathon participants
(500 req/min, 100k req/day) via the Pro-Tier Upgrade Form.

Apply for the key on day one. The free tier will not sustain a full index of the
BSC agent set.

### What we pull

| Endpoint | Use |
|----------|-----|
| Agent list, filtered `chain=56` | Base marketplace inventory |
| Agent detail | Identity, owner, registration file, services, trust models |
| Reputation feedback | Raw input to the pruning pipeline |
| Validation records | TEE attestations, zkML proofs — surfaced as verification badges |

### Ingest discipline

- Cursor-paginate and persist the cursor; do not refetch the world each cycle.
- Cache aggressively — agent identity changes rarely, reputation changes often.
- Back off on 429 and keep the last-good model rather than serving nothing.
- Read the ERC-8004 registries directly via viem as a fallback and as a
  cross-check. If the API and the chain disagree, trust the chain and log it.

### Parsing the registration file

The ERC-8004 registration JSON carries `name`, `description`, `services[]`,
`x402Support`, `active`, and `supportedTrust[]`. Category assignment comes from
matching the description and declared skills against our four categories. Where the
match is ambiguous, mark the agent `uncategorised` and exclude it from category
arenas rather than guessing — a miscategorised agent in the Health Factor arena is
worse than an absent one.

Surface `supportedTrust` on the profile. An agent declaring `tee-attestation`
deserves a visible badge; it is exactly the "beyond basic counts" data the rubric
asks for.

---

## BNB Agent Studio v2 — the agent runtime

**SDK:** `@bnbagent/sdk` (TypeScript) · **CLI:** `bag init`

Agent Studio v2 matters for two reasons: TypeScript support means our agents live
in the same language as the rest of the stack, and the v2 x402 receiving interfaces
mean agents can actually earn, closing the commerce loop rather than only spending.

### Scaffolding

```bash
bag init khoros-rebalancing --template typescript
```

Each of the four categories gets its own runtime under `agents/`. They share a
common harness (`packages/core`) for trigger evaluation, intent construction,
verifier calls, and telemetry emission — only the strategy differs.

### Gas

MegaFuel sponsors testnet gas for registration and transactions. Wire it in early;
it removes the faucet loop that otherwise eats development time.

### The runtime loop

```ts
while (engagement.active) {
  const state = await readProtocolState(engagement);
  const decision = strategy.evaluate(state, engagement.boundaries);
  if (!decision.shouldAct) { await sleep(interval); continue; }

  const intent = buildIntent(decision);
  const result = await verifier.simulate({ intent, policyHash, sessionKey });

  if (!result.ok) {
    await telemetry.blocked({ intent, reason: result.reason });
    await sleep(interval);
    continue;
  }

  const tx = await executor.execute(intent, result.pdr, decision.payload);
  await telemetry.executed({ intent, tx });
  await sleep(interval);
}
```

`telemetry.blocked` is as important as `telemetry.executed`. Both feed the dashboard.

---

## ERC-8183 — agent commerce

**Spec:** EIP-8183 · **Impl:** `@bnbagent/sdk`, Altana ERC-8183 SDK

Three roles — client, provider, evaluator. Four states — Open, Funded, Submitted,
Terminal. The client funds escrow, the provider delivers, the evaluator releases or
rejects, and expiry refunds the client if nobody acts.

### Hiring

```ts
import { BNBAgentClient } from "@bnbagent/sdk";

const client = new BNBAgentClient({ chainId: 97 });

const job = await client.createJob({
  provider: agentAddress,
  budget: parseUnits("5", 18),
  token: BSC_USD,
  evaluator: OPTIMISTIC_POLICY,   // optimistic settlement
  expiry: Math.floor(Date.now()/1000) + 7*24*3600,
  taskUri: ipfsUri(engagementManifest),
});

await client.fundJob({ jobId: job.jobId, expectedBudget: parseUnits("5", 18) });
```

### The coordinator (Altana bonus)

For multi-category intents, a coordinator agent is the client of sub-jobs:

```
user → parent job → coordinator agent
                       ├── sub-job → health-factor specialist
                       └── sub-job → yield specialist
```

Use `hireErc8183Agent` from the Altana ERC-8183 SDK for the buyer side — the bonus
criterion names this specifically. Each sub-job gets its own escrow and each
specialist gets its own session scoped to its own slice of capital, so two agents
can never spend the same dollar.

Render the whole cascade live in the UI. A judge watching parent-funded →
sub-job-posted → accepted → delivered → settled, with a transaction link at each
step, sees the bonus criterion satisfied in a way no README claim achieves.

### Evaluator honesty

The spec has no dispute resolution — reject or expire is final, and the evaluator
holds unilateral power. Do not paper over this. Use optimistic settlement with a
visible challenge window, state in the UI who the evaluator is, and say plainly on
`/verify` that evaluator trust is an open problem in the standard. Judges know
this; acknowledging it reads as competence.

---

## x402 / b402 — per-call payments

**SDK:** `@altananetwork/x402-server`

Two uses:

1. **Settlement rail.** Escrow releases pay the agent via x402.
2. **Seller side (bonus).** Khoros exposes its own priced endpoints — the trust
   score API and the benchmark harness — behind b402, so other agents can pay per
   call to consume Khoros data. Implementing the seller side, not just the buyer
   side, is what the Altana bonus asks for.

The x402 receipts produced here feed back into trust scoring as payment evidence.
The loop is self-reinforcing and worth pointing out during the demo.

---

## DeFi protocols

### PancakeSwap V3 — the CAKE track

**Portal:** `developer.pancakeswap.finance`

| Contract | Used by | Functions |
|----------|---------|-----------|
| NonfungiblePositionManager | Rebalancing | `mint`, `decreaseLiquidity`, `collect`, `increaseLiquidity` |
| SwapRouter | Grid, Rebalancing, Health Factor | `exactInputSingle`, `exactOutputSingle` |
| Quoter V2 | All | `quoteExactInputSingle` for pre-trade pricing |
| Factory / Pool | All | `slot0` for spot tick, `observe` for TWAP |

Use TWAP from `observe` for any decision that a manipulated spot price could
exploit; use `slot0` only for display. This distinction is the difference between a
sandwich-resistant agent and a sandwich victim.

The PancakeSwap track asks for real benefit to traders or LPs. Make it explicit on
the PancakeSwap-facing surfaces: fee APR captured, time in range, impermanent loss
avoided, volume generated for the pool.

### Venus Protocol

`Comptroller` for account liquidity and market entry; `vToken` for `mint`,
`redeemUnderlying`, `repayBorrow`, `borrowBalanceCurrent`. Health factor is derived
from `getAccountLiquidity` plus per-market collateral factors.

`borrow` is never in any session scope. Not for the yield agent, not for the health
factor agent.

### Lista DAO

Liquid staking — stake BNB, receive slisBNB. Used by the yield agent as a
destination and by the health factor agent as a collateral reserve source.

### Aave V3

`Pool` for `supply`, `repay`, `withdraw`; `getUserAccountData` returns health factor
directly, which is simpler than Venus's derivation. Supported alongside Venus so
the health factor category is not single-protocol.

---

## Environment variables

```
# chain
BSC_MAINNET_RPC=
BSC_TESTNET_RPC=

# 8004scan
SCAN8004_API_KEY=
SCAN8004_BASE_URL=https://8004scan.io/api

# altana
ALTANA_API_KEY=
ALTANA_KEYSTORE_ADDRESS=

# bnb agent studio
BNBAGENT_CHAIN_ID=97
MEGAFUEL_PAYMASTER_URL=

# pace verifier
VERIFIER_URL=
VERIFIER_SIGNER_KEY=        # KMS reference in deployed envs, never a raw key
EXECUTOR_ADDRESS=

# data
DATABASE_URL=
REDIS_URL=
```

Commit `.env.example` with every key and no values. The verifier signer is
referenced by KMS handle outside local development.
