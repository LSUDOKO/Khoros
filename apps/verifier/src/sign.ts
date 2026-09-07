/**
 * PDR signing. From docs/05-PACE_SAFETY.md.
 *
 *   PDR = Sign_V( H( intentHash || simulationReportHash || policyHash ||
 *                    simulationBlock || validUntil ) )
 *
 * The digest here MUST match PolicyAttestedExecutor.pdrDigest() exactly. The
 * contract exposes that function for this reason — so the off-chain signer and
 * the on-chain check can be compared rather than assumed equal.
 *
 * KEY HANDLING. docs/05 requires the verifier key to live in a KMS, not an env
 * var. `loadSigner` reflects that: a KMS reference is preferred and a raw key is
 * accepted only outside production, with a loud warning. It never silently
 * falls back, because a verifier signing with a key committed to a repo is
 * worse than a verifier that refuses to start.
 */

import { encodeAbiParameters, keccak256, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export type PolicyDecisionRecord = {
  intentHash: Hex;
  simulationReportHash: Hex;
  policyHash: Hex;
  simulationBlock: bigint;
  validUntil: bigint;
  verifierSignature: Hex;
};

/** How long a PDR stays valid. docs/05 default: 60 seconds. */
export const PDR_VALIDITY_SECONDS = 60n;

/**
 * The inner hash the verifier signs over.
 *
 * Mirrors the contract's abi.encode(...) exactly, including simulationBlock —
 * which the doc's version omitted, making a verdict impossible to reproduce
 * from the audit log.
 */
export function pdrInnerHash(pdr: Omit<PolicyDecisionRecord, "verifierSignature">): Hex {
  return keccak256(
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
}

export type Signer = {
  address: Hex;
  sign(pdr: Omit<PolicyDecisionRecord, "verifierSignature">): Promise<Hex>;
};

/**
 * Sign with a raw private key.
 *
 * `signMessage` with a raw payload applies the EIP-191 prefix, which is what
 * the contract's `_recover` expects. Signing the bare hash instead would
 * produce a signature the contract rejects.
 */
export function signerFromPrivateKey(privateKey: Hex): Signer {
  const account = privateKeyToAccount(privateKey);
  return {
    address: account.address,
    async sign(pdr) {
      return account.signMessage({ message: { raw: pdrInnerHash(pdr) } });
    },
  };
}

/**
 * Load the verifier's signer from the environment.
 *
 * Throws rather than starting unsigned. A verifier that cannot sign is useless,
 * and one that starts anyway invites a fallback path that skips attestation.
 */
export function loadSigner(env: NodeJS.ProcessEnv = process.env): Signer {
  const kmsKeyId = env.VERIFIER_KMS_KEY_ID;
  if (kmsKeyId) {
    throw new Error(
      "VERIFIER_KMS_KEY_ID is set but the KMS signer is not implemented yet. " +
        "Refusing to fall back to a raw key, because a silent downgrade of the " +
        "trust anchor is exactly the failure this check exists to prevent.",
    );
  }

  const raw = env.VERIFIER_SIGNER_KEY;
  if (!raw) {
    throw new Error(
      "No verifier key configured. Set VERIFIER_KMS_KEY_ID in production, or " +
        "VERIFIER_SIGNER_KEY for local development.",
    );
  }

  if (env.NODE_ENV === "production") {
    throw new Error(
      "VERIFIER_SIGNER_KEY must not be used in production — the verifier key is " +
        "the trust anchor for every agent action. Use a KMS.",
    );
  }

  if (!raw.startsWith("0x") || raw.length !== 66) {
    throw new Error("VERIFIER_SIGNER_KEY is not a 32-byte hex private key.");
  }

  return signerFromPrivateKey(raw as Hex);
}
