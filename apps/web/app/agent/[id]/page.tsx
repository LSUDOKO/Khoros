/**
 * Agent profile. From docs/01-PRODUCT_SPEC.md step 4.
 *
 * "Every numeric claim on this page resolves to an external verifier in one
 * click." That is why every hash, address and agent id here is a VerifyLink.
 *
 * Layout is the 62/38 split from docs/08: narrative and track record left,
 * identity and permissions right, right column sticky. Below 900px it becomes
 * one column with identity FIRST, because on mobile "is this thing real"
 * precedes "how did it perform".
 *
 * All eleven artifacts from docs/03 are rendered here or reachable from here,
 * identically for every category — the copy differs, the structure never does.
 */

import { CATEGORY_DEFINITIONS, categoryDefinition } from "@khoros/core";
import type { AgentCategory, AgentCategoryOrUncategorised } from "@khoros/core";
import { EmptyState, Panel, PermissionList, Sparkline, TrustBar, VerifyLink } from "@khoros/ui";
import { notFound } from "next/navigation";

import { InterventionLog } from "@/components/InterventionLog";
import { MetricGrid } from "@/components/MetricGrid";
import { ReviewList } from "@/components/ReviewList";
import { buildSessionScope } from "@/lib/altana/sessions";
import {
  PREVIEW_TARGETS,
  PREVIEW_TOKEN,
  TOKEN_META,
} from "@/lib/chain/addresses";
import { getAgent, getAgentInterventions, getAgentReviews } from "@/lib/db";

export const revalidate = 60;

/** Uncategorised agents still need labels for the six slots. */
function definitionFor(category: AgentCategoryOrUncategorised) {
  if (category === "uncategorised") {
    return { ...CATEGORY_DEFINITIONS.rebalancing, label: "Uncategorised", protocols: [] };
  }
  return categoryDefinition(category);
}

export async function generateMetadata({
  params,
}: {
  params: { id: string };
}): Promise<{ title: string; description: string }> {
  const agent = await getAgent(BigInt(params.id)).catch(() => undefined);
  if (!agent) return { title: "Agent not found — Khoros", description: "" };
  return { title: `${agent.name} — Khoros`, description: agent.description };
}

