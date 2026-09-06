/**
 * describeScope — the single source of the permissions copy.
 *
 * docs/06-INTEGRATIONS.md specifies this function and docs/08-DESIGN_SYSTEM.md
 * requires that `PermissionList` render its output and never take free text. The
 * rule behind both: the English a user reads before granting a session must be
 * DERIVED from the same scope object that gets registered on-chain. Write the
 * copy separately and the two drift, and then the UI lies about what the agent
 * may do.
 *
 * Note: the published @altananetwork/sdk (v0.9.0) does not export a
 * `describeScope`, contrary to what docs/06 assumes. We own it here instead, and
 * `toAltanaPermissions` below converts the same object into the SDK's actual
 * `SessionPermissions` shape — so one object still feeds both the copy and the
 * chain.
 *
 * The doc's reference sketch read `scope.spend[0]` and silently ignored every
 * additional cap. That is exactly the drift it warns against, so this
 * implementation describes every spend cap and every target.
 */

import type { Address, SessionScope } from "./types.js";

/** Seconds-to-English for session expiry and spend periods. */
function humaniseDuration(seconds: number): string {
  const units: [number, string][] = [
    [86_400, "day"],
    [3_600, "hour"],
    [60, "minute"],
  ];
  for (const [size, name] of units) {
    if (seconds >= size && seconds % size === 0) {
      const n = seconds / size;
      return n === 1 ? `1 ${name}` : `${n} ${name}s`;
    }
  }
  return `${seconds} seconds`;
}

/** Format a base-unit amount for display, trimming trailing zeros. */
export function formatAmount(raw: bigint, decimals: number): string {
  if (decimals === 0) return raw.toString();
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const fraction = abs % base;

  let out = whole.toString();
  if (fraction > 0n) {
    const frac = fraction.toString().padStart(decimals, "0").replace(/0+$/, "");
    if (frac.length > 0) out += `.${frac}`;
  }
  return negative ? `-${out}` : out;
}

/** Metadata the caller supplies so we can name tokens rather than print addresses. */
export type TokenMeta = { symbol: string; decimals: number };

export type DescribeScopeOptions = {
  /** Token address (lowercased) → symbol and decimals. */
  tokens?: Record<string, TokenMeta>;
  /** Current time in unix seconds, for rendering expiry as a relative duration. */
  now?: bigint;
};

function tokenLabel(
  token: Address,
  tokens: Record<string, TokenMeta> | undefined,
): TokenMeta {
  const meta = tokens?.[token.toLowerCase()];
  if (meta) return meta;
  // Never invent a symbol or a decimal count. Fall back to the address and
  // base units, which is ugly but honest.
  return { symbol: `${token.slice(0, 6)}…${token.slice(-4)}`, decimals: 0 };
}

/**
 * Render a session scope as plain-language sentences.
 *
 * Returns an array so the UI can render one sentence per line without parsing
 * prose. Sentence order is deliberate: what it CAN do, what it CANNOT do, what
 * it may spend, when it stops.
 */
