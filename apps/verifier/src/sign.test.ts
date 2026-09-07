/**
 * Signing tests.
 *
 * The load-bearing assertion: the digest this service signs must be byte-identical
 * to the one PolicyAttestedExecutor computes. If they diverge, every PDR is
 * rejected on-chain and the whole safety layer is inert — a failure that would
 * only show up against a live chain, which is exactly why it is tested here.
 */

import { encodeAbiParameters, keccak256, recoverMessageAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";

import { loadSigner, pdrInnerHash, signerFromPrivateKey } from "./sign.js";

const KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;

const pdr = {
  intentHash: keccak256("0x1234") as Hex,
  simulationReportHash: keccak256("0x5678") as Hex,
  policyHash: keccak256("0x9abc") as Hex,
  simulationBlock: 45_000_000n,
  validUntil: 1_760_000_060n,
};

describe("pdrInnerHash", () => {
  /**
   * Recomputes the hash the way the Solidity does, independently of the
   * implementation, so this is a real cross-check rather than a restatement.
   *
   * Solidity:
   *   keccak256(abi.encode(intentHash, simulationReportHash, policyHash,
   *                        simulationBlock, validUntil))
   */
  it("matches the contract's abi.encode layout", () => {
    const expected = keccak256(
      encodeAbiParameters(
        [
          { type: "bytes32" },
          { type: "bytes32" },
          { type: "bytes32" },
          { type: "uint256" },
          { type: "uint256" },
        ],
        [
          pdr.intentHash,
          pdr.simulationReportHash,
          pdr.policyHash,
          pdr.simulationBlock,
          pdr.validUntil,
        ],
      ),
    );

    expect(pdrInnerHash(pdr)).toBe(expected);

    // Pinned to the same literal the Solidity test asserts
    // (contracts/test/CrossCheckDigest.t.sol). Verified independently with
    // `cast keccak` over `cast abi-encode`. If either side's encoding drifts,
    // one of these two tests fails rather than every PDR silently becoming
    // unverifiable on-chain.
    expect(pdrInnerHash(pdr)).toBe(
      "0x12968f7e00a5b2b02a8fa4c4400a094813326d441242d67ab184e184934b6b8a",
    );
  });

  // Each field must actually change the hash, or it is not really committed to.
  it("commits to the simulation block", () => {
    expect(pdrInnerHash({ ...pdr, simulationBlock: pdr.simulationBlock + 1n })).not.toBe(
      pdrInnerHash(pdr),
    );
  });

  it("commits to the intent", () => {
    expect(pdrInnerHash({ ...pdr, intentHash: keccak256("0xdead") })).not.toBe(
      pdrInnerHash(pdr),
    );
  });

  it("commits to the policy", () => {
    expect(pdrInnerHash({ ...pdr, policyHash: keccak256("0xbeef") })).not.toBe(
      pdrInnerHash(pdr),
    );
  });

  it("commits to the simulation report", () => {
    expect(
      pdrInnerHash({ ...pdr, simulationReportHash: keccak256("0xfeed") }),
    ).not.toBe(pdrInnerHash(pdr));
  });

  it("commits to the expiry", () => {
    expect(pdrInnerHash({ ...pdr, validUntil: pdr.validUntil + 1n })).not.toBe(
      pdrInnerHash(pdr),
    );
  });
});

describe("signing", () => {
  it("produces a 65-byte signature the contract can parse", async () => {
    const signer = signerFromPrivateKey(KEY);
    const sig = await signer.sign(pdr);

    // 0x + 65 bytes. The contract's _recover requires exactly this length.
    expect(sig).toMatch(/^0x[0-9a-f]{130}$/);
  });

  it("recovers to the verifier address under EIP-191", async () => {
    const signer = signerFromPrivateKey(KEY);
    const sig = await signer.sign(pdr);

    // The contract prefixes with "\x19Ethereum Signed Message:\n32" and
    // ecrecovers. This is the same operation.
    const recovered = await recoverMessageAddress({
      message: { raw: pdrInnerHash(pdr) },
      signature: sig,
    });

    expect(recovered).toBe(privateKeyToAccount(KEY).address);
    expect(recovered).toBe(signer.address);
  });

  it("produces a different signature for a different PDR", async () => {
    const signer = signerFromPrivateKey(KEY);
    const a = await signer.sign(pdr);
    const b = await signer.sign({ ...pdr, validUntil: pdr.validUntil + 1n });
    expect(a).not.toBe(b);
  });
});

describe("key loading", () => {
  it("refuses to start with no key rather than running unsigned", () => {
    expect(() => loadSigner({})).toThrow(/No verifier key configured/);
  });

  it("refuses a raw key in production", () => {
    expect(() =>
      loadSigner({ NODE_ENV: "production", VERIFIER_SIGNER_KEY: KEY }),
    ).toThrow(/must not be used in production/);
  });

  // A silent downgrade of the trust anchor is the failure this guards against.
  it("refuses to fall back to a raw key when a KMS was configured", () => {
    expect(() =>
      loadSigner({ VERIFIER_KMS_KEY_ID: "arn:aws:kms:...", VERIFIER_SIGNER_KEY: KEY }),
    ).toThrow(/Refusing to fall back/);
  });

  it("rejects a malformed key", () => {
    expect(() => loadSigner({ VERIFIER_SIGNER_KEY: "not-a-key" })).toThrow(
      /not a 32-byte hex private key/,
    );
  });

  it("accepts a well-formed key for local development", () => {
    const signer = loadSigner({ VERIFIER_SIGNER_KEY: KEY });
    expect(signer.address).toBe(privateKeyToAccount(KEY).address);
  });
});