export default async function AgentProfile({
  params,
}: {
  params: { id: string };
}): Promise<React.ReactElement> {
  let agentId: bigint;
  try {
    agentId = BigInt(params.id);
  } catch {
    notFound();
  }

  const agent = await getAgent(agentId);
  if (!agent) {
    return (
      <div className="site-shell">
        <div className="page-head">
          <h1 className="khoros-title">Agent not found</h1>
        </div>
        <EmptyState
          message="No agent with that id is indexed here. It may not be registered on BNB Smart Chain, or the indexer may not have reached it yet."
          action={
            <a className="btn-secondary" href="/arena">
              Browse the arena
            </a>
          }
        />
      </div>
    );
  }

  const [reviews, interventions] = await Promise.all([
    getAgentReviews(agentId, { pruned: true }),
    getAgentInterventions(agentId),
  ]);

  const definition = definitionFor(agent.category);
  const isCategorised = agent.category !== "uncategorised";

  // The scope this agent would request. Rendered from the same builder the
  // hire flow uses, so the preview here cannot drift from what gets granted.
  let previewScope: ReturnType<typeof buildSessionScope> | undefined;
  if (isCategorised) {
    try {
      previewScope = buildSessionScope({
        category: agent.category as AgentCategory,
        targets: PREVIEW_TARGETS,
        spendToken: PREVIEW_TOKEN,
        spendLimit: 100_000_000_000_000_000_000n,
      });
    } catch {
      previewScope = undefined;
    }
  }

  return (
    <div className="site-shell">
      <div className="page-head">
        <h1 className="khoros-title">{agent.name}</h1>
        <p className="lede">{definition.label}</p>
      </div>

      {agent.seeded ? (
        <div className="notice" data-tone="verified">
          <p>
            <strong>This is a curated listing.</strong> Khoros added it by hand
            so each category has agents to compare during evaluation, rather
            than being discovered automatically from the registry.{" "}
            {agent.seedNote ?? ""}
          </p>
        </div>
      ) : null}

      <div className="profile-grid">
        {/* ---------------- Left: narrative and track record ---------------- */}
        <div className="profile-main">
          {/* Artifact 1 — plain-language description */}
          <section>
            <h2 className="khoros-section">What it does</h2>
            <p className="khoros-prose">
              {agent.description || definition.description}
            </p>
          </section>

          {/* Artifact 4 — the six headline metrics */}
          <section>
            <h2 className="khoros-section">Track record</h2>
            <MetricGrid performance={agent.performance} definition={definition} />

            {/* Artifact 5 — performance chart */}
            <div style={{ marginTop: 24 }}>
              <Sparkline
                points={agent.performance.sparkline}
                label={`${agent.name} performance over the last ${agent.performance.window}`}
                height={64}
              />
              <p className="khoros-label" style={{ marginTop: 8 }}>
                {agent.performance.sparkline.length > 0
                  ? `Performance over the last ${agent.performance.window}. Above the line is gain, below is loss.`
                  : "No performance history recorded yet. This agent has not run through Khoros."}
              </p>
            </div>
          </section>

          {/* Artifact 2 — strategy logic, expandable */}
          <section>
            <h2 className="khoros-section">How the strategy works</h2>
            <details className="khoros-prose">
              <summary className="khoros-label" style={{ cursor: "pointer" }}>
                Read the strategy logic
              </summary>
              <p>{definition.strategy}</p>
              {/* Artifact 3 — the trigger, stated precisely */}
              <h3 className="khoros-label" style={{ marginBottom: 4 }}>
                When it acts
              </h3>
              <p>{definition.trigger}</p>
            </details>
          </section>

          {/* Artifact 6 — intervention log, every entry linked to BscScan */}
          <section>
            <h2 className="khoros-section">Intervention log</h2>
            <InterventionLog rows={interventions} />
          </section>

          {/* Reviews, each showing the settled payment behind it */}
          <section>
            <h2 className="khoros-section">Reviews</h2>
            <ReviewList reviews={reviews} trust={agent.trust} />
          </section>
        </div>

        {/* ---------------- Right: identity and permissions ---------------- */}
        <aside className="profile-aside">
          <Panel title="Identity">
            <dl className="kv">
              <dt className="khoros-label">Trust score</dt>
              <dd>
                <TrustBar trust={agent.trust} />
              </dd>

              <dt className="khoros-label">ERC-8004 agent id</dt>
              <dd className="khoros-data">
                <VerifyLink kind="8004scan" value={agent.agentId.toString()} target="agent">
                  {agent.agentId.toString()}
                </VerifyLink>
              </dd>

              <dt className="khoros-label">Owner</dt>
              <dd className="khoros-data">
                <VerifyLink
                  kind="bscscan"
                  value={agent.owner}
                  target="address"
                  chainId={56}
                />
              </dd>

              <dt className="khoros-label">Protocols</dt>
              <dd className="khoros-data">
                {agent.protocols.length > 0 ? agent.protocols.join(", ") : "—"}
              </dd>

              {agent.supportedTrust.length > 0 && (
                <>
                  <dt className="khoros-label">Trust models</dt>
                  <dd className="khoros-data">
                    {agent.supportedTrust.map((t) => (
                      <span key={t} className="badge">
                        {t}
                      </span>
                    ))}
                  </dd>
                </>
              )}
            </dl>
          </Panel>

          {/* Artifact 7 — the session scope manifest, shown BEFORE hiring */}
          <Panel title="What it would be allowed to do" emphasis>
            {previewScope ? (
              <>
                <PermissionList
                  scope={previewScope}
                  tokens={TOKEN_META}
                  denied={definition.scope.denied}
                />
                <p className="khoros-label" style={{ marginTop: 16 }}>
                  Exact limits are yours to set in the hire form. Nothing is
                  granted until you sign.
                </p>
              </>
            ) : (
              <p className="khoros-label">
                This agent has no category classification yet, so we cannot state
                a session scope for it. Hiring is disabled until it is
                classified — we will not grant permissions we cannot describe.
              </p>
            )}
          </Panel>

          {/* Artifact 8 — PACE policy constraints */}
          <Panel title="Checked before every action">
            <ul className="khoros-permission-lines">
              {definition.constraints.map((c) => (
                <li key={c.id} className="khoros-permission-line khoros-label">
                  {c.description}
                </li>
              ))}
            </ul>
          </Panel>

          {isCategorised ? (
            <a className="btn-primary" href={`/hire/${agent.agentId}`}>
              Hire this agent
            </a>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
