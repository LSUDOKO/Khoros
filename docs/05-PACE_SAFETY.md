# 05 — PACE: Policy-Attested Contract Execution

## The threat this closes

An agent's planner is a language model reading market data. That data comes from
oracles, pool states, protocol docs, and sometimes token metadata that an attacker
controls. A model that can be steered by its inputs can be steered into producing
transaction calldata that drains the account it operates.

Altana session keys bound *what contracts and functions* an agent may call. That is
necessary and not sufficient: an agent allowed to call `exactInputSingle` on the
PancakeSwap router can still be induced to swap the entire balance into a worthless
token at 99% slippage. The call is in scope. The outcome is a loss.

PACE adds the missing check: the agent's proposed action is simulated against real
chain state and evaluated against the user's declared policy *before* it can reach
the chain, by a component that never consults the model.

**Two independent gates.** Session keys ask "is this call permitted?" PACE asks
"is this outcome acceptable?" An action must pass both.

---

## The intent

An agent never submits raw calldata. It compiles its decision into a typed intent:

$$\mathcal{I} = \langle \text{Target},\ \text{Value},\ \text{Selector},\ \text{CalldataHash},\ \text{MaxSlippage},\ \text{Expiry},\ \text{Nonce}\rangle$$

```ts
export type TransactionIntent = {
  targetContract: `0x${string}`;
  value: bigint;
  selector: `0x${string}`;      // 4 bytes
  calldataHash: `0x${string}`;  // keccak256 of the full payload
  maxSlippageBps: bigint;
  expiry: bigint;               // unix seconds
  nonce: bigint;
};
```

The intent commits to the calldata by hash rather than carrying it, so the signed
attestation stays fixed-size while remaining bound to exactly one payload.

---

## The verifier

A standalone service holding a signing key. It must not be reachable from the web
app and must not accept input from anything except agent runtimes.

### Simulation

1. Fork BSC at the current block (anvil, or a hosted equivalent).
2. Impersonate the user's Altana account.
3. Execute the calldata against the fork.
4. Capture the state diff: balances before and after, position states, health
   factors, pool prices.

Simulation is against real current state, not a model of it. This is what makes the
check meaningful — the agent's belief about the pool is irrelevant; what matters is
what the call actually does.

### Policy evaluation

