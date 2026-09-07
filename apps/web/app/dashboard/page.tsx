/**
 * The control center. From docs/01-PRODUCT_SPEC.md step 6.
 *
 * "The revoke button is always visible, never behind a menu, and never requires
 * confirmation beyond the wallet signature itself."
 *
 * This is where the Altana track's user-facing control criterion lives: a user
 * can see exactly what their agent may do, and stop it, inside the product.
 */

import { categoryDefinition, CATEGORY_DEFINITIONS } from "@khoros/core";
import { EmptyState, Panel } from "@khoros/ui";

import { EngagementCard } from "@/components/EngagementCard";
import { getEngagements } from "@/lib/db";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Dashboard — Khoros",
  description: "Your active agents, what they may do, and how to stop them.",
};

export default async function Dashboard(): Promise<React.ReactElement> {
  const { rows, unavailable } = await getEngagements();

  return (
    <div className="site-shell">
      <div className="page-head">
        <h1 className="khoros-title">Your agents</h1>
        <p className="lede">
          Everything running on your behalf, what each one is permitted to do,
          and a one-transaction stop for any of them.
        </p>
      </div>

      {unavailable ? (
        <EmptyState
          message="Engagement records are temporarily unavailable — the database is not reachable from this deployment. Your on-chain sessions are unaffected: they live in the Altana KeyStore, not here, and can be revoked directly."
          action={
            <a
              className="btn-secondary"
              href="https://explorer.altana.network"
              target="_blank"
              rel="noopener noreferrer"
            >
              Open the Altana Explorer
            </a>
          }
        />
      ) : rows.length === 0 ? (
        <>
          <EmptyState
            message="No agents are working for you yet. Pick a goal and hire one — you set the spending cap and the expiry, and you can stop it at any time."
            action={
              <a className="btn-primary" href="/arena">
                Browse the arena
              </a>
            }
          />

          {/* Equal depth holds even in the empty state: all four categories are
              offered, not just whichever is most popular. */}
          <section className="section">
            <h2 className="khoros-section">Start with a goal</h2>
            <div className="chip-row">
              {Object.values(CATEGORY_DEFINITIONS).map((c) => (
                <a key={c.id} className="khoros-chip" href={`/arena/${c.id}`}>
                  {c.seedChip}
                </a>
              ))}
            </div>
          </section>
        </>
      ) : (
        <div className="engagement-stack">
          {rows.map((row) => (
            <EngagementCard
              key={row.id}
              engagement={row}
              categoryLabel={
                row.category === "uncategorised"
                  ? "Uncategorised"
                  : categoryDefinition(row.category).label
              }
            />
          ))}
        </div>
      )}

      <section className="section">
        <Panel title="Where these live">
          <p className="khoros-prose" style={{ marginTop: 0 }}>
            Every session is a key registered in the Altana KeyStore on BSC
            Testnet, with its call allowlist, spend cap and expiry enforced
            on-chain by your account contract rather than by this interface.
            Revoking one is a transaction, so it holds even if Khoros is down.
          </p>
          <p className="khoros-label">
            Verify any of it independently in the{" "}
            <a
              href="https://explorer.altana.network"
              target="_blank"
              rel="noopener noreferrer"
            >
              Altana Explorer
            </a>
            . Each session below links straight to its own record.
          </p>
        </Panel>
      </section>
    </div>
  );
}
