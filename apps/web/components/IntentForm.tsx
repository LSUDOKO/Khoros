"use client";

/**
 * The intent input.
 *
 * docs/01-PRODUCT_SPEC.md: "The UI shows the restatement before results ... The
 * user can edit it. Never silently guess — always show what was understood."
 *
 * Parsing runs locally through the deterministic matcher, so typing an intent
 * never depends on a network round trip or an external model being up.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";

import { parseIntent, isMultiCategory } from "@/lib/intent/parser";
import { categoryDefinition } from "@khoros/core";
import type { ParsedIntent } from "@khoros/core";

export function IntentForm(): React.ReactElement {
  const router = useRouter();
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<ParsedIntent | undefined>();

  function onSubmit(e: React.FormEvent): void {
    e.preventDefault();
    if (text.trim().length === 0) return;
    setParsed(parseIntent(text));
  }

  function go(): void {
    if (!parsed) return;
    const first = parsed.categories[0];
    if (!first) return;

    // Nothing matched: send them to the index showing all four, rather than
    // dropping them into whichever category happened to sort first.
    if (parsed.confidence === 0) {
      router.push("/arena");
    } else if (isMultiCategory(parsed)) {
      router.push(`/arena?intent=${encodeURIComponent(text)}&multi=1`);
    } else {
      router.push(`/arena/${first}?intent=${encodeURIComponent(text)}`);
    }
  }

  return (
    <div>
      <form className="intent-form" onSubmit={onSubmit}>
        <label htmlFor="intent" className="khoros-sr-only">
          Describe your financial goal
        </label>
        <input
          id="intent"
          className="intent-input"
          type="text"
          value={text}
          placeholder="Keep my liquidity earning without watching a chart"
          onChange={(e) => {
            setText(e.target.value);
            setParsed(undefined);
          }}
        />
        <button type="submit" className="btn-primary">
          Find agents
        </button>
      </form>

      {parsed ? (
        <div className="notice" data-tone={parsed.confidence === 0 ? "risk" : undefined}>
          {parsed.confidence === 0 ? (
            <p>
              We couldn&rsquo;t match that to a category with any confidence, so
              rather than guess, here are all four. Pick the one that fits.
            </p>
          ) : (
            <>
              <p>{parsed.restated}</p>
              {isMultiCategory(parsed) ? (
                <p className="khoros-label" style={{ marginTop: 8 }}>
                  That spans{" "}
                  {parsed.categories
                    .map((c) => categoryDefinition(c).label.toLowerCase())
                    .join(" and ")}
                  . You can hire a coordinator that engages one specialist for
                  each, with its own scoped session.
                </p>
              ) : null}
            </>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
            <button type="button" className="btn-primary" onClick={go}>
              {parsed.confidence === 0 ? "Browse all categories" : "Show matching agents"}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setParsed(undefined)}
            >
              Edit
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
