/**
 * Intent parsing. From docs/01-PRODUCT_SPEC.md and docs/02-ARCHITECTURE.md.
 *
 * "Start with a deterministic keyword-plus-schema matcher so the demo never
 * depends on an external model being up, and layer an LLM call behind it for
 * free-form text. The deterministic path must handle all four seed chips
 * perfectly."
 *
 * So this module is the deterministic matcher, and it is the ONLY path the four
 * seed chips take. An LLM path can sit behind it for genuinely free-form text,
 * but it is never on the critical path for the journey a judge walks.
 *
 * Design note: when confidence is low we return ALL FOUR categories rather than
 * guessing. docs/01 is explicit — "an honest 'here's everything, pick a
 * category' beats a confident mismatch."
 */

import type { AgentCategory, ParsedIntent, ParsedIntentParams, Protocol } from "@khoros/core";
import { AGENT_CATEGORIES, CATEGORY_DEFINITIONS } from "@khoros/core";

/**
 * Weighted signals per category. Weights are deliberate: a phrase that only
 * ever appears in one category's context scores higher than a word that could
 * belong to several.
 */
const SIGNALS: Record<AgentCategory, { term: RegExp; weight: number }[]> = {
  rebalancing: [
    { term: /\bin range\b|\bout of range\b|\brange\b/, weight: 3 },
    { term: /\brebalanc\w*/, weight: 4 },
    { term: /\bconcentrated liquidity\b|\bclmm\b/, weight: 4 },
    { term: /\bliquidity position\b|\blp position\b|\bmy lp\b/, weight: 3 },
    { term: /\bposition\b/, weight: 1 },
    { term: /\bfee(s)? apr\b|\bearn(ing)? fees\b/, weight: 2 },
    { term: /\bimpermanent loss\b|\bil\b/, weight: 2 },
  ],
  "grid-trading": [
    { term: /\bgrid\b/, weight: 5 },
    { term: /\bladder\b/, weight: 3 },
    { term: /\bbuy low\b.*\bsell high\b/, weight: 3 },
    { term: /\bbetween \$?\d+(\.\d+)? and \$?\d+/, weight: 3 },
    { term: /\brange trad\w*/, weight: 3 },
    { term: /\bdca\b|\bdollar cost\b/, weight: 2 },
    { term: /\bsideways\b|\bchoppy\b|\bvolatil\w*/, weight: 1 },
  ],
  "yield-optimisation": [
    { term: /\byield\b/, weight: 4 },
    { term: /\bapy\b|\bapr\b/, weight: 2 },
    { term: /\bbest (rate|return|yield)\b/, weight: 3 },
    { term: /\bstablecoin(s)?\b|\busdt\b|\busdc\b|\bbusd\b/, weight: 2 },
    { term: /\bidle\b|\bsitting\b|\bearn more\b/, weight: 2 },
    { term: /\bfarm\w*/, weight: 2 },
    { term: /\bmove\b.*\bbest\b/, weight: 2 },
    { term: /\blend\w*|\bdeposit\b|\bsupply\b/, weight: 1 },
  ],
  "health-factor": [
    { term: /\bhealth factor\b|\bhf\b/, weight: 5 },
    { term: /\bliquidat\w*/, weight: 4 },
    { term: /\bborrow\w*|\bloan\b|\bdebt\b/, weight: 3 },
    { term: /\bcollateral\b/, weight: 3 },
    { term: /\bprotect\b|\bsafe\b|\bmargin call\b/, weight: 2 },
    { term: /\bdeleverage\b|\bleverage\b/, weight: 2 },
  ],
};

const PROTOCOL_TERMS: { term: RegExp; protocol: Protocol }[] = [
  { term: /\bpancake\w*|\bcake\b|\bpcs\b/, protocol: "pancakeswap-v3" },
  { term: /\bvenus\b|\bxvs\b/, protocol: "venus" },
  { term: /\blista\b|\bslisbnb\b/, protocol: "lista" },
  { term: /\baave\b/, protocol: "aave-v3" },
];

