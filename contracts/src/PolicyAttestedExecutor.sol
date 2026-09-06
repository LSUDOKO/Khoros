// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title PolicyAttestedExecutor
 * @notice On-chain half of the PACE safety layer, from docs/05-PACE_SAFETY.md.
 *
 * Every agent action is simulated against forked chain state and signed into a
 * Policy Decision Record before it can execute. A compromised agent planner
 * produces no valid PDR and therefore no transaction.
 *
 * CLAUDE.md rule 4: no transaction executes without a valid PDR, and there is
 * no bypass — not behind a flag, not for an owner, not for anyone.
 *
 * ---------------------------------------------------------------------------
 * Deviations from the sketch in docs/05, and why
 * ---------------------------------------------------------------------------
 *
 * The document's reference contract has several holes that would matter in
 * production. Each is fixed here and called out, because the doc is the spec and
 * a silent divergence would be worse than the hole:
 *
 * 1. NO ACCESS CONTROL / NO msg.sender BINDING. The sketch lets anyone submit
 *    any (intent, pdr, payload) triple, and those become public the moment one
 *    is broadcast. Worse, the intent binds no account, so the contract cannot
 *    tell whose funds are at stake. Fixed: the intent carries an `account`, the
 *    hash commits to it, and only that account may submit.
 *
 * 2. EXPIRED INTENT AND EXPIRED PDR SHARED ONE ERROR. Two of the ten prescribed
 *    revert tests could both pass with one of the checks deleted. Fixed: they
 *    are separate errors.
 *
 * 3. SHORT PAYLOAD PANICKED. `bytes4(executionPayload[:4])` reverts with an
 *    array-bounds panic, not `PayloadMismatch`, when the payload is under four
 *    bytes. Fixed with an explicit length guard.
 *
 * 4. MISSING `payable`. The sketch forwards `intent.value` but the function is
 *    not payable, so any non-zero value path is dead. Fixed.
 *
 * 5. REENTRANCY CLAIM WAS OVERSTATED. Consuming the nonce before the call stops
 *    a replay of the SAME nonce, but a malicious target can re-enter with a
 *    different valid nonce and a second PDR. Fixed with a reentrancy guard.
 *
 * 6. THE TARGET'S REVERT REASON WAS SWALLOWED. `require(ok, "target call
 *    reverted")` discards it, which makes a blocked action impossible to
 *    explain — and the whole point of this layer is legible refusals. Fixed by
 *    bubbling the original revert data.
 *
 * 7. THE FORK BLOCK WAS NOT COMMITTED TO. docs/05 calls the policy evaluation
 *    deterministic and auditable, but nothing recorded WHICH block was
 *    simulated, so a verdict could not be reproduced. The simulation report
 *    hash now covers it off-chain, and `simulationBlock` is in the PDR so the
 *    audit log can point at it.
 *
 * What this contract deliberately does NOT do: verify that a simulation
 * actually happened. It cannot — it can only verify that the verifier signed
 * for this exact intent. The trust assumption is the verifier key, and stating
 * that plainly is more honest than implying the chain checks the simulation.
 */
