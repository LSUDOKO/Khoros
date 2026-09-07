// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";

import {PolicyAttestedExecutor} from "../src/PolicyAttestedExecutor.sol";

/**
 * Cross-check: the digest the off-chain verifier signs must equal the one this
 * contract computes.
 *
 * The TypeScript side asserts the same fixture in apps/verifier/src/sign.test.ts.
 * Both sides are pinned to the constants below, so a change to either encoding
 * breaks a test rather than silently making every PDR unverifiable on-chain —
 * a failure that would otherwise only appear against a live chain.
 *
 * Fixture (shared with the TS test):
 *   intentHash           = keccak256(hex"1234")
 *   simulationReportHash = keccak256(hex"5678")
 *   policyHash           = keccak256(hex"9abc")
 *   simulationBlock      = 45_000_000
 *   validUntil           = 1_760_000_060
 */
contract CrossCheckDigestTest is Test {
    PolicyAttestedExecutor internal executor;

    function setUp() public {
        executor = new PolicyAttestedExecutor(address(0xA11CE));
    }

    function _fixture()
        internal
        pure
        returns (PolicyAttestedExecutor.PolicyDecisionRecord memory)
    {
        return PolicyAttestedExecutor.PolicyDecisionRecord({
            intentHash: keccak256(hex"1234"),
            simulationReportHash: keccak256(hex"5678"),
            policyHash: keccak256(hex"9abc"),
            simulationBlock: 45_000_000,
            validUntil: 1_760_000_060,
            verifierSignature: ""
        });
    }

    /// @dev The inner hash, before the EIP-191 prefix. This is what the TS
    ///      `pdrInnerHash` returns, and it is asserted there against the same
    ///      literal.
    function test_inner_hash_matches_offchain_fixture() public pure {
        PolicyAttestedExecutor.PolicyDecisionRecord memory pdr = _fixture();

        bytes32 inner = keccak256(
            abi.encode(
                pdr.intentHash,
                pdr.simulationReportHash,
                pdr.policyHash,
                pdr.simulationBlock,
                pdr.validUntil
            )
        );

        // Pinned. If either side changes its encoding, this fails loudly.
        assertEq(
            inner,
            0x12968f7e00a5b2b02a8fa4c4400a094813326d441242d67ab184e184934b6b8a,
            "inner PDR hash drifted from the pinned fixture"
        );
    }

    /// @dev The full digest, including the EIP-191 prefix the signer applies.
    function test_pdrDigest_applies_the_eip191_prefix() public view {
        PolicyAttestedExecutor.PolicyDecisionRecord memory pdr = _fixture();

        bytes32 inner = keccak256(
            abi.encode(
                pdr.intentHash,
                pdr.simulationReportHash,
                pdr.policyHash,
                pdr.simulationBlock,
                pdr.validUntil
            )
        );
        bytes32 expected =
            keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", inner));

        assertEq(executor.pdrDigest(pdr), expected, "digest must be EIP-191 prefixed");
    }

    /// @dev A signature produced over this digest must recover to the verifier,
    ///      which is what proves the two sides agree end to end.
    function test_signature_over_the_digest_recovers_to_the_verifier() public {
        uint256 key = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;
        address verifier = vm.addr(key);

        PolicyAttestedExecutor executorForKey = new PolicyAttestedExecutor(verifier);
        PolicyAttestedExecutor.PolicyDecisionRecord memory pdr = _fixture();

        bytes32 digest = executorForKey.pdrDigest(pdr);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);

        assertEq(ecrecover(digest, v, r, s), verifier, "signature must recover to the verifier");
    }

    /// @dev Every field must change the digest, or it is not truly committed to.
    function test_every_field_changes_the_digest() public view {
        PolicyAttestedExecutor.PolicyDecisionRecord memory base = _fixture();
        bytes32 original = executor.pdrDigest(base);

        PolicyAttestedExecutor.PolicyDecisionRecord memory m = _fixture();
        m.intentHash = keccak256(hex"dead");
        assertTrue(executor.pdrDigest(m) != original, "intentHash");

        m = _fixture();
        m.simulationReportHash = keccak256(hex"feed");
        assertTrue(executor.pdrDigest(m) != original, "simulationReportHash");

        m = _fixture();
        m.policyHash = keccak256(hex"beef");
        assertTrue(executor.pdrDigest(m) != original, "policyHash");

        m = _fixture();
        m.simulationBlock = base.simulationBlock + 1;
        assertTrue(executor.pdrDigest(m) != original, "simulationBlock");

        m = _fixture();
        m.validUntil = base.validUntil + 1;
        assertTrue(executor.pdrDigest(m) != original, "validUntil");
    }
}
