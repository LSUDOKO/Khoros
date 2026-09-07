"use client";

/**
 * The four hire panels. From docs/01-PRODUCT_SPEC.md step 5.
 *
 * The permissions preview updates live from the same buildSessionScope() the
 * grant uses, so what the user reads is derived from the object that reaches
 * the chain rather than written alongside it.
 *
 * Boundaries are per-category and come from the category definition's defaults,
 * which is how all four categories get the same depth of configurability
 * without four hand-written forms drifting apart.
 */

import type { AgentCategory, CategoryBoundaries, SessionScope } from "@khoros/core";
import { categoryDefinition } from "@khoros/core";
import { Panel, PermissionList } from "@khoros/ui";
import { useMemo, useState } from "react";

import { buildSessionScope, scopeOmissions } from "@/lib/altana/sessions";
import {
  EXECUTION_TOKEN,
  EXECUTION_TOKEN_DECIMALS,
  TESTNET_TARGETS,
  TESTNET_UNAVAILABLE,
  TOKEN_META,
} from "@/lib/chain/addresses";

import { BoundaryFields } from "./BoundaryFields";

/** Parse a decimal string into base units without floating point drift. */
function toBaseUnits(value: string, decimals: number): bigint {
  const trimmed = value.trim();
  if (trimmed === "") return 0n;
  const [whole = "0", fraction = ""] = trimmed.split(".");
  const padded = (fraction + "0".repeat(decimals)).slice(0, decimals);
  try {
    return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(padded || "0");
  } catch {
    return 0n;
  }
}

export function HireForm({
  agentId,
  agentName,
  category,
}: {
  agentId: string;
  agentName: string;
  category: AgentCategory;
}): React.ReactElement {
  const definition = categoryDefinition(category);

  const [capital, setCapital] = useState("100");
  const [dailyCap, setDailyCap] = useState("100");
  const [expiryDays, setExpiryDays] = useState(
    String(Math.round(definition.scope.defaultExpirySeconds / 86_400)),
  );
  const [boundaries, setBoundaries] = useState<CategoryBoundaries>(
    definition.defaultBoundaries,
  );

  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "submitting"; step: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  // The scope object. Everything the user reads below is derived from this.
  //
  // A failure is returned as data rather than thrown, so a missing contract
  // address renders a designed message instead of blanking the page — and the
  // discriminated result keeps the success branch narrowed for the preview.
  const scopeResult = useMemo(():
    | { ok: true; scope: SessionScope }
    | { ok: false; message: string } => {
    try {
      return {
        ok: true,
        scope: buildSessionScope({
          category,
          targets: TESTNET_TARGETS,
          unavailable: TESTNET_UNAVAILABLE,
          spendToken: EXECUTION_TOKEN,
          spendLimit: toBaseUnits(dailyCap, EXECUTION_TOKEN_DECIMALS),
          spendPeriodSeconds: 86_400,
          expirySeconds: Math.max(1, Number(expiryDays) || 1) * 86_400,
        }),
      };
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Could not build a session scope for this category.",
      };
    }
  }, [category, dailyCap, expiryDays]);

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!scopeResult.ok) return;

    setState({ kind: "submitting", step: "Provisioning your account" });

    try {
      const res = await fetch("/api/hire", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agentId,
          category,
          capital,
          dailyCap,
          expiryDays: Number(expiryDays),
          boundaries,
        }),
      });

      const body: unknown = await res.json();
      const message =
        typeof body === "object" && body !== null && "error" in body
          ? String((body as { error: unknown }).error)
          : "Hiring is not available yet.";

      // The hire route reports honestly that the on-chain path is not live
      // rather than returning a fabricated success.
      setState({ kind: "error", message });
    } catch {
      setState({
        kind: "error",
        message:
          "Could not reach the hire service. Nothing was signed and nothing was granted.",
      });
    }
  }

  return (
    <form className="hire-stack" onSubmit={onSubmit}>
      {/* ---- Panel 1: capital ---- */}
      <Panel title="Capital">
        <div className="field-row">
          <div className="field">
            <label htmlFor="capital">How much should it work with?</label>
            <input
              id="capital"
              inputMode="decimal"
              value={capital}
              onChange={(e) => setCapital(e.target.value)}
            />
            <p className="field-hint">USDT on BSC Testnet.</p>
          </div>
        </div>
      </Panel>

      {/* ---- Panel 2: boundaries ---- */}
      <Panel title="Boundaries">
        <p className="khoros-label" style={{ marginTop: 0 }}>
          The limits {agentName} works inside. Defaults are the category&rsquo;s
          recommended settings.
        </p>

        <BoundaryFields boundaries={boundaries} onChange={setBoundaries} />

        <div className="field-row">
          <div className="field">
            <label htmlFor="dailyCap">Most it can spend per day</label>
            <input
              id="dailyCap"
              inputMode="decimal"
              value={dailyCap}
              onChange={(e) => setDailyCap(e.target.value)}
            />
            <p className="field-hint">
              Enforced on-chain by the session key, not by us.
            </p>
          </div>

          <div className="field">
            <label htmlFor="expiryDays">Stop working after</label>
            <input
              id="expiryDays"
              inputMode="numeric"
              value={expiryDays}
              onChange={(e) => setExpiryDays(e.target.value)}
            />
            <p className="field-hint">Days. The session expires by itself.</p>
          </div>
        </div>
      </Panel>

      {/* ---- Panel 3: permissions preview — the tallest panel, on paper-lift ---- */}
      <Panel title="What this agent will be able to do" emphasis>
        {!scopeResult.ok ? (
          <p className="khoros-madder">
            {scopeResult.message} Hiring is disabled until that is configured —
            we will not ask you to grant permissions we cannot describe.
          </p>
        ) : (
          <>
            <PermissionList
              scope={scopeResult.scope}
              tokens={TOKEN_META}
              denied={definition.scope.denied}
            />
            {/* A protocol this category normally uses that is not deployed
                on testnet is named, so its absence from the list above is
                explained rather than looking like an oversight. */}
            {scopeOmissions(scopeResult.scope).map((o) => (
              <p key={o.key} className="khoros-label" style={{ marginTop: 12 }}>
                {o.reason}
              </p>
            ))}

            <p className="khoros-label" style={{ marginTop: 16 }}>
              These sentences are generated from the exact permission object that
              gets registered on-chain, so they cannot describe something
              different from what you grant.
            </p>
          </>
        )}
      </Panel>

      {/* ---- Panel 4: confirm ---- */}
      <Panel title="Confirm">
        <p className="khoros-prose" style={{ marginTop: 0 }}>
          Signing provisions your account if you do not have one, grants the
          session above, and opens the escrow. You can stop the agent at any time
          from your dashboard, in one transaction.
        </p>

        {state.kind === "error" ? (
          <div className="notice" data-tone="risk">
            <p>{state.message}</p>
          </div>
        ) : null}

        <button
          type="submit"
          className="btn-primary"
          disabled={state.kind === "submitting" || !scopeResult.ok}
        >
          {state.kind === "submitting" ? state.step : "Hire this agent"}
        </button>
      </Panel>
    </form>
  );
}
