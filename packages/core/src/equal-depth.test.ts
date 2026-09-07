/**
 * The equal-depth audit, as a test.
 *
 * docs/03: "Before any commit touching category UI, check the four categories
 * render the same sections with the same density." A screenshot comparison is
 * subjective and easy to skip; these assertions are neither.
 */
import { AGENT_CATEGORIES, CATEGORY_DEFINITIONS, METRIC_SLOTS } from "@khoros/core";
import { describe, expect, it } from "vitest";

describe("equal-depth audit", () => {
  it("defines all four categories", () => {
    expect(AGENT_CATEGORIES).toHaveLength(4);
  });

  for (const category of AGENT_CATEGORIES) {
    describe(category, () => {
      const d = CATEGORY_DEFINITIONS[category];

      // Artifact 1 — plain-language description, two sentences.
      it("has a substantive description", () => {
        expect(d.description.length).toBeGreaterThan(120);
      });

      // Artifact 2 — strategy write-up.
      it("has a strategy write-up of comparable depth", () => {
        expect(d.strategy.length).toBeGreaterThan(250);
      });

      // Artifact 3 — trigger stated precisely.
      it("states its trigger precisely", () => {
        expect(d.trigger.length).toBeGreaterThan(120);
      });

      // Artifact 4 — all six slots, labelled.
      it("labels all six metric slots", () => {
        for (const slot of METRIC_SLOTS) {
          expect(d.metrics[slot]).toBeTruthy();
          expect(d.metrics[slot].length).toBeGreaterThan(2);
        }
      });

      // Artifact 7 — session scope manifest.
      it("has a session scope with targets, selectors and denials", () => {
        expect(d.scope.targets.length).toBeGreaterThan(0);
        expect(d.scope.selectors.length).toBeGreaterThan(0);
        expect(d.scope.denied.length).toBeGreaterThan(0);
        expect(d.scope.defaultExpirySeconds).toBeGreaterThan(0);
      });

      it("uses real 4-byte selectors", () => {
        for (const s of d.scope.selectors) {
          expect(s.sig).toMatch(/^0x[0-9a-f]{8}$/);
          expect(s.name.length).toBeGreaterThan(2);
        }
      });

      // Artifact 8 — PACE constraints.
      it("declares policy constraints", () => {
        expect(d.constraints.length).toBeGreaterThanOrEqual(3);
        for (const c of d.constraints) {
          expect(c.description.length).toBeGreaterThan(30);
        }
      });

      // Artifact 10 — configurable boundaries.
      it("has boundary defaults matching its own kind", () => {
        expect(d.defaultBoundaries.kind).toBe(category);
      });

      it("has a seed chip", () => {
        expect(d.seedChip.length).toBeGreaterThan(15);
      });

      it("names at least one protocol", () => {
        expect(d.protocols.length).toBeGreaterThan(0);
      });
    });
  }

  // The real test of equal depth: no category may be dramatically thinner than
  // its siblings. Prose lengths within 2.5x of each other.
  it("keeps prose depth comparable across categories", () => {
    const lengths = AGENT_CATEGORIES.map(
      (c) =>
        CATEGORY_DEFINITIONS[c].description.length +
        CATEGORY_DEFINITIONS[c].strategy.length +
        CATEGORY_DEFINITIONS[c].trigger.length,
    );
    const min = Math.min(...lengths);
    const max = Math.max(...lengths);
    expect(max / min).toBeLessThan(2.5);
  });

  it("gives every category a comparable number of configurable knobs", () => {
    const counts = AGENT_CATEGORIES.map(
      (c) => Object.keys(CATEGORY_DEFINITIONS[c].defaultBoundaries).length,
    );
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(3);
  });
});
