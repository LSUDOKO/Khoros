/**
 * Session scope tests.
 *
 * These exist because of a real bug found by exercising the running app: the
 * health-factor and yield categories could not be hired AT ALL, because Venus,
 * Lista and Aave had no testnet addresses configured and buildSessionScope
 * threw. The hire form rendered an error instead of permissions, and
 * /api/hire returned 500. Two of four categories were silently unhireable —
 * an equal-depth failure that no unit test caught, because nothing asserted
 * that every category can actually produce a scope.
 *
 * That assertion is the first test below.
 */

import { AGENT_CATEGORIES, categoryDefinition } from "@khoros/core";
import { describe, expect, it } from "vitest";

import {
  MAINNET_TARGETS,
  TESTNET_TARGETS,
  TESTNET_UNAVAILABLE,
  EXECUTION_TOKEN,
} from "../chain/addresses.js";

import { buildSessionScope, scopeOmissions } from "./sessions.js";

const NOW = 1_760_000_000n;

describe("every category can be hired", () => {
  // The regression test. If a category's contracts go missing from a chain's
  // target map without being declared unavailable, this fails.
  for (const category of AGENT_CATEGORIES) {
    it(`${category} builds a scope on testnet`, () => {
      const scope = buildSessionScope({
        category,
        targets: TESTNET_TARGETS,
        unavailable: TESTNET_UNAVAILABLE,
        spendToken: EXECUTION_TOKEN,
        spendLimit: 100n,
        now: NOW,
      });

      expect(scope.calls.length).toBeGreaterThan(0);
      expect(scope.selectors.length).toBeGreaterThan(0);
      expect(scope.spend).toHaveLength(1);
      expect(scope.expiry).toBeGreaterThan(NOW);
    });

    it(`${category} builds a scope on mainnet`, () => {
      const scope = buildSessionScope({
        category,
        targets: MAINNET_TARGETS,
        spendToken: EXECUTION_TOKEN,
        spendLimit: 100n,
        now: NOW,
      });
      expect(scope.calls.length).toBeGreaterThan(0);
    });
  }
});

describe("unavailable targets", () => {
  it("drops a declared-unavailable target and records why", () => {
    // Aave has no verified BSC Testnet deployment.
    const scope = buildSessionScope({
      category: "health-factor",
      targets: TESTNET_TARGETS,
      unavailable: TESTNET_UNAVAILABLE,
      spendToken: EXECUTION_TOKEN,
      spendLimit: 100n,
      now: NOW,
    });

    const omissions = scopeOmissions(scope);
    expect(omissions.some((o) => o.key === "AAVE_V3_POOL")).toBe(true);
    expect(omissions[0]?.reason).toMatch(/Aave/);

    // And the dropped target really is absent from what gets granted.
    const labels = scope.calls.map((c) => c.label).join(" ");
    expect(labels).not.toMatch(/Aave/);
  });

  // An unexplained missing address is a configuration error, not a feature.
  // Silently granting a narrower scope than the preview describes would make
  // the UI lie about what the agent may do.
  it("throws on a missing address that was not declared unavailable", () => {
    expect(() =>
      buildSessionScope({
        category: "health-factor",
        targets: {},
        spendToken: EXECUTION_TOKEN,
        spendLimit: 100n,
        now: NOW,
      }),
    ).toThrow(/No address configured/);
  });

  it("throws rather than granting an empty scope", () => {
    // Everything declared unavailable — a session would permit nothing.
    const allUnavailable = Object.fromEntries(
      categoryDefinition("rebalancing").scope.targets.map((t) => [
        t.key,
        "not deployed",
      ]),
    );

    expect(() =>
      buildSessionScope({
        category: "rebalancing",
        targets: {},
        unavailable: allUnavailable,
        spendToken: EXECUTION_TOKEN,
        spendLimit: 100n,
        now: NOW,
      }),
    ).toThrow(/nothing a session could permit/);
  });
});

describe("scope contents", () => {
  it("carries the category's full selector list", () => {
    for (const category of AGENT_CATEGORIES) {
      const scope = buildSessionScope({
        category,
        targets: TESTNET_TARGETS,
        unavailable: TESTNET_UNAVAILABLE,
        spendToken: EXECUTION_TOKEN,
        spendLimit: 100n,
        now: NOW,
      });
      expect(scope.selectors).toHaveLength(
        categoryDefinition(category).scope.selectors.length,
      );
    }
  });

  it("honours the requested expiry", () => {
    const scope = buildSessionScope({
      category: "rebalancing",
      targets: TESTNET_TARGETS,
      unavailable: TESTNET_UNAVAILABLE,
      spendToken: EXECUTION_TOKEN,
      spendLimit: 100n,
      expirySeconds: 3600,
      now: NOW,
    });
    expect(scope.expiry).toBe(NOW + 3600n);
  });

  it("defaults to the category's own expiry when none is given", () => {
    for (const category of AGENT_CATEGORIES) {
      const scope = buildSessionScope({
        category,
        targets: TESTNET_TARGETS,
        unavailable: TESTNET_UNAVAILABLE,
        spendToken: EXECUTION_TOKEN,
        spendLimit: 100n,
        now: NOW,
      });
      expect(scope.expiry).toBe(
        NOW + BigInt(categoryDefinition(category).scope.defaultExpirySeconds),
      );
    }
  });

  it("never grants a transfer selector to any category", () => {
    // The guarantee users care about most: an agent cannot move their tokens.
    for (const category of AGENT_CATEGORIES) {
      const scope = buildSessionScope({
        category,
        targets: TESTNET_TARGETS,
        unavailable: TESTNET_UNAVAILABLE,
        spendToken: EXECUTION_TOKEN,
        spendLimit: 100n,
        now: NOW,
      });
      const names = scope.selectors.map((s) => s.name);
      expect(names).not.toContain("transfer");
      expect(names).not.toContain("transferFrom");
      expect(names).not.toContain("approve");
    }
  });

  it("never grants borrow to the health factor agent", () => {
    // docs/03: the agent can never increase your leverage.
    const scope = buildSessionScope({
      category: "health-factor",
      targets: TESTNET_TARGETS,
      unavailable: TESTNET_UNAVAILABLE,
      spendToken: EXECUTION_TOKEN,
      spendLimit: 100n,
      now: NOW,
    });
    expect(scope.selectors.map((s) => s.name)).not.toContain("borrow");
  });
});
