// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";

import {PolicyAttestedExecutor} from "../src/PolicyAttestedExecutor.sol";

/// @dev A benign call target.
contract Receiver {
    uint256 public lastValue;
    bytes public lastData;

    function doThing(uint256 v) external payable returns (uint256) {
        lastValue = v;
        lastData = msg.data;
        return v * 2;
    }

    function alwaysReverts() external pure {
        revert("target says no");
    }
}

/// @dev Re-enters the executor with a DIFFERENT nonce, which the doc's version allowed.
contract Reenterer {
    PolicyAttestedExecutor public executor;
    PolicyAttestedExecutor.TransactionIntent internal intent;
    PolicyAttestedExecutor.PolicyDecisionRecord internal pdr;
    bytes internal payload;
    bool public attempted;
    bool public succeeded;

    function arm(
        PolicyAttestedExecutor executor_,
        PolicyAttestedExecutor.TransactionIntent memory intent_,
        PolicyAttestedExecutor.PolicyDecisionRecord memory pdr_,
        bytes memory payload_
    ) external {
        executor = executor_;
        intent = intent_;
        pdr = pdr_;
        payload = payload_;
    }

    function doThing(uint256) external returns (uint256) {
        if (!attempted) {
            attempted = true;
            try executor.executePolicyAttested(intent, pdr, payload) {
                succeeded = true;
            } catch {
                succeeded = false;
            }
        }
        return 1;
    }
}

