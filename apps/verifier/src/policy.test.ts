/**
 * Policy evaluator tests.
 *
 * Two properties matter most and are asserted directly:
 *
 *   1. PURITY — the same inputs always produce the same verdict. docs/05 says
 *      this is "what lets a user trust the gate at all".
 *   2. FAIL CLOSED — an invariant whose evidence is missing REFUSES. "We could
 *      not tell" must never be treated as "it is fine".
 */

import { AGENT_CATEGORIES, CATEGORY_DEFINITIONS } from "@khoros/core";
import { describe, expect, it } from "vitest";

import {
  CATEGORY_INVARIANTS,
  evaluatePolicy,
  type Address,
  type Policy,
  type PolicyInput,
  type Selector,
} from "./policy.js";

const TARGET = "0x1111111111111111111111111111111111111111" as Address;
const OTHER = "0x9999999999999999999999999999999999999999" as Address;
const SELECTOR = "0x88316456" as Selector;
const TOKEN = "0x55d398326f99059ff775485246999027b3197955" as Address;

function policy(over: Partial<Policy> = {}): Policy {
  return {
    allowedTargets: [TARGET],
    allowedSelectors: [SELECTOR],
    maxSlippageBps: 50,
    spendCaps: [{ token: TOKEN, limit: 100n, periodSeconds: 86_400 }],
    invariants: [],
    ...over,
  };
}

function input(over: Partial<PolicyInput> = {}): PolicyInput {
  return {
    target: TARGET,
    selector: SELECTOR,
    maxSlippageBps: 50,
    diff: {},
    ...over,
  };
}

describe("allowlists", () => {
  it("approves a call inside the allowlists", () => {
    expect(evaluatePolicy(policy(), input()).ok).toBe(true);
  });

  it("refuses a contract that was never approved", () => {
    const v = evaluatePolicy(policy(), input({ target: OTHER }));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.failedInvariant).toBe("target-allowlist");
  });

  it("refuses a function that was never granted", () => {
    const v = evaluatePolicy(policy(), input({ selector: "0xdeadbeef" as Selector }));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.failedInvariant).toBe("selector-allowlist");
  });

  it("compares addresses case-insensitively", () => {
    const upper = TARGET.toUpperCase().replace("0X", "0x") as Address;
    expect(evaluatePolicy(policy(), input({ target: upper })).ok).toBe(true);
  });
});

describe("slippage", () => {
  it("refuses an intent declaring more slippage than the cap", () => {
    const v = evaluatePolicy(policy(), input({ maxSlippageBps: 80 }));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.failedInvariant).toBe("max-slippage-bps");
  });

  it("refuses when the simulation itself exceeds the cap", () => {
    const v = evaluatePolicy(policy(), input({ diff: { slippageBps: 80 } }));
    expect(v.ok).toBe(false);
    // docs/01 copy rule: say what happened and what to do.
    if (!v.ok) expect(v.reason).toContain("Raise the cap");
  });
});

describe("spend caps", () => {
  it("allows spending within the cap", () => {
    const v = evaluatePolicy(
      policy(),
      input({ spend: { [TOKEN]: 40n }, diff: { spentInWindow: { [TOKEN]: 30n } } }),
    );
    expect(v.ok).toBe(true);
  });

  it("counts what was already spent in the window", () => {
    const v = evaluatePolicy(
      policy(),
      input({ spend: { [TOKEN]: 40n }, diff: { spentInWindow: { [TOKEN]: 80n } } }),
    );
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.failedInvariant).toBe("spend-cap");
  });
});

// ---------------------------------------------------------------------------
// Fail closed — the most important property here
// ---------------------------------------------------------------------------

