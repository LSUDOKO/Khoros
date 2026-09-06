/**
 * PermissionList — renders describeScope() output and nothing else.
 * From docs/08-DESIGN_SYSTEM.md.
 *
 * "PermissionList renders describeScope() output, never takes free text."
 *
 * That constraint is enforced in the type: this component accepts a
 * SessionScope, not strings. There is deliberately no `children` and no way to
 * pass prose, because the moment copy can be written by hand it drifts from the
 * scope actually registered on-chain, and then the UI lies about what the agent
 * may do.
 */

import type { SessionScope } from "@khoros/core";
import { describeScope, type TokenMeta } from "@khoros/core";

export type PermissionListProps = {
  scope: SessionScope;
  tokens?: Record<string, TokenMeta>;
  /** Denied capabilities from the category manifest, shown as reassurance. */
  denied?: { name: string; reason: string }[];
  now?: bigint;
};

export function PermissionList({
  scope,
  tokens,
  denied = [],
  now,
}: PermissionListProps): React.ReactElement {
  const lines = describeScope(scope, { tokens, now });

  return (
    <div className="khoros-permissions">
      <ul className="khoros-permission-lines">
        {lines.map((line, i) => (
          <li key={i} className="khoros-permission-line">
            {line}
          </li>
        ))}
      </ul>

      {denied.length > 0 && (
        <ul className="khoros-permission-denied">
          {denied.map((d) => (
            <li key={d.name} className="khoros-permission-line">
              <span className="khoros-madder">{d.reason}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