/** Extract whatever structured parameters the text actually contains. */
export function extractParams(text: string): ParsedIntentParams {
  const lower = text.toLowerCase();
  const params: ParsedIntentParams = {};

  // Pair, e.g. "CAKE/USDT" or "BNB-USDT".
  const pair = /\b([A-Z]{2,10})\s*[/-]\s*([A-Z]{2,10})\b/.exec(text);
  if (pair) params.pair = `${pair[1]}/${pair[2]}`;

  // Price range, e.g. "between $500 and $700".
  const range = /between\s+\$?([\d,]+(?:\.\d+)?)\s+and\s+\$?([\d,]+(?:\.\d+)?)/.exec(
    lower,
  );
  if (range) {
    const min = Number(range[1]!.replace(/,/g, ""));
    const max = Number(range[2]!.replace(/,/g, ""));
    if (Number.isFinite(min) && Number.isFinite(max) && min < max) {
      params.priceRange = { min, max };
    }
  }

  // Health factor floor, e.g. "above 1.2" or "health factor 1.15".
  const hf = /(?:health factor|hf)\s*(?:of|above|below|at|to)?\s*([\d.]+)/.exec(lower);
  if (hf) {
    const value = Number(hf[1]);
    if (Number.isFinite(value) && value > 0 && value < 10) {
      params.healthFactorFloor = value;
    }
  }

  // Capital, e.g. "$5,000" or "5000 usdt" or "10k".
  const capital =
    /\$\s*([\d,]+(?:\.\d+)?)\s*(k|m)?\b/.exec(lower) ??
    /\b([\d,]+(?:\.\d+)?)\s*(k|m)?\s*(?:usdt|usdc|busd|dollars?)\b/.exec(lower);
  if (capital) {
    let value = Number(capital[1]!.replace(/,/g, ""));
    if (capital[2] === "k") value *= 1_000;
    if (capital[2] === "m") value *= 1_000_000;
    // A price range mention is not a capital figure.
    if (Number.isFinite(value) && value > 0 && !range) params.capitalUsd = value;
  }

  const protocols = PROTOCOL_TERMS.filter((p) => p.term.test(lower)).map(
    (p) => p.protocol,
  );
  if (protocols.length > 0) params.protocols = protocols;

  return params;
}

/** Restate the understood intent in plain language, for confirmation. */
function restate(categories: AgentCategory[], params: ParsedIntentParams): string {
  if (categories.length === 0) {
    return "Showing every category — pick the one that matches your goal.";
  }

  const phrase: Record<AgentCategory, string> = {
    rebalancing:
      "keep a concentrated liquidity position in range on PancakeSwap V3",
    "grid-trading": "run a grid of buy and sell orders across a price range",
    "yield-optimisation":
      "move capital to the best available yield across BNB Chain protocols",
    "health-factor":
      "watch a borrow position and act before it can be liquidated",
  };

  const parts = categories.map((c) => phrase[c]);
  const joined =
    parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;

  const detail: string[] = [];
  if (params.pair) detail.push(`on ${params.pair}`);
  if (params.priceRange) {
    detail.push(`between $${params.priceRange.min} and $${params.priceRange.max}`);
  }
  if (params.healthFactorFloor) {
    detail.push(`with a health factor floor of ${params.healthFactorFloor}`);
  }
  if (params.capitalUsd) {
    detail.push(`with about $${params.capitalUsd.toLocaleString("en-US")}`);
  }

  const suffix = detail.length > 0 ? ` ${detail.join(", ")}` : "";
  return `Looking for agents that ${joined}${suffix}.`;
}

/** Confidence below this shows all four categories rather than guessing. */
export const LOW_CONFIDENCE = 0.4;

export function parseIntent(text: string): ParsedIntent {
  const lower = text.toLowerCase().trim();

  if (lower.length === 0) {
    return {
      categories: [...AGENT_CATEGORIES],
      params: {},
      confidence: 0,
      restated: restate([], {}),
    };
  }

  // Exact seed-chip match short-circuits everything. These four must be
  // perfect, so they never depend on scoring thresholds.
  for (const category of AGENT_CATEGORIES) {
    if (CATEGORY_DEFINITIONS[category].seedChip.toLowerCase() === lower) {
      const params = extractParams(text);
      return {
        categories: [category],
        params,
        confidence: 1,
        restated: restate([category], params),
      };
    }
  }

  const scores = AGENT_CATEGORIES.map((category) => {
    let score = 0;
    for (const { term, weight } of SIGNALS[category]) {
      if (term.test(lower)) score += weight;
    }
    return { category, score };
  }).sort((a, b) => b.score - a.score);

  const top = scores[0]!;
  const params = extractParams(text);

  if (top.score === 0) {
    // Nothing matched. Show everything rather than guessing wrong.
    return {
      categories: [...AGENT_CATEGORIES],
      params,
      confidence: 0,
      restated: restate([], params),
    };
  }

  const total = scores.reduce((sum, s) => sum + s.score, 0);

  // Confidence blends share-of-signal with absolute evidence, so a single weak
  // keyword does not read as certainty just because nothing else matched.
  const share = top.score / total;
  const evidence = Math.min(1, top.score / 6);
  const confidence = Number((share * 0.6 + evidence * 0.4).toFixed(2));

  // A second category counts as intended when it is genuinely close to the
  // top — that is what routes a multi-category intent to the coordinator.
  const categories = scores
    .filter((s) => s.score > 0 && s.score >= top.score * 0.6)
    .map((s) => s.category);

  if (confidence < LOW_CONFIDENCE) {
    return {
      categories: [...AGENT_CATEGORIES],
      params,
      confidence,
      restated: restate([], params),
    };
  }

  return {
    categories,
    params,
    confidence,
    restated: restate(categories, params),
  };
}

/** True when the intent spans categories and should offer the coordinator. */
export function isMultiCategory(intent: ParsedIntent): boolean {
  return intent.confidence >= LOW_CONFIDENCE && intent.categories.length > 1;
}
