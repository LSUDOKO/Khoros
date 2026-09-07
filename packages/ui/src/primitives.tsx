"use client";

/**
 * The remaining primitives from docs/08-DESIGN_SYSTEM.md's component list.
 * Deliberately short — the design system is a small set of parts used
 * consistently, not a large library.
 */

import { useEffect, useState } from "react";

import type { TelemetryEvent } from "@khoros/core";

import { VerifyLink } from "./VerifyLink.js";

// ---------------------------------------------------------------------------
// Panel — paper-lift surface, hairline border, no shadow
// ---------------------------------------------------------------------------

export type PanelProps = {
  children: React.ReactNode;
  /** Rendered as the panel heading in Spectral. */
  title?: string;
  /** The hire flow's permissions panel is the tallest and carries the weight. */
  emphasis?: boolean;
};

export function Panel({ children, title, emphasis }: PanelProps): React.ReactElement {
  return (
    <section className="khoros-panel" data-emphasis={emphasis ? "true" : undefined}>
      {title ? <h2 className="khoros-section khoros-panel-title">{title}</h2> : null}
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Chip — the intent seeds on the front door
// ---------------------------------------------------------------------------

export type ChipProps = {
  children: React.ReactNode;
  onClick?: () => void;
  href?: string;
};

export function Chip({ children, onClick, href }: ChipProps): React.ReactElement {
  if (href) {
    return (
      <a className="khoros-chip" href={href}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" className="khoros-chip" onClick={onClick}>
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// EmptyState — an invitation, never "No data available"
// ---------------------------------------------------------------------------

export type EmptyStateProps = {
  /** What is absent, stated plainly. */
  message: string;
  /** What to do next. Empty states are invitations. */
  action?: React.ReactNode;
};

export function EmptyState({ message, action }: EmptyStateProps): React.ReactElement {
  return (
    <div className="khoros-empty">
      <p className="khoros-prose">{message}</p>
      {action ? <div className="khoros-empty-action">{action}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TelemetryFeed — executed and blocked at equal weight
// ---------------------------------------------------------------------------

export type TelemetryFeedProps = {
  events: TelemetryEvent[];
  chainId?: 56 | 97;
};

function formatTime(at: bigint): string {
  return new Date(Number(at) * 1000).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * Blocked actions render in madder at the SAME SIZE as executed ones. docs/08 is
 * explicit about this: a blocked action is evidence the safety layer works, not
 * an error to be tucked away.
 */
export function TelemetryFeed({
  events,
  chainId = 97,
}: TelemetryFeedProps): React.ReactElement {
  if (events.length === 0) {
    return (
      <EmptyState message="No activity yet. This agent reports here the moment it observes a trigger, whether it acts or is stopped." />
    );
  }

  return (
    <ol className="khoros-feed" aria-live="polite">
      {events.map((e, i) => (
        <li key={i} className="khoros-feed-row" data-kind={e.kind}>
          <span className="khoros-label khoros-feed-time">{formatTime(e.at)}</span>

          {e.kind === "executed" && (
            <span className="khoros-feed-body">
              <span className="khoros-feed-verb">Executed</span>{" "}
              <span className="khoros-label">
                {e.latencyMs}ms from trigger, {e.gasUsed.toString()} gas
              </span>{" "}
              <VerifyLink kind="bscscan" value={e.tx} target="tx" chainId={chainId} />
            </span>
          )}

          {e.kind === "blocked" && (
            <span className="khoros-feed-body">
              <span className="khoros-feed-verb khoros-madder">
                Blocked before execution
              </span>{" "}
              <span className="khoros-label">
                {e.reason} — {e.failedInvariant} expected {e.expected}, observed{" "}
                {e.observed}
              </span>
            </span>
          )}

          {e.kind === "triggered" && (
            <span className="khoros-feed-body">
              <span className="khoros-feed-verb">Triggered</span>{" "}
              <span className="khoros-label">{e.trigger}</span>
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Freshness — how current the data is
// ---------------------------------------------------------------------------

/**
 * How current the data is.
 *
 * Relative time is computed CLIENT-SIDE only. Rendering it during SSR compares
 * the server's clock at build/request time against the browser's at hydration,
 * which differed by minutes in practice and produced a React hydration
 * mismatch — Next then discarded the server HTML and re-rendered the whole
 * root on the client. The first paint shows an absolute timestamp, which is
 * stable on both sides, and it becomes relative once mounted.
 */
export function FreshnessBadge({
  computedAt,
  now,
}: {
  computedAt: bigint;
  now?: bigint;
}): React.ReactElement {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const absolute = new Date(Number(computedAt) * 1000).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  if (!mounted && now === undefined) {
    // Deterministic on both server and client.
    return (
      <span className="khoros-label khoros-freshness">Updated {absolute}</span>
    );
  }

  const current = now ?? BigInt(Math.floor(Date.now() / 1000));
  const ageSeconds = Number(current - computedAt);

  const text =
    ageSeconds < 120
      ? "Updated just now"
      : ageSeconds < 3600
        ? `Updated ${Math.round(ageSeconds / 60)} minutes ago`
        : ageSeconds < 86_400
          ? `Updated ${Math.round(ageSeconds / 3600)} hours ago`
          : `Updated ${Math.round(ageSeconds / 86_400)} days ago`;

  // Past an hour the data is stale enough that a judge should know.
  const stale = ageSeconds > 3600;

  return (
    <span
      className="khoros-label khoros-freshness"
      data-stale={stale ? "true" : undefined}
      title={`Last computed ${absolute}`}
    >
      {text}
      {stale ? " — the indexer may be behind" : ""}
    </span>
  );
}
