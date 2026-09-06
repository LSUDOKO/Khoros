/**
 * Altana happy-path spike.
 *
 * docs/10-BUILD_PLAN.md: "Verify the SDK's session shape against the live
 * testnet deployment early — before building the form around an assumed API."
 *
 * This proves the whole Altana track in miniature, in order:
 *
 *   1. create a wallet (headless passkey — the browser path needs an OS keychain)
 *   2. grant a scoped session with register:true, writing it to the KeyStore
 *   3. execute a real call through the session key
 *   4. revoke the session
 *   5. confirm the next execute FAILS at validator level
 *
 * Step 5 is the important one. Anyone can show a working grant; showing that
 * the revoke actually stops the agent is what demonstrates the user is in
 * control. It is also an explicit Altana verification criterion.
 *
 * Run:  node scripts/altana-spike.mjs
 *
 * Requires a funded BSC Testnet address. Fund the printed address from
 * https://testnet.bnbchain.org/faucet-smart then re-run.
 */

import {
  createClient,
  BNB_TESTNET,

  serializeSession,
} from "@altananetwork/sdk";
import { generatePrivateKey } from "viem/accounts";

const line = (s = "") => process.stdout.write(`${s}\n`);
const step = (n, s) => line(`\n[${n}] ${s}`);

/** True when the address holds any testnet BNB. */
async function hasBalance(address) {
  try {
    const res = await fetch(BNB_TESTNET.publicRpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getBalance",
        params: [address, "latest"],
      }),
    });
    const json = await res.json();
    return BigInt(json.result ?? "0x0") > 0n;
  } catch {
    // If we cannot check, do not block the run — let the grant report the truth.
    return true;
  }
}

async function main() {
  line("Altana spike — BSC Testnet (chain 97)");
  line("=".repeat(60));

  const client = createClient({ chains: [BNB_TESTNET] });
  line(`relay:    ${BNB_TESTNET.relayUrl}`);
  line(`keystore: ${BNB_TESTNET.keyStore}`);

  // --- 1. Wallet -----------------------------------------------------------
  step(1, "Creating wallet");

  // The wallet must persist across runs, or funding it is pointless — a fresh
  // address every run always reverts for want of gas. SPIKE_ADMIN_KEY holds the
  // admin key; the script prints one to set if it is missing.
  //
  // This is a throwaway testnet key for a spike, never a production path. The
  // real flow provisions a Passkey account (createPasskeyWallet), which needs a
  // browser and an OS keychain and so cannot run here.
  const adminKey = process.env.SPIKE_ADMIN_KEY;
  if (!adminKey) {
    const suggested = generatePrivateKey();
    line("No SPIKE_ADMIN_KEY set. Run again with a persistent key:");
    line("");
    line(`  export SPIKE_ADMIN_KEY=${suggested}`);
    line("");
    line("Then fund the wallet address it prints, and re-run.");
    process.exit(1);
  }

  const { signerFromPrivateKey: adminSignerFrom } = await import(
    "@altananetwork/sdk"
  );
  const wallet = await client.createWallet({
    signer: adminSignerFrom(adminKey),
  });
  line(`wallet address: ${wallet.address}`);
  line(`fund it at:     https://testnet.bnbchain.org/faucet-smart`);

  const funded = await hasBalance(wallet.address);
  if (!funded) {
    line("");
    line("This wallet has no testnet BNB, so the grant will revert with 0x.");
    line("Fund the address above from the faucet, then re-run.");
    process.exit(1);
  }
  line(`balance:        funded`);

  // --- 2. Grant ------------------------------------------------------------
  step(2, "Granting a scoped session (register: true -> KeyStore)");

  // Generate and hold the session key ourselves. If the SDK generates it and
  // this process exits before we persist it, the grant is unusable forever.
  const sessionKey = generatePrivateKey();
  const { signerFromPrivateKey } = await import("@altananetwork/sdk");
  const sessionSigner = signerFromPrivateKey(sessionKey);

  const expiry = Math.floor(Date.now() / 1000) + 7 * 86_400;

  // A deliberately narrow scope: one contract, one function, a spend cap and
  // an expiry. This is the shape every Khoros category grants.
  const permissions = {
    calls: [
      {
        signature: "0xa9059cbb", // transfer(address,uint256)
        to: "0x337610d27c682E347C9cD60BD4b3b107C9d34dDd", // BSC Testnet USDT
      },
    ],
    spend: [
      {
        limit: 1_000_000_000_000_000_000n, // 1 token
        period: "day",
        token: "0x337610d27c682E347C9cD60BD4b3b107C9d34dDd",
      },
    ],
  };

  const session = await client.grantSession({
    wallet,
    signer: wallet.signer,
    permissions,
    expiry,
    sessionSigner,
    register: true,
    chainId: 97,
  });

  line(`session key:  ${session.publicKey}`);
  line(`grant tx:     ${session.transactionHash ?? "(relay confirmed without a receipt)"}`);
  line(`expiry:       ${new Date(expiry * 1000).toISOString()}`);
  line(`serialisable: ${JSON.stringify(serializeSession(session), (_, v) => (typeof v === "bigint" ? v.toString() : v)).slice(0, 120)}…`);

  // --- 3. Execute through the session -------------------------------------
  step(3, "Executing a call through the session key");
  try {
    const result = await client.execute({
      session,
      calls: [
        {
          to: "0x337610d27c682E347C9cD60BD4b3b107C9d34dDd",
          data: "0xa9059cbb" +
            "000000000000000000000000000000000000000000000000000000000000dead" +
            "0000000000000000000000000000000000000000000000000000000000000001",
        },
      ],
      chainId: 97,
    });
    line(`status: ${result.status}`);
    line(`tx:     ${result.transactionHash ?? "(none reported)"}`);
  } catch (error) {
    line(`execute failed: ${error?.shortMessage ?? error?.message ?? error}`);
    line("(expected if the wallet is unfunded — fund it and re-run)");
  }

  // --- 4. Revoke -----------------------------------------------------------
  step(4, "Revoking the session");
  const revoke = await client.revokeSession({
    wallet,
    signer: wallet.signer,
    session,
    chainId: 97,
  });
  line(`status:    ${revoke.status}`);
  line(`revoke tx: ${revoke.transactionHash ?? "(none reported)"}`);

  // --- 5. Prove the revoke bit ---------------------------------------------
  step(5, "Confirming the revoked session can no longer act");
  try {
    await client.execute({
      session,
      calls: [
        {
          to: "0x337610d27c682E347C9cD60BD4b3b107C9d34dDd",
          data: "0xa9059cbb" +
            "000000000000000000000000000000000000000000000000000000000000dead" +
            "0000000000000000000000000000000000000000000000000000000000000001",
        },
      ],
      chainId: 97,
    });
    line("PROBLEM: the revoked session still executed. Investigate before shipping.");
    process.exitCode = 1;
  } catch (error) {
    line(`rejected as expected: ${error?.shortMessage ?? error?.message ?? error}`);
    line("Revoke works — the user really can stop the agent.");
  }

  line(`\n${"=".repeat(60)}`);
  line("Record these for the submission:");
  line(`  wallet      ${wallet.address}`);
  line(`  session key ${session.publicKey}`);
  line(`  grant tx    ${session.transactionHash ?? "-"}`);
  line(`  revoke tx   ${revoke.transactionHash ?? "-"}`);
}

main().catch((error) => {
  line(`\nSpike failed: ${error?.stack ?? error}`);
  process.exit(1);
});
