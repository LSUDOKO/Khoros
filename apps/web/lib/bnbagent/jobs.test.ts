/**
 * Coordinator tests.
 *
 * The invariant that matters: two agents must never be able to spend the same
 * dollar. docs/03 calls for "a shared constraint object so two agents can't
 * spend the same dollar", and these assert it holds for every split, including
 * the awkward ones where integer division leaves a remainder.
 */

import { AGENT_CATEGORIES } from "@khoros/core";
import type { AgentCategory } from "@khoros/core";
import { describe, expect, it } from "vitest";

import { jobStateFromStatus, planCoordination, validatePlan } from "./jobs.js";

const TOTAL = 1_000_000_000_000_000_000_000n; // 1000 units, 18dp

describe("planCoordination", () => {
  it("returns nothing for no categories", () => {
    expect(planCoordination([], TOTAL).parts).toHaveLength(0);
  });

  it("gives a single specialist the whole allocation", () => {
    const plan = planCoordination(["rebalancing"], TOTAL);
    expect(plan.parts).toHaveLength(1);
    expect(plan.parts[0]?.allocation).toBe(TOTAL);
    expect(validatePlan(plan)).toEqual([]);
  });

  // The spec's own worked example: the health-factor agent holds a reserve and
  // the yield agent works only the surplus above it.
  it("holds back a reserve when protecting a loan and reinvesting", () => {
    const plan = planCoordination(["health-factor", "yield-optimisation"], TOTAL);

    const hf = plan.parts.find((p) => p.category === "health-factor");
    const yieldPart = plan.parts.find((p) => p.category === "yield-optimisation");

    expect(hf?.allocation).toBe((TOTAL * 40n) / 100n);
    expect(yieldPart?.allocation).toBe(TOTAL - (TOTAL * 40n) / 100n);
    expect(yieldPart?.role).toContain("surplus");
    expect(validatePlan(plan)).toEqual([]);
  });

  it("splits evenly across other combinations", () => {
    const plan = planCoordination(["rebalancing", "grid-trading"], TOTAL);
    expect(plan.parts).toHaveLength(2);
    expect(validatePlan(plan)).toEqual([]);
  });

  it("deduplicates a repeated category", () => {
    const plan = planCoordination(
      ["rebalancing", "rebalancing"] as AgentCategory[],
      TOTAL,
    );
    expect(plan.parts).toHaveLength(1);
    expect(validatePlan(plan)).toEqual([]);
  });

  it("gives every specialist a role for the cascade UI", () => {
    const plan = planCoordination([...AGENT_CATEGORIES], TOTAL);
    for (const part of plan.parts) {
      expect(part.role.length).toBeGreaterThan(10);
    }
  });
});

describe("no two agents can spend the same dollar", () => {
  // Integer division is where a double-spend would hide, so the awkward
  // totals are tested explicitly.
  const totals = [
    1n,
    2n,
    3n,
    7n,
    99n,
    100n,
    1_000_000_000_000_000_000n,
    1_000_000_000_000_000_001n,
    TOTAL,
    123_456_789_987_654_321n,
  ];

  for (const total of totals) {
    it(`allocations sum exactly to ${total}`, () => {
      for (let n = 1; n <= 4; n++) {
        const categories = AGENT_CATEGORIES.slice(0, n);
        const plan = planCoordination([...categories], total);

        const sum = plan.parts.reduce((acc, p) => acc + p.allocation, 0n);
        expect(sum).toBe(total);
      }
    });
  }

  it("never allocates more than the parent holds", () => {
    for (let n = 1; n <= 4; n++) {
      const plan = planCoordination([...AGENT_CATEGORIES.slice(0, n)], TOTAL);
      for (const part of plan.parts) {
        expect(part.allocation).toBeLessThanOrEqual(TOTAL);
      }
    }
  });
});

describe("validatePlan", () => {
  it("catches an over-allocation", () => {
    const problems = validatePlan({
      total: 100n,
      parts: [
        { category: "rebalancing", allocation: 60n, role: "a" },
        { category: "grid-trading", allocation: 60n, role: "b" },
      ],
    });
    expect(problems.length).toBeGreaterThan(0);
    expect(problems[0]).toContain("same capital");
  });

  it("catches an under-allocation", () => {
    const problems = validatePlan({
      total: 100n,
      parts: [{ category: "rebalancing", allocation: 40n, role: "a" }],
    });
    expect(problems.length).toBeGreaterThan(0);
  });

  it("catches a specialist allocated nothing", () => {
    const problems = validatePlan({
      total: 100n,
      parts: [
        { category: "rebalancing", allocation: 100n, role: "a" },
        { category: "grid-trading", allocation: 0n, role: "b" },
      ],
    });
    expect(problems.some((p) => p.includes("allocated nothing"))).toBe(true);
  });

  it("catches a duplicated category", () => {
    const problems = validatePlan({
      total: 100n,
      parts: [
        { category: "rebalancing", allocation: 50n, role: "a" },
        { category: "rebalancing", allocation: 50n, role: "b" },
      ],
    });
    expect(problems.some((p) => p.includes("twice"))).toBe(true);
  });
});

describe("job state mapping", () => {
  // Order-locked with the AgenticCommerce kernel's enum.
  it("maps kernel status codes in order", () => {
    expect(jobStateFromStatus(0)).toBe("open");
    expect(jobStateFromStatus(1)).toBe("funded");
    expect(jobStateFromStatus(2)).toBe("submitted");
    expect(jobStateFromStatus(3)).toBe("completed");
    expect(jobStateFromStatus(4)).toBe("rejected");
    expect(jobStateFromStatus(5)).toBe("expired");
  });

  it("falls back safely on an unknown status", () => {
    expect(jobStateFromStatus(99)).toBe("open");
  });
});
