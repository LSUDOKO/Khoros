/**
 * Intent parser tests.
 *
 * docs/01-PRODUCT_SPEC.md acceptance criterion: "Every one of the four seed
 * chips parses to the correct single category. A multi-category intent
 * ('protect my loan and reinvest the yield') returns two categories and offers
 * the coordinator flow."
 */

import { CATEGORY_DEFINITIONS, AGENT_CATEGORIES } from "@khoros/core";
import { describe, expect, it } from "vitest";

import { extractParams, isMultiCategory, parseIntent } from "./parser.js";

describe("the four seed chips", () => {
  // This is the acceptance criterion, so it is asserted per chip rather than
  // in a loop that could pass while one chip silently misroutes.
  it("routes the rebalancing chip", () => {
    const r = parseIntent(CATEGORY_DEFINITIONS.rebalancing.seedChip);
    expect(r.categories).toEqual(["rebalancing"]);
    expect(r.confidence).toBe(1);
  });

  it("routes the health factor chip", () => {
    const r = parseIntent(CATEGORY_DEFINITIONS["health-factor"].seedChip);
    expect(r.categories).toEqual(["health-factor"]);
    expect(r.confidence).toBe(1);
  });

  it("routes the grid trading chip", () => {
    const r = parseIntent(CATEGORY_DEFINITIONS["grid-trading"].seedChip);
    expect(r.categories).toEqual(["grid-trading"]);
    expect(r.confidence).toBe(1);
  });

  it("routes the yield chip", () => {
    const r = parseIntent(CATEGORY_DEFINITIONS["yield-optimisation"].seedChip);
    expect(r.categories).toEqual(["yield-optimisation"]);
    expect(r.confidence).toBe(1);
  });

  it("extracts the parameters embedded in the chips", () => {
    const grid = parseIntent(CATEGORY_DEFINITIONS["grid-trading"].seedChip);
    expect(grid.params.priceRange).toEqual({ min: 500, max: 700 });

    const rebal = parseIntent(CATEGORY_DEFINITIONS.rebalancing.seedChip);
    expect(rebal.params.pair).toBe("CAKE/USDT");
    expect(rebal.params.protocols).toContain("pancakeswap-v3");
  });

  it("restates each chip in plain language", () => {
    for (const category of AGENT_CATEGORIES) {
      const r = parseIntent(CATEGORY_DEFINITIONS[category].seedChip);
      expect(r.restated).toMatch(/^Looking for agents that /);
      expect(r.restated.length).toBeGreaterThan(30);
    }
  });
});

describe("free-text intents", () => {
  it("classifies a paraphrased rebalancing goal", () => {
    const r = parseIntent("my LP position keeps going out of range, fix it");
    expect(r.categories[0]).toBe("rebalancing");
  });

  it("classifies a paraphrased liquidation worry", () => {
    const r = parseIntent("I'm scared my collateral will get liquidated");
    expect(r.categories[0]).toBe("health-factor");
  });

  it("classifies a paraphrased yield goal", () => {
    const r = parseIntent("where can I get the best APY for my idle USDC?");
    expect(r.categories[0]).toBe("yield-optimisation");
  });

  it("classifies a paraphrased grid goal", () => {
    const r = parseIntent("set up a ladder of orders to trade the chop");
    expect(r.categories[0]).toBe("grid-trading");
  });
});

describe("multi-category intents", () => {
  it("returns two categories for the spec's own example", () => {
    // docs/01: "protect my loan and reinvest the yield"
    const r = parseIntent("protect my loan and reinvest the yield");
    expect(r.categories).toContain("health-factor");
    expect(r.categories).toContain("yield-optimisation");
    expect(isMultiCategory(r)).toBe(true);
  });

  it("does not flag a single-category intent as multi", () => {
    const r = parseIntent(CATEGORY_DEFINITIONS.rebalancing.seedChip);
    expect(isMultiCategory(r)).toBe(false);
  });
});

describe("low confidence", () => {
  // "An honest 'here's everything, pick a category' beats a confident
  // mismatch." (docs/01)
  it("shows all four categories for unrelated text", () => {
    const r = parseIntent("what is the weather like today");
    expect(r.categories).toHaveLength(4);
    expect(r.confidence).toBe(0);
  });

  it("shows all four categories for empty input", () => {
    const r = parseIntent("   ");
    expect(r.categories).toHaveLength(4);
  });

  it("does not treat a single weak keyword as certainty", () => {
    const r = parseIntent("something about a position");
    expect(r.confidence).toBeLessThan(1);
  });
});

describe("parameter extraction", () => {
  it("reads a trading pair", () => {
    expect(extractParams("manage my BNB/USDT position").pair).toBe("BNB/USDT");
  });

  it("reads a price range", () => {
    expect(extractParams("between $1,200 and $1,800").priceRange).toEqual({
      min: 1200,
      max: 1800,
    });
  });

  it("reads a health factor floor", () => {
    expect(extractParams("keep my health factor above 1.4").healthFactorFloor).toBe(
      1.4,
    );
  });

  it("reads capital with a k suffix", () => {
    expect(extractParams("put $10k to work").capitalUsd).toBe(10_000);
  });

  it("does not mistake a price range for capital", () => {
    expect(extractParams("grid between $500 and $700").capitalUsd).toBeUndefined();
  });

  it("reads named protocols", () => {
    const p = extractParams("move from venus to pancakeswap");
    expect(p.protocols).toContain("venus");
    expect(p.protocols).toContain("pancakeswap-v3");
  });

  it("returns nothing rather than guessing when the text has no parameters", () => {
    expect(extractParams("help me earn more")).toEqual({});
  });
});
