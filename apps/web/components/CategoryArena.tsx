"use client";

/**
 * The category arena with its prune toggle and reorder choreography.
 *
 * docs/08-DESIGN_SYSTEM.md: "Flipping the prune toggle re-sorts the arena;
 * staves animate to new positions over 420ms with a gentle ease; agents that
 * fall are briefly marked. It's the demonstration of the product's central
 * claim, so it gets the only piece of choreography."
 *
 * Implemented as FLIP (First, Last, Invert, Play): measure each row before the
 * re-sort, measure after, apply the inverse transform, then release it. That
 * animates real DOM reordering rather than faking movement, so the table stays
 * a correct semantic table throughout.
 *
 * prefers-reduced-motion re-sorts instantly. The information is identical
 * either way — the animation only shows WHICH agents moved.
 */

import type { AgentCategory, AgentRow, PruningSummary } from "@khoros/core";
import { categoryDefinition } from "@khoros/core";
import { EmptyState, FreshnessBadge, PruneToggle } from "@khoros/ui";
import { useCallback, useLayoutEffect, useRef, useState } from "react";

import { StaveList } from "./StaveList";

const REORDER_MS = 420;

export function CategoryArena({
  category,
  prunedAgents,
  unfilteredAgents,
  summary,
  freshness,
  unavailable,
}: {
  category: AgentCategory;
  prunedAgents: AgentRow[];
  unfilteredAgents: AgentRow[];
  summary: PruningSummary;
  freshness: bigint;
  unavailable: boolean;
}): React.ReactElement {
  const [pruned, setPruned] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const positions = useRef<Map<string, number>>(new Map());
  const pending = useRef(false);

  const agents = pruned ? prunedAgents : unfilteredAgents;

  /** Record every row's current vertical position, before React re-orders. */
  const capture = useCallback((): void => {
    const root = containerRef.current;
    if (!root) return;
    const map = new Map<string, number>();
    for (const row of root.querySelectorAll<HTMLElement>("tr[data-agent-key]")) {
      const key = row.dataset.agentKey;
      if (key) map.set(key, row.getBoundingClientRect().top);
    }
    positions.current = map;
  }, []);

  const onToggle = useCallback(
    (next: boolean): void => {
      if (next === pruned) return;
      capture();
      pending.current = true;
      setPruned(next);
    },
    [pruned, capture],
  );

  useLayoutEffect(() => {
    if (!pending.current) return;
    pending.current = false;

    const root = containerRef.current;
    if (!root) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      positions.current = new Map();
      return;
    }

    const previous = positions.current;
    const rows = [...root.querySelectorAll<HTMLElement>("tr[data-agent-key]")];

    for (const [index, row] of rows.entries()) {
      const key = row.dataset.agentKey;
      if (!key) continue;

      const before = previous.get(key);
      if (before === undefined) continue;

      const delta = before - row.getBoundingClientRect().top;
      if (delta === 0) continue;

      // Invert: put the row back where it was, with no transition...
      row.style.transition = "none";
      row.style.transform = `translateY(${delta}px)`;

      // Mark the agents that fell, so a judge sees which ones lost rank.
      const previousIndex = [...previous.keys()].indexOf(key);
      if (previousIndex !== -1 && index > previousIndex) {
        row.dataset.fell = "true";
      } else {
        delete row.dataset.fell;
      }

      // ...then play it forward on the next frame.
      requestAnimationFrame(() => {
        row.style.transition = `transform ${REORDER_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`;
        row.style.transform = "";
      });
    }

    const clear = window.setTimeout(() => {
      for (const row of rows) {
        row.style.transition = "";
        row.style.transform = "";
        delete row.dataset.fell;
      }
    }, REORDER_MS + 600);

    positions.current = new Map();
    return () => window.clearTimeout(clear);
  }, [pruned]);

  if (unavailable) {
    return (
      <EmptyState
        message="Agent rankings are temporarily unavailable — the indexer is not reachable from this deployment. Nothing on this page is cached or estimated, so it stays empty until the connection returns."
        action={
          <a className="btn-secondary" href="/verify">
            How rankings are built
          </a>
        }
      />
    );
  }

  return (
    <div className="section">
      <div className="section-head">
        <PruneToggle pruned={pruned} onChange={onToggle} summary={summary} />
        {freshness > 0n ? <FreshnessBadge computedAt={freshness} /> : null}
      </div>

      {agents.length === 0 ? (
        <EmptyState
          message={
            pruned
              ? `No ${categoryDefinition(category).label.toLowerCase()} agent has a payment-backed track record yet. Switch to unfiltered to see every registered agent in this category, including those with no settled work behind them.`
              : `No agents are registered in this category yet.`
          }
          action={
            pruned ? (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => onToggle(false)}
              >
                Show unfiltered
              </button>
            ) : undefined
          }
        />
      ) : (
        <div ref={containerRef}>
          <StaveList agents={agents} category={category} />
        </div>
      )}
    </div>
  );
}
