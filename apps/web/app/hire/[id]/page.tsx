/**
 * Hire flow. From docs/01-PRODUCT_SPEC.md step 5.
 *
 * "Four panels on one page, not a wizard with hidden steps": capital,
 * boundaries, permissions preview, confirm. Everything visible at once, because
 * a user granting spending authority should be able to see every term without
 * clicking through.
 *
 * The permissions preview is rendered from the SAME scope object that gets
 * passed to grantSession. That is the whole point — write the copy separately
 * and the two drift, and then the UI lies about what the agent may do.
 */

import { categoryDefinition } from "@khoros/core";
import type { AgentCategory } from "@khoros/core";
import { EmptyState } from "@khoros/ui";

import { HireForm } from "@/components/HireForm";
import { getAgent } from "@/lib/db";

export const revalidate = 60;

export async function generateMetadata({
  params,
}: {
  params: { id: string };
}): Promise<{ title: string }> {
  const agent = await getAgent(BigInt(params.id)).catch(() => undefined);
  return { title: agent ? `Hire ${agent.name} — Khoros` : "Hire — Khoros" };
}

export default async function HirePage({
  params,
}: {
  params: { id: string };
}): Promise<React.ReactElement> {
  let agentId: bigint;
  try {
    agentId = BigInt(params.id);
  } catch {
    return (
      <div className="site-shell">
        <div className="page-head">
          <h1 className="khoros-title">Agent not found</h1>
        </div>
        <EmptyState message="That agent id is not valid." />
      </div>
    );
  }

  const agent = await getAgent(agentId);

  if (!agent) {
    return (
      <div className="site-shell">
        <div className="page-head">
          <h1 className="khoros-title">Agent not found</h1>
        </div>
        <EmptyState
          message="No agent with that id is indexed here, so there is nothing to hire."
          action={
            <a className="btn-secondary" href="/arena">
              Browse the arena
            </a>
          }
        />
      </div>
    );
  }

  // An agent we could not classify has no session scope we can state, and we do
  // not grant permissions we cannot describe in plain language.
  if (agent.category === "uncategorised") {
    return (
      <div className="site-shell">
        <div className="page-head">
          <h1 className="khoros-title">{agent.name}</h1>
        </div>
        <EmptyState
          message="This agent has no category classification yet, so we cannot state what a session for it would permit. Hiring stays disabled until it is classified — we will not ask you to grant permissions we cannot describe."
          action={
            <a className="btn-secondary" href={`/agent/${agent.agentId}`}>
              Back to the profile
            </a>
          }
        />
      </div>
    );
  }

  const category = agent.category as AgentCategory;
  const definition = categoryDefinition(category);

  return (
    <div className="site-shell">
      <div className="page-head">
        <h1 className="khoros-title">Hire {agent.name}</h1>
        <p className="lede">
          {definition.label}. Set your limits below — nothing is granted until
          you sign, and you can stop the agent at any time in one transaction.
        </p>
      </div>

      <HireForm
        agentId={agent.agentId.toString()}
        agentName={agent.name}
        category={category}
      />
    </div>
  );
}