contract PolicyAttestedExecutorTest is Test {
    PolicyAttestedExecutor internal executor;
    Receiver internal receiver;

    uint256 internal verifierKey = 0xA11CE;
    address internal verifier;
    address internal account = address(0xBEEF);

    function setUp() public {
        verifier = vm.addr(verifierKey);
        executor = new PolicyAttestedExecutor(verifier);
        receiver = new Receiver();
        vm.warp(1_000_000);
    }

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------

    function _payload(uint256 v) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(Receiver.doThing.selector, v);
    }

    function _intent(bytes memory payload, uint256 nonce)
        internal
        view
        returns (PolicyAttestedExecutor.TransactionIntent memory)
    {
        return PolicyAttestedExecutor.TransactionIntent({
            account: account,
            targetContract: address(receiver),
            value: 0,
            selector: bytes4(payload),
            calldataHash: keccak256(payload),
            maxSlippageBps: 50,
            expiry: block.timestamp + 300,
            nonce: nonce
        });
    }

    function _sign(PolicyAttestedExecutor.PolicyDecisionRecord memory pdr, uint256 key)
        internal
        view
        returns (bytes memory)
    {
        bytes32 digest = executor.pdrDigest(pdr);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _pdr(PolicyAttestedExecutor.TransactionIntent memory intent, uint256 key)
        internal
        view
        returns (PolicyAttestedExecutor.PolicyDecisionRecord memory)
    {
        PolicyAttestedExecutor.PolicyDecisionRecord memory pdr = PolicyAttestedExecutor
            .PolicyDecisionRecord({
            intentHash: executor.hashIntent(intent),
            simulationReportHash: keccak256("report"),
            policyHash: keccak256("policy"),
            simulationBlock: block.number,
            validUntil: block.timestamp + 60,
            verifierSignature: ""
        });
        pdr.verifierSignature = _sign(pdr, key);
        return pdr;
    }

    // ---------------------------------------------------------------------
    // 1. Happy path
    // ---------------------------------------------------------------------

    function test_executes_with_valid_pdr() public {
        bytes memory payload = _payload(21);
        PolicyAttestedExecutor.TransactionIntent memory intent = _intent(payload, 1);
        PolicyAttestedExecutor.PolicyDecisionRecord memory pdr = _pdr(intent, verifierKey);

        vm.expectEmit(true, true, true, true);
        emit PolicyAttestedExecutor.ExecutionAttested(
            pdr.intentHash, account, address(receiver), intent.selector
        );

        vm.prank(account);
        bytes memory ret = executor.executePolicyAttested(intent, pdr, payload);

        assertEq(abi.decode(ret, (uint256)), 42, "return value bubbles back");
        assertEq(receiver.lastValue(), 21, "target actually ran");
        assertTrue(executor.executedNonces(account, 1), "nonce consumed");
    }

    // ---------------------------------------------------------------------
    // 2-3. Expiry — two DISTINCT errors
    // ---------------------------------------------------------------------

    function test_reverts_on_expired_intent() public {
        bytes memory payload = _payload(1);
        PolicyAttestedExecutor.TransactionIntent memory intent = _intent(payload, 1);
        PolicyAttestedExecutor.PolicyDecisionRecord memory pdr = _pdr(intent, verifierKey);

        vm.warp(intent.expiry + 1);

        vm.prank(account);
        vm.expectRevert(PolicyAttestedExecutor.IntentExpired.selector);
        executor.executePolicyAttested(intent, pdr, payload);
    }

    /// @dev docs/05 gives both cases the same error, so either check could be
    ///      deleted and both tests would still pass. They are distinct here.
    function test_reverts_on_expired_pdr() public {
        bytes memory payload = _payload(1);
        PolicyAttestedExecutor.TransactionIntent memory intent = _intent(payload, 1);
        intent.expiry = block.timestamp + 10_000; // intent still valid

        PolicyAttestedExecutor.PolicyDecisionRecord memory pdr = _pdr(intent, verifierKey);
        vm.warp(pdr.validUntil + 1);

        vm.prank(account);
        vm.expectRevert(PolicyAttestedExecutor.PdrExpired.selector);
        executor.executePolicyAttested(intent, pdr, payload);
    }

    // ---------------------------------------------------------------------
    // 4. Replay
    // ---------------------------------------------------------------------

    function test_reverts_on_reused_nonce() public {
        bytes memory payload = _payload(7);
        PolicyAttestedExecutor.TransactionIntent memory intent = _intent(payload, 99);
        PolicyAttestedExecutor.PolicyDecisionRecord memory pdr = _pdr(intent, verifierKey);

        vm.prank(account);
        executor.executePolicyAttested(intent, pdr, payload);

        vm.prank(account);
        vm.expectRevert(PolicyAttestedExecutor.NonceAlreadyUsed.selector);
        executor.executePolicyAttested(intent, pdr, payload);
    }

    // ---------------------------------------------------------------------
    // 5. Wrong signer
    // ---------------------------------------------------------------------

    function test_reverts_on_wrong_signer() public {
        bytes memory payload = _payload(1);
        PolicyAttestedExecutor.TransactionIntent memory intent = _intent(payload, 1);
        PolicyAttestedExecutor.PolicyDecisionRecord memory pdr = _pdr(intent, 0xBADBAD);

        vm.prank(account);
        vm.expectRevert(PolicyAttestedExecutor.InvalidVerifierSignature.selector);
        executor.executePolicyAttested(intent, pdr, payload);
    }

    // ---------------------------------------------------------------------
    // 6-7. Payload integrity
    // ---------------------------------------------------------------------

    function test_reverts_on_mutated_payload() public {
        bytes memory payload = _payload(1);
        PolicyAttestedExecutor.TransactionIntent memory intent = _intent(payload, 1);
        PolicyAttestedExecutor.PolicyDecisionRecord memory pdr = _pdr(intent, verifierKey);

        // Same selector, different argument — the hash must catch it.
        bytes memory mutated = _payload(999);

        vm.prank(account);
        vm.expectRevert(PolicyAttestedExecutor.PayloadMismatch.selector);
        executor.executePolicyAttested(intent, pdr, mutated);
    }

    function test_reverts_on_selector_swap() public {
        bytes memory payload = _payload(1);
        PolicyAttestedExecutor.TransactionIntent memory intent = _intent(payload, 1);
        // Intent claims a different function than the payload calls.
        intent.selector = Receiver.alwaysReverts.selector;
        PolicyAttestedExecutor.PolicyDecisionRecord memory pdr = _pdr(intent, verifierKey);

        vm.prank(account);
        vm.expectRevert(PolicyAttestedExecutor.PayloadMismatch.selector);
        executor.executePolicyAttested(intent, pdr, payload);
    }

    // ---------------------------------------------------------------------
    // 8. Cross-chain replay
    // ---------------------------------------------------------------------

    function test_reverts_on_foreign_chainid() public {
        bytes memory payload = _payload(1);
        PolicyAttestedExecutor.TransactionIntent memory intent = _intent(payload, 1);
        PolicyAttestedExecutor.PolicyDecisionRecord memory pdr = _pdr(intent, verifierKey);

        // A PDR signed for this chain must not be usable on another.
        vm.chainId(1);

        vm.prank(account);
        vm.expectRevert(PolicyAttestedExecutor.IntentMismatch.selector);
        executor.executePolicyAttested(intent, pdr, payload);
    }

    // ---------------------------------------------------------------------
    // 9. Malleability
    // ---------------------------------------------------------------------

    function test_reverts_on_malleable_signature() public {
        bytes memory payload = _payload(1);
        PolicyAttestedExecutor.TransactionIntent memory intent = _intent(payload, 1);
        PolicyAttestedExecutor.PolicyDecisionRecord memory pdr = _pdr(intent, verifierKey);

        // Flip the signature into the high-s half of the curve. It recovers the
        // same signer but has different bytes, so accepting it would let one
        // authorisation be presented twice.
        bytes memory sig = pdr.verifierSignature;
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }
        uint256 n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
        bytes32 flippedS = bytes32(n - uint256(s));
        uint8 flippedV = v == 27 ? 28 : 27;
        pdr.verifierSignature = abi.encodePacked(r, flippedS, flippedV);

        vm.prank(account);
        vm.expectRevert(bytes("bad s"));
        executor.executePolicyAttested(intent, pdr, payload);
    }

    // ---------------------------------------------------------------------
    // 10. Reentrancy — including the different-nonce case the doc missed
    // ---------------------------------------------------------------------

    function test_no_reentrant_replay() public {
        Reenterer attacker = new Reenterer();

        bytes memory payload = _payload(1);

        // Outer intent calls the attacker.
        PolicyAttestedExecutor.TransactionIntent memory outer = _intent(payload, 1);
        outer.targetContract = address(attacker);
        PolicyAttestedExecutor.PolicyDecisionRecord memory outerPdr = _pdr(outer, verifierKey);

        // Inner intent is fully valid and uses a DIFFERENT nonce, so nonce
        // consumption alone would not stop it. Only the guard does.
        PolicyAttestedExecutor.TransactionIntent memory inner = _intent(payload, 2);
        PolicyAttestedExecutor.PolicyDecisionRecord memory innerPdr = _pdr(inner, verifierKey);

        attacker.arm(executor, inner, innerPdr, payload);

        vm.prank(account);
        executor.executePolicyAttested(outer, outerPdr, payload);

        assertTrue(attacker.attempted(), "the attacker did try to re-enter");
        assertFalse(attacker.succeeded(), "re-entry with a fresh nonce must fail");
        assertFalse(executor.executedNonces(account, 2), "inner nonce never consumed");
    }

    // ---------------------------------------------------------------------
    // Additional tests — gaps in the prescribed list
    // ---------------------------------------------------------------------

    /// @dev The doc's version had no access control, so anyone holding a
    ///      broadcast triple could resubmit it.
    function test_reverts_when_submitted_by_another_account() public {
        bytes memory payload = _payload(1);
        PolicyAttestedExecutor.TransactionIntent memory intent = _intent(payload, 1);
        PolicyAttestedExecutor.PolicyDecisionRecord memory pdr = _pdr(intent, verifierKey);

        vm.prank(address(0xDEAD));
        vm.expectRevert(PolicyAttestedExecutor.NotIntentAccount.selector);
        executor.executePolicyAttested(intent, pdr, payload);
    }

    /// @dev A PDR for intent A must not authorise intent B.
    function test_reverts_on_swapped_intent() public {
        bytes memory payload = _payload(1);
        PolicyAttestedExecutor.TransactionIntent memory a = _intent(payload, 1);
        PolicyAttestedExecutor.PolicyDecisionRecord memory pdrForA = _pdr(a, verifierKey);

        PolicyAttestedExecutor.TransactionIntent memory b = _intent(payload, 2);

        vm.prank(account);
        vm.expectRevert(PolicyAttestedExecutor.IntentMismatch.selector);
        executor.executePolicyAttested(b, pdrForA, payload);
    }

    /// @dev Slicing a short payload panics instead of reverting cleanly.
    function test_reverts_on_short_payload() public {
        bytes memory short = hex"0011";
        PolicyAttestedExecutor.TransactionIntent memory intent = _intent(_payload(1), 1);
        intent.calldataHash = keccak256(short);
        PolicyAttestedExecutor.PolicyDecisionRecord memory pdr = _pdr(intent, verifierKey);

        vm.prank(account);
        vm.expectRevert(PolicyAttestedExecutor.PayloadMismatch.selector);
        executor.executePolicyAttested(intent, pdr, short);
    }

    /// @dev A blocked action must be explainable, so the target's reason bubbles.
    function test_bubbles_target_revert_reason() public {
        bytes memory payload = abi.encodeWithSelector(Receiver.alwaysReverts.selector);
        PolicyAttestedExecutor.TransactionIntent memory intent = _intent(payload, 1);
        PolicyAttestedExecutor.PolicyDecisionRecord memory pdr = _pdr(intent, verifierKey);

        vm.prank(account);
        vm.expectRevert(bytes("target says no"));
        executor.executePolicyAttested(intent, pdr, payload);
    }

    /// @dev Nonces are namespaced, so one account cannot burn another's.
    function test_nonces_are_namespaced_per_account() public {
        bytes memory payload = _payload(5);
        PolicyAttestedExecutor.TransactionIntent memory a = _intent(payload, 1);
        PolicyAttestedExecutor.PolicyDecisionRecord memory pdrA = _pdr(a, verifierKey);

        vm.prank(account);
        executor.executePolicyAttested(a, pdrA, payload);

        address other = address(0xC0FFEE);
        PolicyAttestedExecutor.TransactionIntent memory b = _intent(payload, 1);
        b.account = other;
        PolicyAttestedExecutor.PolicyDecisionRecord memory pdrB = _pdr(b, verifierKey);

        vm.prank(other);
        executor.executePolicyAttested(b, pdrB, payload);

        assertTrue(executor.executedNonces(other, 1), "other account's nonce 1 is its own");
    }

    /// @dev value > 0 must actually reach the target.
    function test_forwards_value() public {
        bytes memory payload = _payload(3);
        PolicyAttestedExecutor.TransactionIntent memory intent = _intent(payload, 1);
        intent.value = 1 ether;
        PolicyAttestedExecutor.PolicyDecisionRecord memory pdr = _pdr(intent, verifierKey);

        vm.deal(account, 2 ether);
        vm.prank(account);
        executor.executePolicyAttested{value: 1 ether}(intent, pdr, payload);

        assertEq(address(receiver).balance, 1 ether, "value reached the target");
    }

    function test_constructor_rejects_zero_verifier() public {
        vm.expectRevert(PolicyAttestedExecutor.ZeroVerifier.selector);
        new PolicyAttestedExecutor(address(0));
    }

    /// @dev A 64-byte compact (ERC-2098) signature is not supported and must be
    ///      refused rather than misparsed.
    function test_reverts_on_compact_signature() public {
        bytes memory payload = _payload(1);
        PolicyAttestedExecutor.TransactionIntent memory intent = _intent(payload, 1);
        PolicyAttestedExecutor.PolicyDecisionRecord memory pdr = _pdr(intent, verifierKey);

        bytes memory sig = pdr.verifierSignature;
        bytes32 r;
        bytes32 s;
        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
        }
        pdr.verifierSignature = abi.encodePacked(r, s);

        vm.prank(account);
        vm.expectRevert(bytes("bad sig length"));
        executor.executePolicyAttested(intent, pdr, payload);
    }

    /// @dev Changing the simulation block invalidates the signature, so the PDR
    ///      genuinely commits to which block was simulated.
    function test_pdr_commits_to_simulation_block() public {
        bytes memory payload = _payload(1);
        PolicyAttestedExecutor.TransactionIntent memory intent = _intent(payload, 1);
        PolicyAttestedExecutor.PolicyDecisionRecord memory pdr = _pdr(intent, verifierKey);

        pdr.simulationBlock = pdr.simulationBlock + 1;

        vm.prank(account);
        vm.expectRevert(PolicyAttestedExecutor.InvalidVerifierSignature.selector);
        executor.executePolicyAttested(intent, pdr, payload);
    }
}
