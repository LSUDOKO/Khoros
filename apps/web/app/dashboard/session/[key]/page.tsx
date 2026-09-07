/**
 * Session detail — exact permissions, live transaction feed, revoke.
 * From docs/01-PRODUCT_SPEC.md and the Altana checklist in docs/11.
 *
 * The Altana track wants the permissions preview to match the registered scope
 * byte for byte. It does, because both are rendered by describeScope() from the
 * stored scope object — the same object that was passed to grantSession.
 */

import { categoryDefinition } from "@khoros/core";
import { EmptyState, Panel, TelemetryFeed, VerifyLink } from "@khoros/ui";

import { EngagementCard } from "@/components/EngagementCard";
import { getEngagements, getEngagementTelemetry } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: { key: string };
}): Promise<{ title: string }> {
  return { title: `Session ${params.key.slice(0, 10)}… — Khoros` };
}

export default async function SessionDetail({
  params,
}: {
  params: { key: string };
}): Promise<React.ReactElement> {
  const { rows, unavailable } = await getEngagements();
  const engagement = rows.find(
    (r) => r.sessionKey === params.key || r.id === params.key,
  );

  if (unavailable || !engagement) {
    return (
      <div className="site-shell">
        <div className="page-head">
          <h1 className="khoros-title">Session</h1>
          <p className="khoros-data">{params.key}</p>
        </div>
        <EmptyState
          message={
            unavailable
              ? "Session records are temporarily unavailable here. The session itself is unaffected — it lives in the Altana KeyStore, not in this database."
              : "No session with that key is recorded here. It may belong to another account, or it may never have been granted through Khoros."
          }
          action={
            <a
              className="btn-secondary"
              href={`https://explorer.altana.network/session/${params.key}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Look it up in the Altana Explorer
            </a>
          }
        />
      </div>
    );
  }

  const telemetry = await getEngagementTelemetry(engagement.id);
  const categoryLabel =
    engagement.category === "uncategorised"
      ? "Uncategorised"
      : categoryDefinition(engagement.category).label;

  return (
    <div className="site-shell">
      <div className="page-head">
        <h1 className="khoros-title">{engagement.agentName}</h1>
        <p className="lede">
          {categoryLabel} · session{" "}
          <span className="khoros-data">{params.key.slice(0, 14)}…</span>
        </p>
      </div>

      <div className="engagement-stack">
        <EngagementCard engagement={engagement} categoryLabel={categoryLabel} />
      </div>

      <section className="section">
        <h2 className="khoros-section">Activity</h2>
        {/*
          Blocked actions render at the same weight as executed ones. A block is
          evidence the safety layer works, not an error to hide.
        */}
        <TelemetryFeed
          events={telemetry.map((t) =>
            t.kind === "blocked"
              ? {
                  kind: "blocked" as const,
                  engagementId: engagement.id,
                  intentHash: "0x" as const,
                  reason: t.detail,
                  failedInvariant: "",
                  observed: "",
                  expected: "",
                  at: t.at,
                }
              : t.kind === "triggered"
                ? {
                    kind: "triggered" as const,
                    engagementId: engagement.id,
                    trigger: t.detail,
                    at: t.at,
                  }
                : {
                    kind: "executed" as const,
                    engagementId: engagement.id,
                    intentHash: "0x" as const,
                    target: "0x" as const,
                    selector: "0x" as const,
                    tx: t.tx ?? ("0x" as const),
                    gasUsed: 0n,
                    latencyMs: t.latencyMs ?? 0,
                    stateDelta: {},
                    at: t.at,
                  },
          )}
          chainId={97}
        />
      </section>

      <section className="section">
        <Panel title="Verify this independently">
          <ul className="khoros-permission-lines khoros-label">
            {engagement.grantTx ? (
              <li>
                The grant transaction:{" "}
                <VerifyLink
                  kind="bscscan"
                  value={engagement.grantTx}
                  target="tx"
                  chainId={97}
                />
              </li>
            ) : null}
            {engagement.sessionKey ? (
              <li>
                The KeyStore record:{" "}
                <VerifyLink
                  kind="altana"
                  value={engagement.sessionKey}
                  target="session"
                />
              </li>
            ) : null}
            <li>
              The agent&rsquo;s identity:{" "}
              <VerifyLink
                kind="8004scan"
                value={engagement.agentId.toString()}
                target="agent"
              >
                agent #{engagement.agentId.toString()}
              </VerifyLink>
            </li>
          </ul>
        </Panel>
      </section>
    </div>
  );
}
