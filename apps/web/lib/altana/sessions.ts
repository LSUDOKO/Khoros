/**
 * Altana session lifecycle — grant, read, revoke.
 * From docs/06-INTEGRATIONS.md and docs/03-AGENT_CATEGORIES.md.
 *
 * Written against the SDK AS PUBLISHED (v0.9.0), verified by reading the
 * installed package's own type declarations. It differs from what docs/06
 * assumes in ways that would each have failed at runtime:
 *
 *   - Sessions go through a CLIENT, not standalone functions. `grantSession`
 *     and `revokeSession` are not exported from the package index at all; the
 *     entry point is `createClient({chains})`, then `client.grantSession(...)`.
 *   - Permissions are {calls: [{signature, to}], spend: [{limit, period, token}]}
 *     — a `signature` per call, not the separate `selectors[]` array docs/06
 *     describes.
 *   - There is no `describeScope()` in the SDK; ours lives in @khoros/core.
 *   - `register` defaults to true and is what writes the key into the KeyStore,
 *     which is what lets a third party verify the key's authority on-chain. The
 *     Altana track requires that, so we pass it explicitly rather than relying
 *     on a default that could change.
 *   - The session signer must be persisted by US. If the SDK generates one and
 *     the process exits before we store it, the on-chain grant is permanently
 *     unusable — revoke-and-regrant is the only way out.
 *
 * CLAUDE.md rule 3: the agent never holds a raw private key. All execution goes
 * through a session key with a call allowlist, a selector allowlist, a spend
 * cap, and an expiry, all enforced on-chain by the account contract.
 */

import type { AgentCategory, Address, Hash, SessionScope } from "@khoros/core";
import { categoryDefinition, toAltanaPermissions } from "@khoros/core";

/** Resolved contract addresses per chain, from the environment. */
export type TargetRegistry = Record<string, Address>;

export type BuildScopeInput = {
  category: AgentCategory;
  targets: TargetRegistry;
  /**
   * Targets known to be undeployed on this chain, with the reason. These are
   * dropped from the scope and surfaced to the user, rather than throwing.
   */
  unavailable?: Record<string, string>;
  /** The token the agent may spend, and how much per period. */
  spendToken: Address;
  spendLimit: bigint;
  spendPeriodSeconds?: number;
  /** Session lifetime. Defaults to the category's own default. */
  expirySeconds?: number;
  now?: bigint;
};

/**
 * Build the session scope for a category.
 *
 * The object returned here is the SAME one that drives the permissions preview
 * and gets converted for grantSession. docs/02 is explicit that these must not
 * be written separately, or the copy and the chain drift apart and the UI ends
 * up lying about what the agent may do.
 */
export function buildSessionScope(input: BuildScopeInput): SessionScope {
  const definition = categoryDefinition(input.category);
  const now = input.now ?? BigInt(Math.floor(Date.now() / 1000));
  const lifetime = input.expirySeconds ?? definition.scope.defaultExpirySeconds;

  const calls: SessionScope["calls"] = [];
  const omitted: { key: string; reason: string }[] = [];

  for (const target of definition.scope.targets) {
    const address = input.targets[target.key];

    if (!address) {
      // A protocol with no deployment on this chain is a known, explainable
      // absence: drop it and say so. Pointing a scope at an address with no
      // code behind it would let the grant succeed while the agent could never
      // act — a silent failure rather than a loud one.
      const known = input.unavailable?.[target.key];
      if (known) {
        omitted.push({ key: target.key, reason: known });
        continue;
      }

      // An unexplained missing address is a configuration error, and must not
      // silently produce a narrower scope than the preview describes.
      throw new Error(
        `No address configured for ${target.key} — cannot build a ${input.category} session scope. ` +
          `Set it in the environment, or declare why it is unavailable on this chain.`,
      );
    }

    calls.push({ to: address, label: target.label });
  }

  // Every category must retain at least one callable target, or the session
  // would grant nothing at all.
  if (calls.length === 0) {
    throw new Error(
      `No contracts for ${input.category} are deployed on this chain, so there is ` +
        `nothing a session could permit.`,
    );
  }

  const scope: SessionScope = {
    calls,
    selectors: definition.scope.selectors.map((s) => ({ sig: s.sig, name: s.name })),
    spend: [
      {
        token: input.spendToken,
        limit: input.spendLimit,
        periodSeconds: input.spendPeriodSeconds ?? 86_400,
      },
    ],
    expiry: now + BigInt(lifetime),
  };

  lastOmissions.set(scope, omitted);
  return scope;
}

/**
 * Targets dropped from a scope because they are not deployed on this chain.
 *
 * Kept beside the scope rather than inside it, because SessionScope mirrors
 * what gets registered on-chain and must not grow fields the chain never sees.
 * A WeakMap so it cannot leak.
 */
