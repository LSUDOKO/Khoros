"use client";

/**
 * Stop an agent.
 *
 * docs/01: "The revoke button is always visible, never behind a menu, and never
 * requires confirmation beyond the wallet signature itself."
 *
 * docs/08 copy rule: the verb never changes between the action and its
 * confirmation. "Stop this agent" produces "Agent stopped".
 */

import type { Address } from "@khoros/core";
import { useState } from "react";

type State =
  | { kind: "idle" }
  | { kind: "revoking" }
  | { kind: "stopped"; tx?: string }
  | { kind: "error"; message: string };

export function RevokeButton({
  engagementId,
  sessionKey,
}: {
  engagementId: string;
  sessionKey: Address;
}): React.ReactElement {
  const [state, setState] = useState<State>({ kind: "idle" });

  async function revoke(): Promise<void> {
    setState({ kind: "revoking" });
    try {
      const res = await fetch("/api/revoke", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ engagementId, sessionKey }),
      });
      const body: unknown = await res.json();

      if (res.ok && typeof body === "object" && body !== null && "tx" in body) {
        setState({ kind: "stopped", tx: String((body as { tx: unknown }).tx) });
        return;
      }

      const message =
        typeof body === "object" && body !== null && "error" in body
          ? String((body as { error: unknown }).error)
          : "The agent could not be stopped.";
      setState({ kind: "error", message });
    } catch {
      setState({
        kind: "error",
        message:
          "Could not reach the revoke service. The session is unchanged — you can also revoke it directly in the Altana Explorer.",
      });
    }
  }

  if (state.kind === "stopped") {
    return <span className="khoros-madder khoros-label">Agent stopped</span>;
  }

  return (
    <div className="revoke-wrap">
      <button
        type="button"
        className="btn-danger"
        onClick={revoke}
        disabled={state.kind === "revoking"}
      >
        {state.kind === "revoking" ? "Stopping…" : "Stop this agent"}
      </button>
      {state.kind === "error" ? (
        <p className="khoros-label khoros-madder revoke-error">{state.message}</p>
      ) : null}
    </div>
  );
}
