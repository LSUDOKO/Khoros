# What the ERC-8004 registry on BSC actually contains

Measured 2026-09-07 against `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`
(chain 56) with the reader in `registry.ts`. Reproduce with the probe described
at the bottom.

## Interface

`docs/06-INTEGRATIONS.md` assumes an enumerable registry. It is not.

| Assumed | Actual |
|---|---|
| `totalSupply()` | **Reverts.** Not ERC721Enumerable, so no `tokenByIndex` either. Ids must be walked directly. |
| Registration fetched over HTTP/IPFS | Usually an **on-chain `data:` URI**, base64, sometimes **gzip-compressed** (`data:application/json;enc=gzip;level=6;base64,...`). |
| — | Some `tokenURI` values are a bare address or a non-URL string with no document behind them. |

The contract is an NFT: `name()` = `AgentIdentity`, `symbol()` = `AGENT`.
Documents follow `eips.ethereum.org/EIPS/eip-8004#registration-v1` and carry
`services[]` with OASF `skills[]` and `domains[]` arrays.

Ids exist well past 300,000, so the "~200k agents" figure in `CLAUDE.md` is at
least the right order of magnitude.

## Content

Sampled 150 ids spread across the id space (1, 7777, 33333, 99999, 177777,
255555 — 25 consecutive from each):

| Measure | Count |
|---|---|
| Ids checked | 150 |
| Resolved to a registration document | 143 (95%) |
| Description longer than 40 chars and not just the name repeated | 62 (43%) |
| Classified into one of our four DeFi categories | **0** |

The registry is dominated by two patterns:

1. **Name-spam registrations** — `description` is the name repeated, e.g.
   `"BSCAIBSCAIBSCAIBSCAI…"`. These carry OASF service tags that mention DeFi
   vocabulary, which is why a naive keyword scan reports ~32% "DeFi-ish" while
   the true count of DeFi agents is zero.
2. **Bulk duplicates** — long runs of identical registrations, e.g. ids
   7777–7783+ all `"Debot Trading Agent"`.

## What this means for Khoros

**The classifier is not the problem.** It correctly declines to categorise
these. Loosening it to fill the arenas would put name-spam into a
health-factor leaderboard, and someone hiring from that arena expects a
health-factor agent. A wrong category is worse than an honest gap.

`docs/10-BUILD_PLAN.md` anticipated exactly this and authorises the response:

> "be willing to hand-curate a seed set of known-good agents per category so no
> arena is empty during judging"

So: real registry ingest stays as the source of identity data, and a curated
seed set provides category coverage. Seeded agents are marked as such in the
database and labelled in the UI, so nothing claims a curated entry was
discovered automatically.

## Reproducing

```ts
import { createRegistryClient, readAgents } from "./registry.js";
import { classificationDistribution } from "../classify.js";

const client = createRegistryClient(56, "https://bsc-rpc.publicnode.com");
const agents = await readAgents(client, 56, { fromId: 1n, count: 40, concurrency: 6 });
console.log(classificationDistribution(agents.map((a) => a.classification)));
```
