/**
 * One category's slice of the arena.
 *
 * docs/08-DESIGN_SYSTEM.md: "Four sections, one per category, identical
 * structure and identical height allocation. If one category has fewer agents,
 * it shows an empty-state invitation at the same height rather than collapsing
 * — visual equality is part of how we demonstrate category equality."
 *
 * That rule is why this component exists at all: every category surface goes
 * through it, so none can accidentally render thinner than its siblings.
 */

import type { AgentCategory } from "@khoros/core";
import { categoryDefinition } from "@khoros/core";
import { EmptyState } from "@khoros/ui";

import { getRankedAgents } from "@/lib/db";

import { StaveList } from "./StaveList";

export async function ArenaSection({
  category,
  limit = 5,
  pruned = true,
}: {
  category: AgentCategory;
  limit?: number;
  pruned?: boolean;
}): Promise<React.ReactElement> {
  const definition = categoryDefinition(category);
  const { agents, unavailable } = await getRankedAgents({
    category,
    pruned,
    limit,
  });

  return (
    <section className="section arena-section" aria-labelledby={`arena-${category}`}>
      <div className="section-head">
        <h2 id={`arena-${category}`} className="khoros-title">
          {definition.label}
        </h2>
        <a href={`/arena/${category}`} className="khoros-label">
          See all {definition.label.toLowerCase()} agents
        </a>
      </div>

      <p className="khoros-prose" style={{ marginTop: 0 }}>
        {definition.description}
      </p>

      {unavailable ? (
        // Never fake rows. Say plainly that the data is not reachable.
        <EmptyState
          message="Agent rankings are temporarily unavailable — the indexer is not reachable from this deployment. Rankings return as soon as it reconnects; nothing here is cached or estimated."
          action={
            <a className="btn-secondary" href="/verify">
              How rankings are built
            </a>
          }
        />
      ) : agents.length === 0 ? (
        <EmptyState
          message={`No ${definition.label.toLowerCase()} agents have a payment-backed track record yet. Switch to unfiltered on the category page to see every registered agent, including those with no settled work behind them.`}
          action={
            <a className="btn-secondary" href={`/arena/${category}?pruned=false`}>
              Show unfiltered
            </a>
          }
        />
      ) : (
        <StaveList agents={agents} category={category} />
      )}
    </section>
  );
}
