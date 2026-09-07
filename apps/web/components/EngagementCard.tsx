/**
 * One active engagement on the dashboard.
 *
 * docs/08: "Revoke is a persistent per-stave control, never in a menu."
 * docs/01: revoke "never requires confirmation beyond the wallet signature
 * itself" — so there is no are-you-sure dialog here by design.
 */

import { PermissionList, VerifyLink } from "@khoros/ui";
import type { SessionScope } from "@khoros/core";

import type { EngagementRow } from "@/lib/db";
import { TOKEN_META } from "@/lib/chain/addresses";

import { RevokeButton } from "./RevokeButton";

/**
 * The scope column is jsonb, so it arrives as `unknown`. Narrow it rather than
 * casting — a malformed row must render "unavailable", never crash the page or
 * silently describe the wrong permissions.
 */
function parseScope(value: unknown): SessionScope | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.calls) || !Array.isArray(v.selectors)) return undefined;
  if (!Array.isArray(v.spend)) return undefined;

  try {
    return {
      calls: v.calls as SessionScope["calls"],
      selectors: v.selectors as SessionScope["selectors"],
      // Base units are stored as strings in JSON, since JSON has no bigint.
      spend: (v.spend as { token: string; limit: string; periodSeconds: number }[]).map(
        (s) => ({
          token: s.token as SessionScope["spend"][number]["token"],
          limit: BigInt(s.limit),
          periodSeconds: s.periodSeconds,
        }),
      ),
      expiry: BigInt(String(v.expiry ?? "0")),
    };
  } catch {
    return undefined;
  }
}

function statusLabel(row: EngagementRow): { text: string; tone: string } {
  if (row.sessionStatus === "revoked") return { text: "Stopped", tone: "risk" };
  if (row.sessionStatus === "expired") return { text: "Expired", tone: "dim" };
  if (row.status === "active") return { text: "Running", tone: "live" };
  return { text: row.status, tone: "dim" };
}

export function EngagementCard({
  engagement,
  categoryLabel,
}: {
  engagement: EngagementRow;
  categoryLabel: string;
}): React.ReactElement {
  const scope = parseScope(engagement.scope);
  const status = statusLabel(engagement);
  const active = engagement.sessionStatus === "active";

  return (
    <article className="engagement">
      <header className="engagement-head">
        <div>
          <a className="khoros-agent-name" href={`/agent/${engagement.agentId}`}>
            {engagement.agentName}
          </a>
          <p className="khoros-label" style={{ margin: "4px 0 0" }}>
            {categoryLabel}
            <span aria-hidden="true"> · </span>
            <span data-tone={status.tone} className="engagement-status">
              {status.text}
            </span>
            {engagement.keystoreRegistered ? (
              <>
                <span aria-hidden="true"> · </span>
                <span className="khoros-brass">registered in the KeyStore</span>
              </>
            ) : null}
          </p>
        </div>

        {/* Always visible, never behind a menu. */}
        {active && engagement.sessionKey ? (
          <RevokeButton
            engagementId={engagement.id}
            sessionKey={engagement.sessionKey}
          />
        ) : null}
      </header>

      {scope ? (
        <div className="engagement-permissions">
          <PermissionList scope={scope} tokens={TOKEN_META} />
        </div>
      ) : (
        <p className="khoros-label">
          The stored scope for this session could not be read, so we will not
          describe what it permits. Check the KeyStore record directly.
        </p>
      )}

      <footer className="engagement-foot khoros-label">
        {engagement.grantTx ? (
          <span>
            Granted{" "}
            <VerifyLink kind="bscscan" value={engagement.grantTx} target="tx" chainId={97} />
          </span>
        ) : null}

        {engagement.sessionKey ? (
          <span>
            Session{" "}
            <VerifyLink
              kind="altana"
              value={engagement.sessionKey}
              target="session"
            />
          </span>
        ) : null}

        {engagement.revokeTx ? (
          <span className="khoros-madder">
            Stopped{" "}
            <VerifyLink kind="bscscan" value={engagement.revokeTx} target="tx" chainId={97} />
          </span>
        ) : null}

        <a href={`/dashboard/session/${engagement.sessionKey ?? engagement.id}`}>
          Live feed and full permissions
        </a>
      </footer>
    </article>
  );
}