Against the state diff, evaluate the user's policy. Policies are declarative and
per-category (see `03-AGENT_CATEGORIES.md` for each category's constraints):

```ts
export type Policy = {
  allowedTargets: `0x${string}`[];
  allowedSelectors: `0x${string}`[];
  maxSlippageBps: number;
  spendCaps: { token: `0x${string}`; limit: bigint; periodSeconds: number }[];
  invariants: Invariant[];
};

export type Invariant =
  | { kind: "no-net-outflow" }
  | { kind: "min-range-width-bps"; value: number }
  | { kind: "hf-must-improve" }
  | { kind: "hf-floor-after"; value: number }
  | { kind: "max-concentration-bps"; value: number }
  | { kind: "oracle-deviation-max-bps"; value: number };
```

The evaluator is pure: state diff plus policy in, verdict out. No model call, no
network call, no nondeterminism. The same inputs must always produce the same
verdict — that property is what lets a user trust the gate at all.

### Attestation

On pass, sign a Policy Decision Record:

$$\text{PDR} = \text{Sign}_{V}\big(\mathcal{H}(\mathcal{I}\ \|\ \text{SimulationReport}\ \|\ \text{PolicyHash}\ \|\ \text{Nonce})\big)$$

```ts
export type PolicyDecisionRecord = {
  intentHash: `0x${string}`;
  simulationReportHash: `0x${string}`;
  policyHash: `0x${string}`;
  validUntil: bigint;
  verifierSignature: `0x${string}`;
};
```

`validUntil` is short — 60 seconds by default. A stale attestation is worthless
because chain state has moved; the agent must re-simulate rather than replay.

On fail, return a structured rejection with the failing invariant and the observed
value. These are surfaced in the dashboard as blocked actions. **Rejections are the
product demo.** A dashboard showing "3 actions blocked before execution this week,
here's why" proves the layer does something.

---

## The contract

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract PolicyAttestedExecutor {
    struct TransactionIntent {
        address targetContract;
        uint256 value;
        bytes4  selector;
        bytes32 calldataHash;
        uint256 maxSlippageBps;
        uint256 expiry;
        uint256 nonce;
    }

    struct PolicyDecisionRecord {
        bytes32 intentHash;
        bytes32 simulationReportHash;
        bytes32 policyHash;
        uint256 validUntil;
        bytes   verifierSignature;
    }

    address public immutable trustedPolicyVerifier;
    mapping(uint256 => bool) public executedNonces;

    event ExecutionAttested(bytes32 indexed intentHash, address indexed target, bytes4 selector);
    event ExecutionRejected(bytes32 indexed intentHash, string reason);

    error IntentExpired();
    error NonceAlreadyUsed();
    error InvalidVerifierSignature();
    error IntentMismatch();
    error PayloadMismatch();

    constructor(address _verifier) {
        trustedPolicyVerifier = _verifier;
    }

    function executePolicyAttested(
        TransactionIntent calldata intent,
        PolicyDecisionRecord calldata pdr,
        bytes calldata executionPayload
    ) external returns (bytes memory) {
        if (block.timestamp > intent.expiry) revert IntentExpired();
        if (block.timestamp > pdr.validUntil) revert IntentExpired();
        if (executedNonces[intent.nonce]) revert NonceAlreadyUsed();

        bytes32 computed = keccak256(abi.encode(
            intent.targetContract,
            intent.value,
            intent.selector,
            intent.calldataHash,
            intent.maxSlippageBps,
            intent.expiry,
            intent.nonce,
            block.chainid,
            address(this)
        ));
        if (computed != pdr.intentHash) revert IntentMismatch();
        if (keccak256(executionPayload) != intent.calldataHash) revert PayloadMismatch();
        if (bytes4(executionPayload[:4]) != intent.selector) revert PayloadMismatch();

        bytes32 digest = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32",
            keccak256(abi.encode(
                pdr.intentHash, pdr.simulationReportHash, pdr.policyHash, pdr.validUntil
            ))
        ));
        if (_recover(digest, pdr.verifierSignature) != trustedPolicyVerifier) {
            revert InvalidVerifierSignature();
        }

        executedNonces[intent.nonce] = true;

        (bool ok, bytes memory ret) =
            intent.targetContract.call{value: intent.value}(executionPayload);
        require(ok, "target call reverted");

        emit ExecutionAttested(computed, intent.targetContract, intent.selector);
        return ret;
    }

    function _recover(bytes32 digest, bytes memory sig) internal pure returns (address) {
        require(sig.length == 65, "bad sig length");
        bytes32 r; bytes32 s; uint8 v;
        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }
        if (v < 27) v += 27;
        require(v == 27 || v == 28, "bad v");
        require(uint256(s) <= 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0, "bad s");
        address signer = ecrecover(digest, v, r, s);
        require(signer != address(0), "bad sig");
        return signer;
    }
}
```

Notes on the details that matter:

- `chainid` and `address(this)` are inside the intent hash — a signature for testnet
  cannot be replayed on mainnet or against a different executor deployment.
- The selector is checked against the payload's first four bytes, so the payload
  cannot call a different function than the one attested.
- `s` is range-checked and `v` normalised, closing signature malleability.
- Nonces are consumed before the external call, so a reentrant path cannot replay.

---

## Required tests

Foundry, and the revert paths matter more than the happy path:

| Test | Asserts |
|------|---------|
| `test_executes_with_valid_pdr` | Happy path calls through and emits |
| `test_reverts_on_expired_intent` | `IntentExpired` |
| `test_reverts_on_expired_pdr` | `IntentExpired` |
| `test_reverts_on_reused_nonce` | `NonceAlreadyUsed` |
| `test_reverts_on_wrong_signer` | `InvalidVerifierSignature` |
| `test_reverts_on_mutated_payload` | `PayloadMismatch` |
| `test_reverts_on_selector_swap` | `PayloadMismatch` |
| `test_reverts_on_foreign_chainid` | `IntentMismatch` |
| `test_reverts_on_malleable_signature` | high-`s` signature rejected |
| `test_no_reentrant_replay` | malicious target cannot re-enter with same nonce |

---

## Operational discipline

The verifier key is the trust anchor. Treat it accordingly:

- Store in a KMS or hardware-backed signer, never in an env var in the repo.
- One key per environment; testnet and mainnet keys are never the same.
- The verifier service exposes only `/simulate` and `/health`. No admin surface.
- Rate limit per session key. A runaway agent should hit a wall, not a bill.
- Log every verdict — pass and fail — with the intent hash. This log is the audit
  trail that makes the dashboard's blocked-action feed real.

**The bypass question.** There will be a moment during the build where PACE is
blocking a legitimate action and the fastest fix looks like a flag that skips
verification. Do not add it. A demo that occasionally blocks a good action is
defensible; a safety layer with an off switch is not a safety layer, and a judge
who finds the flag has found the whole story.
