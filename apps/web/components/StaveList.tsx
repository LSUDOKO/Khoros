/**
 * A list of staves rendered as a real semantic table.
 *
 * docs/08-DESIGN_SYSTEM.md accessibility floor: "the arena is a real semantic
 * <table> styled as staves — screen readers get a comparison table, sighted
 * users get a score."
 */

import type { AgentCategoryOrUncategorised } from "@khoros/core";
import { CATEGORY_DEFINITIONS, METRIC_SLOTS, categoryDefinition } from "@khoros/core";
import { Stave } from "@khoros/ui";

import type { SeededAgentRow } from "@/lib/db";

/**
 * An agent we could not classify still needs a definition to render its six
 * slots. Rebalancing's labels are the closest generic fit, and the category
 * name shown on the stave comes from the agent's own record, so nothing claims
 * the agent IS a rebalancer.
 */
function definitionFor(category: AgentCategoryOrUncategorised) {
  if (category === "uncategorised") {
    return {
      ...CATEGORY_DEFINITIONS.rebalancing,
      label: "Uncategorised",
      protocols: [],
    };
  }
  return categoryDefinition(category);
}

export function StaveList({
  agents,
  category,
}: {
  agents: SeededAgentRow[];
  category?: AgentCategoryOrUncategorised;
}): React.ReactElement {
  const labels = definitionFor(category ?? "uncategorised").metrics;

  return (
    <div className="scroll-x">
      <table className="khoros-arena">
        <caption className="khoros-sr-only">
          Agents ranked by trust score, with six performance metrics each.
        </caption>
        <thead className="khoros-arena-head">
          <tr>
            <th scope="col">Agent</th>
            {METRIC_SLOTS.map((slot) => (
              <th key={slot} scope="col">
                {labels[slot]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {agents.map((a) => (
            <Stave
              key={a.agentId.toString()}
              agentId={a.agentId}
              name={a.name}
              definition={definitionFor(a.category)}
              trust={a.trust}
              performance={a.performance}
              paymentBackedReviews={a.trust.reviewsCounted}
              href={`/agent/${a.agentId}`}
              trailing={
                a.seeded ? (
                  <span className="khoros-label seeded-tag" title={a.seedNote}>
                    Curated listing
                  </span>
                ) : undefined
              }
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