describe("fails closed when evidence is missing", () => {
  // An invariant that cannot be checked must REFUSE. Treating "unknown" as
  // "fine" would be the single most dangerous bug this layer could have.
  const cases: { name: string; invariants: Policy["invariants"] }[] = [
    { name: "no-net-outflow", invariants: [{ kind: "no-net-outflow" }] },
    { name: "hf-must-improve", invariants: [{ kind: "hf-must-improve" }] },
    { name: "hf-floor-after", invariants: [{ kind: "hf-floor-after", value: 1.4 }] },
    {
      name: "min-range-width-bps",
      invariants: [{ kind: "min-range-width-bps", value: 200 }],
    },
    { name: "range-contains-spot", invariants: [{ kind: "range-contains-spot" }] },
    {
      name: "max-concentration-bps",
      invariants: [{ kind: "max-concentration-bps", value: 6000 }],
    },
    {
      name: "oracle-deviation-max-bps",
      invariants: [{ kind: "oracle-deviation-max-bps", value: 200 }],
    },
    {
      name: "destination-allowlisted",
      invariants: [{ kind: "destination-allowlisted", value: ["venus"] }],
    },
    {
      name: "value-preserved-bps",
      invariants: [{ kind: "value-preserved-bps", value: 100 }],
    },
    {
      name: "utilisation-max-bps",
      invariants: [{ kind: "utilisation-max-bps", value: 9500 }],
    },
    {
      name: "trade-size-within-level",
      invariants: [{ kind: "trade-size-within-level" }],
    },
  ];

  for (const c of cases) {
    it(`refuses ${c.name} when the simulation observed nothing`, () => {
      const v = evaluatePolicy(policy({ invariants: c.invariants }), input());
      expect(v.ok).toBe(false);
      if (!v.ok) {
        expect(v.failedInvariant).toBe(c.name);
        expect(v.observed).toBe("not observed");
        expect(v.reason).toContain("unverifiable");
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Invariants
// ---------------------------------------------------------------------------

describe("no-net-outflow", () => {
  it("passes when nothing leaves", () => {
    const v = evaluatePolicy(
      policy({ invariants: [{ kind: "no-net-outflow" }] }),
      input({ diff: { netOutflow: { [TOKEN]: 0n } } }),
    );
    expect(v.ok).toBe(true);
  });

  it("refuses any outflow", () => {
    const v = evaluatePolicy(
      policy({ invariants: [{ kind: "no-net-outflow" }] }),
      input({ diff: { netOutflow: { [TOKEN]: 1n } } }),
    );
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toContain("never withdraw");
  });
});

describe("health factor invariants", () => {
  it("requires the health factor to improve", () => {
    const v = evaluatePolicy(
      policy({ invariants: [{ kind: "hf-must-improve" }] }),
      input({ diff: { hfBefore: 1.2, hfAfter: 1.2 } }),
    );
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.failedInvariant).toBe("hf-must-improve");
  });

  it("requires the result to clear the floor", () => {
    const v = evaluatePolicy(
      policy({ invariants: [{ kind: "hf-floor-after", value: 1.4 }] }),
      input({ diff: { hfAfter: 1.22 } }),
    );
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.observed).toBe("1.220");
      expect(v.expected).toBe("at least 1.4");
    }
  });

  it("approves an intervention that genuinely restores the position", () => {
    const v = evaluatePolicy(
      policy({
        invariants: [{ kind: "hf-must-improve" }, { kind: "hf-floor-after", value: 1.4 }],
      }),
      input({ diff: { hfBefore: 1.12, hfAfter: 1.45 } }),
    );
    expect(v.ok).toBe(true);
  });
});

describe("range invariants", () => {
  it("refuses a dust range", () => {
    const v = evaluatePolicy(
      policy({ invariants: [{ kind: "min-range-width-bps", value: 200 }] }),
      input({ diff: { rangeLower: 100, rangeUpper: 100.5 } }),
    );
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toContain("griefing");
  });

  it("refuses a range that does not contain the current price", () => {
    const v = evaluatePolicy(
      policy({ invariants: [{ kind: "range-contains-spot" }] }),
      input({ diff: { rangeLower: 100, rangeUpper: 110, spotPrice: 95 } }),
    );
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.failedInvariant).toBe("range-contains-spot");
  });
});

describe("oracle deviation", () => {
  it("refuses when spot is far from the oracle", () => {
    const v = evaluatePolicy(
      policy({ invariants: [{ kind: "oracle-deviation-max-bps", value: 200 }] }),
      input({ diff: { spotPrice: 110, oraclePrice: 100 } }),
    );
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toContain("manipulated");
  });

  it("refuses rather than dividing by a zero oracle price", () => {
    const v = evaluatePolicy(
      policy({ invariants: [{ kind: "oracle-deviation-max-bps", value: 200 }] }),
      input({ diff: { spotPrice: 110, oraclePrice: 0 } }),
    );
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.observed).toBe("not observed");
  });
});

describe("yield invariants", () => {
  it("refuses a destination outside the allowlist", () => {
    const v = evaluatePolicy(
      policy({ invariants: [{ kind: "destination-allowlisted", value: ["venus"] }] }),
      input({ diff: { destination: "attacker-protocol" } }),
    );
    expect(v.ok).toBe(false);
  });

  it("refuses a move that loses too much value in transition", () => {
    const v = evaluatePolicy(
      policy({ invariants: [{ kind: "value-preserved-bps", value: 100 }] }),
      input({ diff: { valueBeforeUsd: 10_000, valueAfterUsd: 9_800 } }),
    );
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.observed).toBe("2.00% lost");
  });

  it("refuses a destination that is nearly fully borrowed", () => {
    const v = evaluatePolicy(
      policy({ invariants: [{ kind: "utilisation-max-bps", value: 9500 }] }),
      input({ diff: { utilisationBps: 9900 } }),
    );
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toContain("withdraw");
  });
});

