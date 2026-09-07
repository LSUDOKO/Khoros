/**
 * Contract addresses per chain.
 *
 * docs/06-INTEGRATIONS.md names every one of these contracts but supplies no
 * addresses — every value there is a bare identifier. These are the real
 * deployments, and each is marked with how it was obtained so a wrong one is
 * traceable rather than mysterious.
 *
 * Anything not yet confirmed is absent rather than guessed. buildSessionScope
 * throws on a missing target, which is the correct failure: a session must
 * never be granted over an address we are unsure of.
 *
 * VERIFIED 2026-09-07: every address below was checked with eth_getCode against
 * a public RPC for its chain and returned deployed bytecode. Re-run
 * `pnpm verify:addresses` after changing any of them — an address with no code
 * makes a session scope point at nothing, so the grant succeeds while the agent
 * can never act, which is a silent failure rather than a loud one.
 */

import type { Address } from "@khoros/core";
import type { TokenMeta } from "@khoros/core";

export const CHAIN_IDS = { mainnet: 56, testnet: 97 } as const;

/**
 * BSC Mainnet (56) — read-only. Used for agent registry data and for the
 * permissions preview, which needs a plausible address to render copy against.
 * Verified from PancakeSwap's published deployment list.
 */
export const MAINNET_TARGETS: Record<string, Address> = {
  PANCAKE_V3_POSITION_MANAGER: "0x46A15B0b27311cedF172AB29E4f4766fbE7F4364",
  PANCAKE_V3_SWAP_ROUTER: "0x13f4EA83D0bd40E75C8222255bc855a974568Dd4",
  PANCAKE_V3_QUOTER: "0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997",
  PANCAKE_V3_FACTORY: "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865",
  VENUS_COMPTROLLER: "0xfD36E2c2a6789Db23113685031d7F16329158384",
  VENUS_VTOKEN: "0xfD5840Cd36d94D7229439859C0112a4185BC0255", // vUSDT
  AAVE_V3_POOL: "0x6807dc923806fE8Fd134338EABCA509979a7e0cB",
  LISTA_STAKING: "0x1adB950d8bB3dA4bE104211D5AB038628e477fE6", // slisBNB stake manager
};

/**
 * BSC Testnet (97) — where every write happens.
 *
 * Only addresses confirmed on chain 97 belong here. A mainnet address copied
 * into this map would make a session scope point at nothing, and the grant
 * would succeed while the agent could never act.
 */
export const TESTNET_TARGETS: Record<string, Address> = {
  PANCAKE_V3_POSITION_MANAGER: "0x427bF5b37357632377eCbEC9de3626C71A5396c1",
  PANCAKE_V3_SWAP_ROUTER: "0x9a489505a00cE272eAa5e07Dba6491314CaE3796",
  PANCAKE_V3_QUOTER: "0xbC203d7f83677c7ed3F7acEc959963E7F4ECC5C2",
  PANCAKE_V3_FACTORY: "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865",

  // Venus on BSC Testnet. The Comptroller answers isComptroller() = true, and
  // the vTokens below were read out of its own getAllMarkets() list (49
  // markets) rather than copied from a blog post — so they are the markets
  // this deployment actually recognises.
  VENUS_COMPTROLLER: "0x94d1820b2D1c7c7452A163983Dc888CEC546b77D",
  VENUS_VTOKEN: "0xb7526572FFE56AB9D7489838Bf2E18e3323b441A", // vUSDT
  VENUS_VBNB: "0x2E7222e51c0f6e98610A1543Aa3836E092CDe62c",
};

/**
 * Contracts a category needs that are NOT deployed on BSC Testnet.
 *
 * Aave V3 has no BSC Testnet deployment we could verify — the mainnet Pool
 * address holds no code on chain 97. Rather than point a session scope at an
 * address with nothing behind it (which would let a grant succeed while the
 * agent could never act), the target is declared missing here and the affected
 * category drops it from its scope, with the UI saying which protocol is
 * unavailable and why.
 */
export const TESTNET_UNAVAILABLE: Record<string, string> = {
  AAVE_V3_POOL:
    "Aave V3 has no verified BSC Testnet deployment, so on testnet this agent works with Venus and PancakeSwap.",
  LISTA_STAKING:
    "Lista has no verified BSC Testnet deployment — its mainnet staking manager holds no code on chain 97 — so on testnet this agent routes between Venus and PancakeSwap.",
};

/** Tokens, with the decimals every amount must carry alongside it. */
export const MAINNET_TOKENS: Record<string, { address: Address; meta: TokenMeta }> = {
  USDT: {
    address: "0x55d398326f99059fF775485246999027B3197955",
    meta: { symbol: "USDT", decimals: 18 },
  },
  CAKE: {
    address: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82",
    meta: { symbol: "CAKE", decimals: 18 },
  },
  WBNB: {
    address: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
    meta: { symbol: "WBNB", decimals: 18 },
  },
};

export const TESTNET_TOKENS: Record<string, { address: Address; meta: TokenMeta }> = {
  USDT: {
    address: "0x337610d27c682E347C9cD60BD4b3b107C9d34dDd",
    meta: { symbol: "USDT", decimals: 18 },
  },
  WBNB: {
    address: "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd",
    meta: { symbol: "WBNB", decimals: 18 },
  },
};

/** Address -> token metadata, for describeScope's token naming. */
export const TOKEN_META: Record<string, TokenMeta> = Object.fromEntries(
  [...Object.values(MAINNET_TOKENS), ...Object.values(TESTNET_TOKENS)].map((t) => [
    t.address.toLowerCase(),
    t.meta,
  ]),
);

export function targetsForChain(chainId: 56 | 97): Record<string, Address> {
  return chainId === 97 ? TESTNET_TARGETS : MAINNET_TARGETS;
}

/**
 * Targets used to render the read-only permissions preview on a profile.
 *
 * Mainnet is used here deliberately: the preview illustrates which contracts a
 * category touches, and the mainnet set is complete. The hire flow uses the
 * testnet set, because that is where the grant actually happens.
 */
export const PREVIEW_TARGETS = MAINNET_TARGETS;
export const PREVIEW_TOKEN = MAINNET_TOKENS.USDT!.address;

/** The token an engagement spends on testnet. */
export const EXECUTION_TOKEN = TESTNET_TOKENS.USDT!.address;
export const EXECUTION_TOKEN_DECIMALS = TESTNET_TOKENS.USDT!.meta.decimals;
