/**
 * Direct ERC-8004 registry reads.
 *
 * docs/10 names this as both the fallback when the 8004scan Pro key is
 * unavailable and the cross-check against it: "direct ERC-8004 registry reads
 * via viem as fallback and cross-check, with disagreements logged".
 *
 * VERIFIED against the live contract on 2026-09-07, and the interface is NOT
 * what docs/06 assumes:
 *
 *   - the registry is an NFT named "AgentIdentity" (symbol AGENT)
 *   - `totalSupply()` REVERTS — it is not ERC721Enumerable, so there is no
 *     tokenByIndex and no way to ask how many agents exist. Ids are walked
 *     directly instead, and a missing id is skipped rather than ending the walk.
 *   - `tokenURI(id)` returns a base64 `data:application/json` URI, so the
 *     registration document is ON-CHAIN. No IPFS gateway is needed for these,
 *     though the http/ipfs paths are kept for agents that use them.
 *   - the document follows eip-8004#registration-v1 and carries `services[]`
 *     entries with `skills[]` and `domains[]` arrays — much stronger
 *     classification signal than the prose description.
 *
 * Registry addresses come from the same deployment the Altana SDK uses:
 *   chain 56: 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432
 *   chain 97: 0x8004A818BFB912233c491871b3d84c89A494BD9e
 */

import { gunzipSync } from "node:zlib";

import { createPublicClient, http, parseAbi, type PublicClient } from "viem";
import { bsc, bscTestnet } from "viem/chains";

import { classify, type Classification } from "../classify.js";

export const ERC8004_REGISTRY = {
  56: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
  97: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
} as const;

const REGISTRY_ABI = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",
]);

export type AgentService = {
  name: string;
  endpoint: string;
  version?: string;
  skills?: string[];
  domains?: string[];
};

export type IndexedAgent = {
  agentId: bigint;
  registry: string;
  owner: `0x${string}`;
  name: string;
  description: string;
  image?: string;
  registeredAt: bigint;
  active: boolean;
  supportedTrust: string[];
  services: AgentService[];
  x402Support: boolean;
  classification: Classification;
};

export function createRegistryClient(chainId: 56 | 97, rpcUrl?: string): PublicClient {
  return createPublicClient({
    chain: chainId === 56 ? bsc : bscTestnet,
    transport: http(rpcUrl),
  }) as PublicClient;
}

export type RegistrationDoc = {
  name?: string;
  description?: string;
  image?: string;
  services?: AgentService[];
  supportedTrust?: string[];
  x402Support?: boolean;
  active?: boolean;
  tags?: string[];
};

/** Narrow an untrusted registration document without `any`. */
export function parseRegistration(value: unknown): RegistrationDoc {
  if (typeof value !== "object" || value === null) return {};
  const v = value as Record<string, unknown>;

  const strings = (x: unknown): string[] | undefined =>
    Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : undefined;

  const services: AgentService[] | undefined = Array.isArray(v.services)
    ? v.services.flatMap((s) => {
        if (typeof s !== "object" || s === null) return [];
        const svc = s as Record<string, unknown>;
        if (typeof svc.name !== "string" || typeof svc.endpoint !== "string") return [];
        return [
          {
            name: svc.name,
            endpoint: svc.endpoint,
            version: typeof svc.version === "string" ? svc.version : undefined,
            skills: strings(svc.skills),
            domains: strings(svc.domains),
          },
        ];
      })
    : undefined;

  return {
    name: typeof v.name === "string" ? v.name : undefined,
    description: typeof v.description === "string" ? v.description : undefined,
    image: typeof v.image === "string" ? v.image : undefined,
    supportedTrust: strings(v.supportedTrust),
    x402Support: typeof v.x402Support === "boolean" ? v.x402Support : undefined,
    active: typeof v.active === "boolean" ? v.active : undefined,
    tags: strings(v.tags),
    services,
  };
}

/**
 * Resolve a tokenURI to its document.
 *
 * The common case on this registry is an inline base64 data URI, which needs no
 * network call at all.
 */