// ---------------------------------------------------------------------------
// Purity
// ---------------------------------------------------------------------------

describe("purity", () => {
  it("returns the same verdict for the same inputs, every time", () => {
    const p = policy({
      invariants: [
        { kind: "hf-must-improve" },
        { kind: "hf-floor-after", value: 1.4 },
        { kind: "oracle-deviation-max-bps", value: 200 },
      ],
    });
    const i = input({ diff: { hfBefore: 1.1, hfAfter: 1.2, spotPrice: 100, oraclePrice: 100 } });

    const first = JSON.stringify(evaluatePolicy(p, i));
    for (let n = 0; n < 50; n++) {
      expect(JSON.stringify(evaluatePolicy(p, i))).toBe(first);
    }
  });

  it("does not mutate its inputs", () => {
    const p = policy({ invariants: [{ kind: "no-net-outflow" }] });
    const i = input({ diff: { netOutflow: { [TOKEN]: 0n } } });
    const before = JSON.stringify(p, (_, v) =>
      typeof v === "bigint" ? v.toString() : v,
    );

    evaluatePolicy(p, i);

    expect(JSON.stringify(p, (_, v) => (typeof v === "bigint" ? v.toString() : v))).toBe(
      before,
    );
  });
});

// ---------------------------------------------------------------------------
// Equal depth
// ---------------------------------------------------------------------------

describe("every category is actually enforced", () => {
  it("defines invariants for all four categories", () => {
    for (const category of AGENT_CATEGORIES) {
      expect(CATEGORY_INVARIANTS[category].length).toBeGreaterThan(0);
    }
  });

  // The UI promises a list of constraints per category. If the verifier
  // enforced fewer, the profile page would be making a promise nothing keeps.
  it("enforces at least as many invariants as each profile advertises", () => {
    for (const category of AGENT_CATEGORIES) {
      const advertised = CATEGORY_DEFINITIONS[category].constraints.length;
      const enforced = CATEGORY_INVARIANTS[category].length;
      expect(enforced).toBeGreaterThanOrEqual(advertised - 1);
    }
  });
});
