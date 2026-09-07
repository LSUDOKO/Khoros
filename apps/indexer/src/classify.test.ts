/**
 * Classification tests.
 *
 * docs/10 calls this the quiet risk of phase 1 — "if most agents land in
 * `uncategorised`, the arenas will be empty" — so these cover both failure
 * directions: matching too little, and matching too confidently.
 */

import { describe, expect, it } from "vitest";

import { classificationDistribution, classify } from "./classify.js";

function reg(name: string, description: string, tags: string[] = []) {
  return { name, description, tags };
}

describe("classifies realistic registrations", () => {
  it("recognises a rebalancing agent", () => {
    const c = classify(
      reg(
        "Meridian LP Keeper",
        "Keeps your PancakeSwap V3 concentrated liquidity position in range, rebalancing the tick range as price moves.",
      ),
    );
    expect(c.category).toBe("rebalancing");
    expect(c.confidence).toBeGreaterThan(0.5);
    expect(c.protocols).toContain("pancakeswap-v3");
  });

  it("recognises a grid trading agent", () => {
    const c = classify(
      reg("GridForge", "Automated grid bot placing a ladder of limit orders across a price range."),
    );
    expect(c.category).toBe("grid-trading");
  });

  it("recognises a yield agent", () => {
    const c = classify(
      reg(
        "YieldRouter",
        "Yield optimiser that moves idle stablecoins to the best APY across Venus and Lista, auto-compounding rewards.",
      ),
    );
    expect(c.category).toBe("yield-optimisation");
    expect(c.protocols).toEqual(expect.arrayContaining(["venus", "lista"]));
  });

  it("recognises a health factor agent", () => {
    const c = classify(
      reg(
        "Bastion",
        "Liquidation protection for Venus borrowers. Monitors your health factor and tops up collateral before liquidation.",
      ),
    );
    expect(c.category).toBe("health-factor");
    expect(c.confidence).toBeGreaterThan(0.6);
  });

  it("reads tags as well as prose", () => {
    const c = classify(reg("Agent 42", "An on-chain agent.", ["grid-bot", "trading"]));
    expect(c.category).toBe("grid-trading");
  });
});

describe("declines to guess", () => {
  it("leaves an unrelated agent uncategorised", () => {
    const c = classify(reg("PixelBot", "Generates NFT artwork from prompts."));
    expect(c.category).toBe("uncategorised");
    expect(c.confidence).toBe(0);
  });

  it("leaves an empty registration uncategorised", () => {
    expect(classify(reg("", "")).category).toBe("uncategorised");
  });

  it("does not classify from a single weak keyword", () => {
    // "lp" alone scores 1, below the evidence floor.
    const c = classify(reg("Thing", "An lp tool."));
    expect(c.category).toBe("uncategorised");
  });

  // A wrong category is worse than an honest gap: someone hiring from the
  // health-factor arena expects a health-factor agent.
  it("stays uncategorised when several categories match about equally", () => {
    const c = classify(
      reg(
        "Omni",
        "Does grid trading and yield optimisation and rebalancing and liquidation protection with health factor monitoring.",
      ),
    );
    expect(c.category).toBe("uncategorised");
  });
});

describe("confidence", () => {
  it("scores a decisive registration higher than a marginal one", () => {
    const decisive = classify(
      reg("Guard", "Anti-liquidation agent monitoring health factor and collateral top-up for borrowers."),
    );
    const marginal = classify(reg("Helper", "Watches your borrow position."));

    expect(decisive.confidence).toBeGreaterThan(marginal.confidence);
  });

  it("never exceeds 1", () => {
    const c = classify(
      reg(
        "Max",
        "rebalancing concentrated liquidity clmm in-range out-of-range range management tick impermanent loss fee apr lp",
      ),
    );
    expect(c.confidence).toBeLessThanOrEqual(1);
  });
});

describe("distribution reporting", () => {
  it("counts every category including uncategorised", () => {
    const results = [
      classify(reg("A", "rebalancing concentrated liquidity manager")),
      classify(reg("B", "grid bot ladder")),
      classify(reg("C", "unrelated thing")),
    ];

    const dist = classificationDistribution(results);
    expect(dist.rebalancing).toBe(1);
    expect(dist["grid-trading"]).toBe(1);
    expect(dist.uncategorised).toBe(1);
    expect(dist["yield-optimisation"]).toBe(0);
    expect(dist["health-factor"]).toBe(0);
  });
});