const lastOmissions = new WeakMap<SessionScope, { key: string; reason: string }[]>();

export function scopeOmissions(
  scope: SessionScope,
): { key: string; reason: string }[] {
  return lastOmissions.get(scope) ?? [];
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/**
 * All execution runs on BSC Testnet (chain 97), which has its own Altana
 * relay, KeyStore and account stack.
 *
 * docs/06 grants sessions on the mainnet `BNB` constant while creating jobs on
 * 97. That cannot work: a session granted on one chain cannot authorise a
 * transaction on another. Chain 56 is read-only here, for agent registry data.
 */
export const EXECUTION_CHAIN_ID = 97 as const;
export const DATA_CHAIN_ID = 56 as const;

type AltanaClient = Awaited<
  ReturnType<typeof import("@altananetwork/sdk").createClient>
>;

let clientPromise: Promise<AltanaClient> | undefined;

/** The Altana client, created once and reused. */
export async function getAltanaClient(): Promise<AltanaClient> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const { createClient, BNB_TESTNET } = await import("@altananetwork/sdk");
      return createClient({ chains: [BNB_TESTNET] });
    })();
  }
  return clientPromise;
}

// ---------------------------------------------------------------------------
// Grant
// ---------------------------------------------------------------------------

type SdkWallet = Parameters<AltanaClient["grantSession"]>[0]["wallet"];
type SdkSigner = Parameters<AltanaClient["grantSession"]>[0]["signer"];
type SdkSession = Awaited<ReturnType<AltanaClient["grantSession"]>>;

export type GrantSessionParams = {
  wallet: SdkWallet;
  adminSigner: SdkSigner;
  scope: SessionScope;
  /**
   * The session signer. ALWAYS supply this, and persist its key first.
   * Omitting it makes the SDK generate a key that lives only in this process's
   * memory.
   */
  sessionSigner: SdkSigner;
};

export type GrantedSession = {
  sessionKey: Address;
  wallet: Address;
  scope: SessionScope;
  grantTx?: Hash;
  keystoreRegistered: boolean;
  /** The live session object the agent runtime needs to execute. */
  session: SdkSession;
};

/**
 * Grant a scoped session, registering the key in the Altana KeyStore.
 *
 * KeyStore registration is what lets a third party — an Altana judge, for
 * instance — verify the key's authority on-chain rather than taking our word
 * for it. It is a mandatory criterion for that track.
 */
export async function grantScopedSession(
  params: GrantSessionParams,
): Promise<GrantedSession> {
  const client = await getAltanaClient();
  const permissions = toAltanaPermissions(params.scope);

  const session = await client.grantSession({
    wallet: params.wallet,
    signer: params.adminSigner,
    permissions,
    expiry: Number(params.scope.expiry),
    sessionSigner: params.sessionSigner,
    register: true, // KeyStore registration — mandatory for the Altana track
    chainId: EXECUTION_CHAIN_ID,
  });

  return {
    sessionKey: session.publicKey as Address,
    wallet: session.walletAddress as Address,
    scope: params.scope,
    grantTx: session.transactionHash as Hash | undefined,
    keystoreRegistered: true,
    session,
  };
}

// ---------------------------------------------------------------------------
// Revoke
// ---------------------------------------------------------------------------

/**
 * Revoke a session on-chain.
 *
 * docs/01: revoke is always visible, never behind a menu, and never requires
 * confirmation beyond the wallet signature itself. After confirmation the
 * session's next execute attempt fails at validator level — and surfacing that
 * revert in the feed is what proves the revoke was real rather than cosmetic.
 */
export async function revokeScopedSession(params: {
  wallet: SdkWallet;
  adminSigner: SdkSigner;
  session: SdkSession | Address;
}): Promise<{ revokeTx?: Hash; status: string }> {
  const client = await getAltanaClient();

  const result = await client.revokeSession({
    wallet: params.wallet,
    signer: params.adminSigner,
    session: params.session,
    chainId: EXECUTION_CHAIN_ID,
  });

  return {
    revokeTx: result.transactionHash as Hash | undefined,
    status: result.status,
  };
}

// ---------------------------------------------------------------------------
// Account provisioning
// ---------------------------------------------------------------------------

/**
 * Provision a Passkey-backed smart account.
 *
 * docs/11 requires account provisioning to be part of the hire flow rather than
 * a prerequisite, so this is called mid-flow rather than gating entry.
 */
export async function createPasskeyAccount(
  label = "Khoros",
): Promise<{ wallet: SdkWallet; signer: SdkSigner; address: Address }> {
  const client = await getAltanaClient();
  const result = await client.createPasskeyWallet({ name: label });
  return {
    wallet: result,
    signer: result.signer,
    address: result.address as Address,
  };
}