export function describeScope(
  scope: SessionScope,
  opts: DescribeScopeOptions = {},
): string[] {
  const lines: string[] = [];

  // 1. Which contracts it may call.
  if (scope.calls.length > 0) {
    const labels = scope.calls.map((c) => c.label);
    lines.push(`This agent can call ${joinList(labels)}.`);
  } else {
    // An empty call allowlist means unrestricted targets in the Altana schema.
    // Say so loudly rather than rendering a reassuring blank.
    lines.push(
      "This agent has no contract allowlist, so it can call any contract. This is unusual — check before granting.",
    );
  }

  // 2. Which functions it may invoke.
  if (scope.selectors.length > 0) {
    const names = scope.selectors.map((s) => s.name);
    lines.push(`It can ${joinList(names)}.`);
  }

  // 3. What it explicitly cannot do. Derived from the absence of transfer
  //    rights in the allowlist, which is the guarantee users care about most.
  const canTransfer = scope.selectors.some((s) =>
    ["transfer", "transferFrom", "approve"].includes(s.name),
  );
  if (!canTransfer) {
    lines.push("It cannot transfer your tokens anywhere.");
  }

  // 4. Every spend cap, not just the first.
  for (const cap of scope.spend) {
    const { symbol, decimals } = tokenLabel(cap.token, opts.tokens);
    const amount = formatAmount(cap.limit, decimals);
    lines.push(
      `It can spend at most ${amount} ${symbol} per ${humaniseDuration(cap.periodSeconds)}.`,
    );
  }
  if (scope.spend.length === 0) {
    lines.push("No spending cap is set on this session.");
  }

  // 5. When it stops.
  const now = opts.now ?? BigInt(Math.floor(Date.now() / 1000));
  const remaining = Number(scope.expiry - now);
  if (remaining <= 0) {
    lines.push("This session has already expired.");
  } else {
    lines.push(`It stops working in ${humaniseDuration(roundDuration(remaining))}.`);
  }

  return lines;
}

/** Round to the nearest whole day/hour so copy reads "7 days", not "6 days". */
function roundDuration(seconds: number): number {
  if (seconds >= 86_400) return Math.round(seconds / 86_400) * 86_400;
  if (seconds >= 3_600) return Math.round(seconds / 3_600) * 3_600;
  return Math.max(60, Math.round(seconds / 60) * 60);
}

function joinList(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0] as string;
  const head = items.slice(0, -1).join(", ");
  return `${head} and ${items[items.length - 1] as string}`;
}

// ---------------------------------------------------------------------------
// Bridge to the real SDK shape
// ---------------------------------------------------------------------------

/**
 * The permission shape @altananetwork/sdk v0.9.0 actually accepts.
 *
 * Mirrored structurally rather than imported so packages/core stays free of a
 * runtime dependency on the SDK. `CallPermission` there is
 * `{signature, to} | {signature} | {to}` — note it carries a `signature`
 * STRING, not the `selectors[]` array docs/06 assumes.
 */
export type AltanaCallPermission = { signature: string; to: Address };
export type AltanaSpendPermission = {
  limit: bigint;
  period: "minute" | "hour" | "day" | "week" | "month" | "year";
  token?: Address;
};
export type AltanaSessionPermissions = {
  calls?: readonly AltanaCallPermission[];
  spend?: readonly AltanaSpendPermission[];
};

const PERIOD_SECONDS: Record<AltanaSpendPermission["period"], number> = {
  minute: 60,
  hour: 3_600,
  day: 86_400,
  week: 604_800,
  month: 2_592_000,
  year: 31_536_000,
};

/** Map a period in seconds onto the SDK's named period, exactly or not at all. */
export function toAltanaPeriod(
  periodSeconds: number,
): AltanaSpendPermission["period"] {
  for (const [name, size] of Object.entries(PERIOD_SECONDS)) {
    if (size === periodSeconds) return name as AltanaSpendPermission["period"];
  }
  throw new Error(
    `Spend period of ${periodSeconds}s has no exact Altana equivalent. ` +
      `Use one of: ${Object.keys(PERIOD_SECONDS).join(", ")}.`,
  );
}

/**
 * Convert our scope into the SDK's permissions object.
 *
 * The cross product of targets × selectors is deliberate: Altana's
 * `CallPermission` has AND semantics between its fields, so one entry per
 * (contract, function) pair is what actually constrains the session. Granting
 * `{signature}` alone would allow that function on ANY contract.
 */
export function toAltanaPermissions(
  scope: SessionScope,
): AltanaSessionPermissions {
  const calls: AltanaCallPermission[] = [];
  for (const target of scope.calls) {
    for (const selector of scope.selectors) {
      calls.push({ signature: selector.sig, to: target.to });
    }
  }

  const spend: AltanaSpendPermission[] = scope.spend.map((s) => ({
    limit: s.limit,
    period: toAltanaPeriod(s.periodSeconds),
    token: s.token,
  }));

  return { calls, spend };
}
