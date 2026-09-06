# Testnet setup — what needs a human

Everything else in this repo builds and tests without credentials. These steps
cannot be automated, and the live-transaction criteria for three tracks depend on
them.

---

## 1. Fund the spike wallet (blocks the Altana track)

The Altana track's five mandatory criteria all require **real on-chain
transactions on BSC Testnet**. The code path is verified — the SDK loads, the
client reaches the live relay at `https://testnet-relay.altana.network`, and
wallet creation and `grantSession` both reach the chain — but every write
reverts with `0x` because the wallet holds no testnet BNB.

The BNB faucet rejects programmatic requests (HTTP 403); it needs a browser and
a captcha.

**Do this:**

1. Open https://testnet.bnbchain.org/faucet-smart
2. Request BNB for:

   ```
   0x7A6fd27153400fA405391e8B05033928CA997A9c
   ```

3. Run the spike:

   ```bash
   cd apps/web
   export SPIKE_ADMIN_KEY=0xf3710013d9de0326eb6668dd99a84a05a17327d0d60ea3e3ad250b07f6b0f1e8
   node scripts/altana-spike.mjs
   ```

The spike proves the whole Altana track in miniature: create wallet → grant a
scoped session with `register: true` (KeyStore) → execute through the session key
→ revoke → **confirm the next execute fails**. That last step is the one that
matters; anyone can demo a working grant, but showing the revoke actually stops
the agent is what demonstrates the user is in control, and it is an explicit
Altana verification criterion.

It prints the wallet address, session key, grant tx and revoke tx. Those go in
the submission — the Altana track requires wallet addresses.

> `SPIKE_ADMIN_KEY` is a throwaway testnet key for this spike only. It is not a
> production path and holds nothing of value. The real flow provisions a Passkey
> account via `createPasskeyWallet`, which needs a browser and an OS keychain.

---

## 2. Apply for the 8004scan Pro API key

`docs/10-BUILD_PLAN.md` says this is not instant, so it wants applying for early.

- Apply: https://8004scan.io/developers (Pro-Tier Upgrade Form)
- Set `SCAN8004_API_KEY` once it arrives

**Not a hard blocker.** The indexer falls back to direct ERC-8004 registry reads
via viem, which `docs/10` names as the intended fallback and cross-check. The Pro
key mainly buys ingest speed and rate limit.

---

## 3. Provision Postgres

Any Postgres works — Neon and Supabase both have free tiers.

```bash
export DATABASE_URL=postgres://...
pnpm migrate
```

Without it the arena renders a designed "rankings unavailable" state rather than
fabricated rows. That is deliberate: `CLAUDE.md` rule 5 forbids inventing data,
so an unreachable indexer must look unreachable.

---

## Status

| Step | State |
|---|---|
| Altana SDK verified against live testnet | Done — relay reachable, client API confirmed |
| Wallet funded | **Blocked on the faucet captcha** |
| 8004scan Pro key | Not yet applied for |
| Postgres | Not yet provisioned |
