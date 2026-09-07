/**
 * Verify every configured contract address actually has deployed bytecode.
 *
 * An address with no code is a silent failure: the session grant succeeds, the
 * permissions copy reads correctly, and the agent can never act. Cheap to check,
 * expensive to discover during judging.
 *
 * Run: pnpm verify:addresses
 */

const RPC = {
  56: "https://bsc-rpc.publicnode.com",
  97: "https://bsc-testnet-rpc.publicnode.com",
};

// Mirrored from lib/chain/addresses.ts. Kept as plain data so this script runs
// under node without a TypeScript loader.
const SETS = [
  {
    chainId: 56,
    label: "BSC Mainnet (read-only)",
    addresses: {
      PANCAKE_V3_POSITION_MANAGER: "0x46A15B0b27311cedF172AB29E4f4766fbE7F4364",
      PANCAKE_V3_SWAP_ROUTER: "0x13f4EA83D0bd40E75C8222255bc855a974568Dd4",
      PANCAKE_V3_QUOTER: "0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997",
      PANCAKE_V3_FACTORY: "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865",
      VENUS_COMPTROLLER: "0xfD36E2c2a6789Db23113685031d7F16329158384",
      VENUS_VTOKEN: "0xfD5840Cd36d94D7229439859C0112a4185BC0255",
      AAVE_V3_POOL: "0x6807dc923806fE8Fd134338EABCA509979a7e0cB",
      LISTA_STAKING: "0x1adB950d8bB3dA4bE104211D5AB038628e477fE6",
      USDT: "0x55d398326f99059fF775485246999027B3197955",
      CAKE: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82",
      WBNB: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
    },
  },
  {
    chainId: 97,
    label: "BSC Testnet (execution)",
    addresses: {
      PANCAKE_V3_POSITION_MANAGER: "0x427bF5b37357632377eCbEC9de3626C71A5396c1",
      PANCAKE_V3_SWAP_ROUTER: "0x9a489505a00cE272eAa5e07Dba6491314CaE3796",
      PANCAKE_V3_QUOTER: "0xbC203d7f83677c7ed3F7acEc959963E7F4ECC5C2",
      PANCAKE_V3_FACTORY: "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865",
      USDT: "0x337610d27c682E347C9cD60BD4b3b107C9d34dDd",
      WBNB: "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd",
      // The ERC-8183 stack, from the SDK's own deployment registry.
      ERC8183_COMMERCE: "0xa206c0517B6371C6638CD9e4a42Cc9f02A33B0DE",
      ERC8183_ROUTER: "0xD7d36D66d2F1B608A0F943f722D27e3744f66F25",
      ERC8183_POLICY: "0xd6a4217588F6B1F5657a92A3e94E6422aD771cEA",
      ERC8004_REGISTRY: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
      PAYMENT_TOKEN_U: "0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565",
    },
  },
];

async function getCode(rpc, address) {
  const res = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getCode",
      params: [address, "latest"],
    }),
  });
  const json = await res.json();
  return json.result ?? "0x";
}

let failures = 0;

for (const set of SETS) {
  process.stdout.write(`\n${set.label} — chain ${set.chainId}\n`);
  const rpc = RPC[set.chainId];

  for (const [name, address] of Object.entries(set.addresses)) {
    try {
      const code = await getCode(rpc, address);
      if (code.length > 4) {
        process.stdout.write(`  ok       ${name}\n`);
      } else {
        process.stdout.write(`  NO CODE  ${name}  ${address}\n`);
        failures += 1;
      }
    } catch (error) {
      process.stdout.write(`  ERROR    ${name}  ${error?.message ?? error}\n`);
      failures += 1;
    }
  }
}

if (failures > 0) {
  process.stdout.write(`\n${failures} address(es) have no deployed code.\n`);
  process.exit(1);
}
process.stdout.write("\nAll addresses have deployed code.\n");
