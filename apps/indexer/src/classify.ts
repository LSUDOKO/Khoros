/**
 * Category classification from ERC-8004 registration data.
 *
 * docs/10-BUILD_PLAN.md flags this as the quiet risk of the whole phase:
 * "if most agents land in `uncategorised`, the arenas will be empty."
 *
 * So this is deliberately generous about matching and conservative about
 * confidence. An agent lands in a category when its registration text contains
 * signals for it; the score is reported alongside so the UI can say how sure we
 * are, and anything ambiguous stays `uncategorised` rather than being forced
 * into whichever category scored least badly.
 */

import type { AgentCategory, AgentCategoryOrUncategorised, Protocol } from "@khoros/core";

export type RegistrationText = {
  name: string;
  description: string;
  /** Free-form tags, skills or capability strings from the registration file. */
  tags?: string[];
};

/**
 * Weighted signals per category.
 *
 * Weights are deliberate: a term that appears only in one category's context
 * scores higher than one that could belong to several. "grid" is decisive;
 * "position" is not.
 */
const SIGNALS: Record<AgentCategory, { term: RegExp; weight: number }[]> = {
  rebalancing: [
    { term: /\brebalanc\w*/, weight: 5 },
    { term: /\bconcentrated liquidity\b|\bclmm\b/, weight: 5 },
    { term: /\bin[- ]range\b|\bout[- ]of[- ]range\b/, weight: 4 },
    { term: /\brange (management|order|width)\b/, weight: 4 },
    { term: /\bliquidity (manager|management|provider|position)\b/, weight: 3 },
    { term: /\btick\b/, weight: 2 },
    { term: /\bimpermanent loss\b|\blvr\b/, weight: 2 },
    { term: /\bfee (apr|tier|capture)\b/, weight: 2 },
    { term: /\blp\b/, weight: 1 },
  ],
  "grid-trading": [
    { term: /\bgrid (bot|trading|strategy)\b/, weight: 6 },
    { term: /\bgrid\b/, weight: 4 },
    { term: /\bladder\b/, weight: 3 },
    { term: /\brange trading\b/, weight: 3 },
    { term: /\bbuy low\b|\bsell high\b/, weight: 2 },
    { term: /\bdca\b|\bdollar[- ]cost\b/, weight: 2 },
    { term: /\bmarket making\b|\bmarket maker\b/, weight: 2 },
    { term: /\blimit order\w*/, weight: 2 },
  ],
  "yield-optimisation": [
    { term: /\byield (optimi|aggregat|farm|router)\w*/, weight: 6 },
    { term: /\bauto[- ]?compound\w*/, weight: 4 },
    { term: /\bapy\b|\bapr\b/, weight: 2 },
    { term: /\bbest (rate|yield|return)\b/, weight: 3 },
    { term: /\bvault\b/, weight: 2 },
    { term: /\bstablecoin\b/, weight: 2 },
    { term: /\blending\b|\bsupply\b|\bdeposit\b/, weight: 1 },
    { term: /\bidle (capital|funds|assets)\b/, weight: 3 },
  ],
  "health-factor": [
    { term: /\bhealth factor\b/, weight: 6 },
    { term: /\bliquidation (protection|defense|defence|guard)\b/, weight: 6 },
    { term: /\banti[- ]liquidation\b/, weight: 6 },
    { term: /\bcollateral (management|monitor|top[- ]?up)\b/, weight: 4 },
    { term: /\bdeleverage\b/, weight: 3 },
    { term: /\bloan (monitor|protect)\w*/, weight: 3 },
    { term: /\bborrow\w*/, weight: 2 },
    { term: /\bliquidat\w*/, weight: 2 },
  ],
};

const PROTOCOL_SIGNALS: { term: RegExp; protocol: Protocol }[] = [
  { term: /\bpancake\w*|\bcake\b/, protocol: "pancakeswap-v3" },
  { term: /\bvenus\b|\bxvs\b|\bvtoken\b/, protocol: "venus" },
  { term: /\blista\b|\bslisbnb\b/, protocol: "lista" },
  { term: /\baave\b/, protocol: "aave-v3" },
];

export type Classification = {
  category: AgentCategoryOrUncategorised;
  confidence: number;
  protocols: Protocol[];
};

/**
 * Minimum share of total signal the winner needs.
 *
 * Below this the text matched several categories about equally, which means we
 * genuinely cannot tell. Forcing a guess would put an agent in an arena where
 * it does not belong, and a wrong category is worse than an honest gap: a user
 * hiring from the health-factor arena expects a health-factor agent.
 */
const MIN_SHARE = 0.45;

/** Minimum absolute evidence, so one weak keyword is not enough. */
const MIN_SCORE = 3;

export function classify(reg: RegistrationText): Classification {
  const haystack = [reg.name, reg.description, ...(reg.tags ?? [])]
    .join(" ")
    .toLowerCase();

  const protocols = PROTOCOL_SIGNALS.filter((p) => p.term.test(haystack)).map(
    (p) => p.protocol,
  );

  const scores = (Object.keys(SIGNALS) as AgentCategory[]).map((category) => {
    let score = 0;
    for (const { term, weight } of SIGNALS[category]) {
      if (term.test(haystack)) score += weight;
    }
    return { category, score };
  });

  scores.sort((a, b) => b.score - a.score);

  const top = scores[0];
  const total = scores.reduce((sum, s) => sum + s.score, 0);

  if (!top || top.score < MIN_SCORE || total === 0) {
    return { category: "uncategorised", confidence: 0, protocols };
  }

  const share = top.score / total;
  if (share < MIN_SHARE) {
    // Matched several categories about equally — we cannot tell.
    return { category: "uncategorised", confidence: Number(share.toFixed(2)), protocols };
  }

  // Confidence blends share-of-signal with absolute evidence, so a single
  // decisive keyword does not read as certainty on its own.
  const evidence = Math.min(1, top.score / 8);
  const confidence = Number((share * 0.6 + evidence * 0.4).toFixed(2));

  return { category: top.category, confidence, protocols };
}

/** Distribution across a batch, for the report docs/10 asks for. */
export function classificationDistribution(
  results: Classification[],
): Record<AgentCategoryOrUncategorised, number> {
  const counts: Record<string, number> = {
    rebalancing: 0,
    "grid-trading": 0,
    "yield-optimisation": 0,
    "health-factor": 0,
    uncategorised: 0,
  };
  for (const r of results) counts[r.category] = (counts[r.category] ?? 0) + 1;
  return counts as Record<AgentCategoryOrUncategorised, number>;
}
