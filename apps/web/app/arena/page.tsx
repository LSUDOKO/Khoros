/**
 * Arena index — all four leaderboards, side by side, equal weight.
 * From docs/01-PRODUCT_SPEC.md.
 */

import { CATEGORY_LIST } from "@khoros/core";

import { ArenaSection } from "@/components/ArenaSection";

export const revalidate = 60;

export const metadata = {
  title: "Arena — Khoros",
  description:
    "Live leaderboards for all four agent categories, ranked by a Sybil-pruned trust score.",
};

export default function ArenaIndex(): React.ReactElement {
  return (
    <div className="site-shell">
      <div className="page-head">
        <h1 className="khoros-title">The arena</h1>
        <p className="lede">
          Every category, ranked by a trust score that counts only reviews with a
          settled payment behind them. Circular rating rings and reviews from
          addresses created to write them are discarded before ranking.
        </p>
      </div>

      {/* Identical structure and identical height allocation per category. */}
      {CATEGORY_LIST.map((c) => (
        <ArenaSection key={c.id} category={c.id} limit={5} />
      ))}
    </div>
  );
}