contract PolicyAttestedExecutor {
    struct TransactionIntent {
        /// @notice The account whose funds move. Only this address may submit.
        address account;
        address targetContract;
        uint256 value;
        bytes4 selector;
        bytes32 calldataHash;
        uint256 maxSlippageBps;
        uint256 expiry;
        uint256 nonce;
    }

    struct PolicyDecisionRecord {
        bytes32 intentHash;
        bytes32 simulationReportHash;
        bytes32 policyHash;
        /// @notice Block the verifier simulated against, so a verdict is reproducible.
        uint256 simulationBlock;
        uint256 validUntil;
        bytes verifierSignature;
    }

    address public immutable trustedPolicyVerifier;

    /// @notice Nonces are namespaced per account so users cannot burn each other's.
    mapping(address => mapping(uint256 => bool)) public executedNonces;

    event ExecutionAttested(
        bytes32 indexed intentHash,
        address indexed account,
        address indexed target,
        bytes4 selector
    );

    error IntentExpired();
    error PdrExpired();
    error NonceAlreadyUsed();
    error InvalidVerifierSignature();
    error IntentMismatch();
    error PayloadMismatch();
    error NotIntentAccount();
    error Reentrancy();
    error ZeroVerifier();

    uint256 private _entered;

    constructor(address verifier) {
        if (verifier == address(0)) revert ZeroVerifier();
        trustedPolicyVerifier = verifier;
    }

    /**
     * @notice Execute a policy-attested intent.
     * @dev Order of checks is deliberate: cheapest and most specific first, so a
     *      caller learns the real reason rather than tripping a generic one.
     */
    function executePolicyAttested(
        TransactionIntent calldata intent,
        PolicyDecisionRecord calldata pdr,
        bytes calldata executionPayload
    ) external payable returns (bytes memory) {
        if (_entered == 1) revert Reentrancy();
        _entered = 1;

        // Only the account whose funds are at stake may submit its own intent.
        if (msg.sender != intent.account) revert NotIntentAccount();

        if (block.timestamp > intent.expiry) revert IntentExpired();
        if (block.timestamp > pdr.validUntil) revert PdrExpired();
        if (executedNonces[intent.account][intent.nonce]) revert NonceAlreadyUsed();

        // The hash commits to the account, the chain and this contract, so a PDR
        // cannot be replayed on another chain, another deployment, or by
        // another account.
        bytes32 computed = keccak256(
            abi.encode(
                intent.account,
                intent.targetContract,
                intent.value,
                intent.selector,
                intent.calldataHash,
                intent.maxSlippageBps,
                intent.expiry,
                intent.nonce,
                block.chainid,
                address(this)
            )
        );
        if (computed != pdr.intentHash) revert IntentMismatch();

        if (keccak256(executionPayload) != intent.calldataHash) revert PayloadMismatch();
        // Explicit length guard: slicing a shorter payload panics rather than
        // reverting with our error.
        if (executionPayload.length < 4) revert PayloadMismatch();
        if (bytes4(executionPayload[:4]) != intent.selector) revert PayloadMismatch();

        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19Ethereum Signed Message:\n32",
                keccak256(
                    abi.encode(
                        pdr.intentHash,
                        pdr.simulationReportHash,
                        pdr.policyHash,
                        pdr.simulationBlock,
                        pdr.validUntil
                    )
                )
            )
        );
        if (_recover(digest, pdr.verifierSignature) != trustedPolicyVerifier) {
            revert InvalidVerifierSignature();
        }

        // Consume the nonce BEFORE the external call.
        executedNonces[intent.account][intent.nonce] = true;

        (bool ok, bytes memory ret) =
            intent.targetContract.call{value: intent.value}(executionPayload);

        // Bubble the target's own revert reason. A blocked action has to be
        // explainable, and "target call reverted" explains nothing.
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }

        emit ExecutionAttested(computed, intent.account, intent.targetContract, intent.selector);

        _entered = 0;
        return ret;
    }

    /**
     * @notice The digest a verifier signs. Exposed so the off-chain signer and
     *         the on-chain check can never drift apart.
     */
    function pdrDigest(PolicyDecisionRecord calldata pdr) external pure returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                "\x19Ethereum Signed Message:\n32",
                keccak256(
                    abi.encode(
                        pdr.intentHash,
                        pdr.simulationReportHash,
                        pdr.policyHash,
                        pdr.simulationBlock,
                        pdr.validUntil
                    )
                )
            )
        );
    }

    /// @notice The intent hash, exposed for the same reason as `pdrDigest`.
    function hashIntent(TransactionIntent calldata intent) external view returns (bytes32) {
        return keccak256(
            abi.encode(
                intent.account,
                intent.targetContract,
                intent.value,
                intent.selector,
                intent.calldataHash,
                intent.maxSlippageBps,
                intent.expiry,
                intent.nonce,
                block.chainid,
                address(this)
            )
        );
    }

    function _recover(bytes32 digest, bytes memory sig) internal pure returns (address) {
        require(sig.length == 65, "bad sig length");
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }
        if (v < 27) v += 27;
        require(v == 27 || v == 28, "bad v");
        // Reject the high-s half of the curve: signature malleability would let
        // the same authorisation be presented twice with different bytes.
        require(
            uint256(s) <= 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0,
            "bad s"
        );
        address signer = ecrecover(digest, v, r, s);
        require(signer != address(0), "bad sig");
        return signer;
    }
}
