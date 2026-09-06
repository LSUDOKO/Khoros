/**
 * One category in depth. From docs/01-PRODUCT_SPEC.md.
 *
 * The prune toggle lives here, and flipping it visibly re-ranks the list. That
 * reorder is the thirty-second surprise for a judge and the demonstration of
 * the product's central claim.
 */

import { AGENT_CATEGORIES, categoryDefinition } from "@khoros/core";
import type { AgentCategory } from "@khoros/core";
import { notFound } from "next/navigation";

import { CategoryArena } from "@/components/CategoryArena";
import { getPruningSummary, getRankedAgents } from "@/lib/db";

export const revalidate = 60;

function isCategory(value: string): value is AgentCategory {
  return (AGENT_CATEGORIES as readonly string[]).includes(value);
}

export function generateStaticParams(): { category: string }[] {
  return AGENT_CATEGORIES.map((category) => ({ category }));
}

export async function generateMetadata({
  params,
}: {
  params: { category: string };
}): Promise<{ title: string; description: string }> {
  if (!isCategory(params.category)) {
    return { title: "Not found — Khoros", description: "" };
  }
  const d = categoryDefinition(params.category);
  return {
    title: `${d.label} agents — Khoros`,
    description: d.description,
  };
}

export default async function CategoryPage({
  params,
}: {
  params: { category: string };
}): Promise<React.ReactElement> {
  if (!isCategory(params.category)) notFound();

  const category = params.category;
  const definition = categoryDefinition(category);

  // Both orderings are fetched server-side so the toggle re-ranks instantly,
  // with no request in the middle of the one animated moment in the product.
  const [pruned, unfiltered, summary] = await Promise.all([
    getRankedAgents({ category, pruned: true, limit: 25 }),
    getRankedAgents({ category, pruned: false, limit: 25 }),
    getPruningSummary(category),
  ]);

  return (
    <div className="site-shell">
      <div className="page-head">
        <h1 className="khoros-title">{definition.label}</h1>
        <p className="lede">{definition.description}</p>
      </div>

      <CategoryArena
        category={category}
        prunedAgents={pruned.agents}
        unfilteredAgents={unfiltered.agents}
        summary={{
          enabled: true,
          reviewsCounted: summary.counted,
          reviewsDiscarded: summary.discarded,
          reasons: summary.reasons,
        }}
        freshness={pruned.freshness}
        unavailable={pruned.unavailable}
      />

      <section className="section">
        <h2 className="khoros-section">How these agents work</h2>
        <div className="khoros-prose">
          <p>{definition.strategy}</p>
          <h3 className="khoros-label" style={{ marginBottom: 4 }}>
            When it acts
          </h3>
          <p>{definition.trigger}</p>
          <h3 className="khoros-label" style={{ marginBottom: 4 }}>
            What it is never allowed to do
          </h3>
          <ul>
            {definition.scope.denied.map((d) => (
              <li key={d.name}>{d.reason}</li>
            ))}
          </ul>
          <h3 className="khoros-label" style={{ marginBottom: 4 }}>
            Checked before every action
          </h3>
          <ul>
            {definition.constraints.map((c) => (
              <li key={c.id}>{c.description}</li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
