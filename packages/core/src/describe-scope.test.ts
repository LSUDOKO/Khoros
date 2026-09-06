import { describe, expect, it } from "vitest";

import {
  describeScope,
  formatAmount,
  toAltanaPermissions,
  toAltanaPeriod,
} from "./describe-scope.js";
import type { Address, SessionScope } from "./types.js";

const POSITION_MANAGER = "0x1234567890123456789012345678901234567890" as Address;
const SWAP_ROUTER = "0x0987654321098765432109876543210987654321" as Address;
const USDT = "0x55d398326f99059fF775485246999027B3197955" as Address;
const CAKE = "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82" as Address;

const NOW = 1_760_000_000n;

function scope(overrides: Partial<SessionScope> = {}): SessionScope {
  return {
    calls: [{ to: POSITION_MANAGER, label: "PancakeSwap V3 Position Manager" }],
    selectors: [
      { sig: "0x88316456", name: "mint" },
      { sig: "0xfc6f7865", name: "collect" },
    ],
    spend: [{ token: USDT, limit: 100_000_000_000_000_000_000n, periodSeconds: 86_400 }],
    expiry: NOW + 7n * 86_400n,
    ...overrides,
  };
}

const TOKENS = {
  [USDT.toLowerCase()]: { symbol: "USDT", decimals: 18 },
  [CAKE.toLowerCase()]: { symbol: "CAKE", decimals: 18 },
};

describe("formatAmount", () => {
  it("renders whole units without a trailing decimal point", () => {
    expect(formatAmount(100_000_000_000_000_000_000n, 18)).toBe("100");
  });

  it("trims trailing zeros in the fraction", () => {
    expect(formatAmount(1_500_000_000_000_000_000n, 18)).toBe("1.5");
  });

  it("handles sub-unit amounts", () => {
    expect(formatAmount(1n, 18)).toBe("0.000000000000000001");
  });

  it("handles zero decimals", () => {
    expect(formatAmount(42n, 0)).toBe("42");
  });
});

describe("describeScope", () => {
  it("names the contracts, the functions, and the cap", () => {
    const lines = describeScope(scope(), { tokens: TOKENS, now: NOW });

    expect(lines).toEqual([
      "This agent can call PancakeSwap V3 Position Manager.",
      "It can mint and collect.",
      "It cannot transfer your tokens anywhere.",
      "It can spend at most 100 USDT per 1 day.",
      "It stops working in 7 days.",
    ]);
  });

  it("joins several contracts and functions readably", () => {
    const lines = describeScope(
      scope({
        calls: [
          { to: POSITION_MANAGER, label: "PancakeSwap V3 Position Manager" },
          { to: SWAP_ROUTER, label: "PancakeSwap V3 Swap Router" },
        ],
        selectors: [
          { sig: "0x88316456", name: "mint" },
          { sig: "0x0c49ccbe", name: "decreaseLiquidity" },
          { sig: "0xfc6f7865", name: "collect" },
        ],
      }),
      { tokens: TOKENS, now: NOW },
    );

    expect(lines[0]).toBe(
      "This agent can call PancakeSwap V3 Position Manager and PancakeSwap V3 Swap Router.",
    );
    expect(lines[1]).toBe("It can mint, decreaseLiquidity and collect.");
  });

  // The doc's reference sketch read spend[0] and dropped the rest. That is the
  // exact drift describeScope exists to prevent, so it is worth a test.
  it("describes every spend cap, not just the first", () => {
    const lines = describeScope(
      scope({
        spend: [
          { token: USDT, limit: 100_000_000_000_000_000_000n, periodSeconds: 86_400 },
          { token: CAKE, limit: 50_000_000_000_000_000_000n, periodSeconds: 3_600 },
        ],
      }),
      { tokens: TOKENS, now: NOW },
    );

    expect(lines).toContain("It can spend at most 100 USDT per 1 day.");
    expect(lines).toContain("It can spend at most 50 CAKE per 1 hour.");
  });

  it("warns loudly when the call allowlist is empty", () => {
    const lines = describeScope(scope({ calls: [] }), { tokens: TOKENS, now: NOW });
    expect(lines[0]).toContain("can call any contract");
  });

  it("warns when no spending cap is set", () => {
    const lines = describeScope(scope({ spend: [] }), { tokens: TOKENS, now: NOW });
    expect(lines).toContain("No spending cap is set on this session.");
  });

  it("drops the no-transfer promise when transfer is actually granted", () => {
    const lines = describeScope(
      scope({ selectors: [{ sig: "0xa9059cbb", name: "transfer" }] }),
      { tokens: TOKENS, now: NOW },
    );
    expect(lines).not.toContain("It cannot transfer your tokens anywhere.");
  });

  it("says so when the session has already expired", () => {
    const lines = describeScope(scope({ expiry: NOW - 1n }), {
      tokens: TOKENS,
      now: NOW,
    });
    expect(lines).toContain("This session has already expired.");
  });

  // Never invent a symbol for a token we do not know.
  it("falls back to a truncated address for an unknown token", () => {
    const lines = describeScope(scope(), { now: NOW });
    expect(lines.some((l) => l.includes("0x55d3…7955"))).toBe(true);
  });
});

describe("toAltanaPermissions", () => {
  it("produces one call permission per (contract, function) pair", () => {
    const permissions = toAltanaPermissions(
      scope({
        calls: [
          { to: POSITION_MANAGER, label: "Position Manager" },
          { to: SWAP_ROUTER, label: "Swap Router" },
        ],
        selectors: [
          { sig: "0x88316456", name: "mint" },
          { sig: "0xfc6f7865", name: "collect" },
        ],
      }),
    );

    // 2 targets x 2 selectors. Anything fewer would leave a function callable
    // on a contract the user never approved.
    expect(permissions.calls).toHaveLength(4);
    expect(permissions.calls).toContainEqual({
      signature: "0x88316456",
      to: POSITION_MANAGER,
    });
    expect(permissions.calls).toContainEqual({
      signature: "0xfc6f7865",
      to: SWAP_ROUTER,
    });
  });

  it("always binds a signature to a target, never a bare signature", () => {
    const permissions = toAltanaPermissions(scope());
    for (const call of permissions.calls ?? []) {
      expect(call.to).toBeDefined();
      expect(call.signature).toBeDefined();
    }
  });

  it("maps spend caps onto named SDK periods", () => {
    const permissions = toAltanaPermissions(scope());
    expect(permissions.spend).toEqual([
      { limit: 100_000_000_000_000_000_000n, period: "day", token: USDT },
    ]);
  });
});

describe("toAltanaPeriod", () => {
  it("maps exact durations", () => {
    expect(toAltanaPeriod(86_400)).toBe("day");
    expect(toAltanaPeriod(3_600)).toBe("hour");
    expect(toAltanaPeriod(604_800)).toBe("week");
  });

  // Silently rounding a spend period would mean the copy and the on-chain cap
  // describe different windows.
  it("throws rather than approximating an unrepresentable period", () => {
    expect(() => toAltanaPeriod(7_200)).toThrow(/no exact Altana equivalent/);
  });
});