export async function resolveRegistration(
  uri: string,
  timeoutMs = 8000,
): Promise<RegistrationDoc | undefined> {
  // On-chain data URI — decode directly, no network call.
  if (uri.startsWith("data:")) {
    const comma = uri.indexOf(",");
    if (comma === -1) return undefined;
    const meta = uri.slice(0, comma);
    const payload = uri.slice(comma + 1);

    try {
      let bytes = meta.includes("base64")
        ? Buffer.from(payload, "base64")
        : Buffer.from(decodeURIComponent(payload), "utf8");

      // Observed in the wild on this registry:
      //   data:application/json;enc=gzip;level=6;base64,...
      // Without this branch those agents silently return undefined and land in
      // `uncategorised`, which is exactly the failure docs/10 warns about.
      if (/enc=gzip|encoding=gzip/i.test(meta)) {
        bytes = gunzipSync(bytes);
      }

      return parseRegistration(JSON.parse(bytes.toString("utf8")));
    } catch {
      return undefined;
    }
  }

  // Some registrations point at a bare address or a non-URL string rather than
  // a document. Nothing to fetch; treat as absent rather than attempting it.
  if (!/^https?:\/\//i.test(uri) && !uri.startsWith("ipfs://")) {
    return undefined;
  }

  const url = uri.startsWith("ipfs://")
    ? `https://ipfs.io/ipfs/${uri.slice("ipfs://".length)}`
    : uri;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return undefined;
    return parseRegistration(await res.json());
  } catch {
    // A registration we cannot fetch means an agent we cannot classify. That is
    // an honest `uncategorised`, not a reason to invent a category.
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Classification signal from a registration document.
 *
 * The OASF `skills` and `domains` arrays are far more reliable than marketing
 * prose, so they are folded in as tags where present.
 */
export function classificationInput(doc: RegistrationDoc): {
  name: string;
  description: string;
  tags: string[];
} {
  const tags: string[] = [...(doc.tags ?? [])];
  for (const service of doc.services ?? []) {
    tags.push(...(service.skills ?? []), ...(service.domains ?? []));
  }
  return {
    name: doc.name ?? "",
    description: doc.description ?? "",
    tags,
  };
}

/**
 * Read a range of agent ids.
 *
 * Ids are walked directly because the registry is not enumerable — there is no
 * totalSupply to page against. A missing id is skipped rather than treated as
 * the end of the set, since ids need not be contiguous.
 */
export async function readAgents(
  client: PublicClient,
  chainId: 56 | 97,
  opts: { fromId: bigint; count: number; concurrency?: number },
): Promise<IndexedAgent[]> {
  const address = ERC8004_REGISTRY[chainId] as `0x${string}`;
  const registry = `eip155:${chainId}:${address}`;
  const concurrency = opts.concurrency ?? 8;

  const ids: bigint[] = [];
  for (let i = 0; i < opts.count; i++) ids.push(opts.fromId + BigInt(i));

  const agents: IndexedAgent[] = [];

  // Bounded concurrency: a public RPC will rate-limit an unbounded fan-out
  // across hundreds of thousands of ids.
  for (let i = 0; i < ids.length; i += concurrency) {
    const batch = ids.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(async (tokenId) => {
        try {
          const [owner, uri] = await Promise.all([
            client.readContract({
              address,
              abi: REGISTRY_ABI,
              functionName: "ownerOf",
              args: [tokenId],
            }),
            client.readContract({
              address,
              abi: REGISTRY_ABI,
              functionName: "tokenURI",
              args: [tokenId],
            }),
          ]);

          const doc = (await resolveRegistration(uri)) ?? {};
          const input = classificationInput(doc);
          const name = input.name || `Agent #${tokenId}`;

          const agent: IndexedAgent = {
            agentId: tokenId,
            registry,
            owner,
            name,
            description: input.description,
            image: doc.image,
            // This interface exposes no registration timestamp. Left at 0
            // rather than guessed; a backfill fills it from the Transfer log.
            registeredAt: 0n,
            active: doc.active ?? true,
            supportedTrust: doc.supportedTrust ?? [],
            services: doc.services ?? [],
            x402Support: doc.x402Support ?? false,
            classification: classify({ ...input, name }),
          };
          return agent;
        } catch {
          // A non-existent or unreadable id. Skip it; ids are not contiguous.
          return undefined;
        }
      }),
    );

    for (const r of results) if (r) agents.push(r);
  }

  return agents;
}
