/**
 * /benchmark — the Agent Advantage Report as a live product surface.
 * From docs/09-BENCHMARK_HARNESS.md.
 *
 * The honesty rules from that document are enforced structurally here:
 *
 *   - every number comes from a committed run record with transaction hashes
 *   - runs are read from bench/runs/ at build time; there is no fallback to
 *     illustrative figures, so an absent run renders an empty state
 *   - sample sizes are always stated, and a single observation is labelled
 *   - the operator and their familiarity are printed next to the numbers
 *
 * CLAUDE.md rule 5: never fabricate performance numbers. TermiX judges will
 * hire from this marketplace and check. A fabricated number that gets caught
 * costs more than an unimpressive real one — so when there are no runs, this
 * page says exactly that.
 */

import { Panel } from "@khoros/ui";

import { TaskComparison } from "@/components/TaskComparison";
import { loadRuns } from "@/lib/bench";

export const revalidate = 300;

export const metadata = {
  title: "Agent Advantage — Khoros",
  description:
    "The same task run manually and by an agent, with every figure traced to a real transaction on BSC Testnet.",
};

const TASKS = [
  {
    id: "lp-range-recovery" as const,
    title: "PancakeSwap V3 range recovery",
    domain: "Trading",
    why: "A concentrated liquidity position drifts out of range and stops earning. Both branches are alerted at the same instant.",
  },
  {
    id: "venus-liquidation-defense" as const,
    title: "Venus liquidation defense",
    domain: "Security",
    why: "A borrow position's health factor falls toward liquidation. The dollar delta here is the largest of the three.",
  },
  {
    id: "yield-migration" as const,
    title: "Cross-protocol yield migration",
    domain: "Yield",
    why: "Yield diverges between protocols. The agent's advantage here is continuous attention, not faster execution.",
  },
];

export default async function BenchmarkPage(): Promise<React.ReactElement> {
  const runs = await loadRuns();
  const hasRuns = runs.length > 0;

  return (
    <div className="site-shell">
      <div className="page-head">
        <h1 className="khoros-title">Does hiring an agent actually beat doing it yourself?</h1>
        <p className="lede">
          Three tasks, each run both ways on BSC Testnet. Every figure below
          traces to a transaction you can open.
        </p>
      </div>

      {!hasRuns ? (
        <>
          {/*
            No runs recorded yet. This says so plainly rather than showing
            illustrative numbers — the whole value of this page is that its
            figures are real.
          */}
          <div className="notice" data-tone="risk">
            <p>
              <strong>No benchmark runs have been recorded yet.</strong> This page
              will stay empty until real runs exist, because every number on it
              has to come from a run that actually happened with transaction
              hashes to match. We would rather show nothing than show an
              estimate that looks like a measurement.
            </p>
          </div>

          <section className="section">
            <h2 className="khoros-section">What will be measured</h2>
            <div className="bench-grid">
              {TASKS.map((t) => (
                <Panel key={t.id} title={t.title}>
                  <p className="khoros-label" style={{ marginTop: 0 }}>
                    {t.domain}
                  </p>
                  <p className="khoros-prose">{t.why}</p>
                  <ul className="khoros-label">
                    <li>Elapsed time from alert to resolution, both branches</li>
                    <li>Gas spent, and the opportunity cost of the delay</li>
                    <li>The end state each branch reached</li>
                    <li>Every transaction hash, linked to BscScan</li>
                  </ul>
                </Panel>
              ))}
            </div>
          </section>

          <section className="section">
            <Panel title="How the manual branch is recorded">
              <p className="khoros-prose" style={{ marginTop: 0 }}>
                A human runs the task with a monotonic clock started at the alert
                and a screen recording running. Step boundaries and transaction
                hashes are captured live by a CLI rather than typed in
                afterwards, because a timing reconstructed from memory is an
                estimate wearing a measurement&rsquo;s clothes.
              </p>
              <p className="khoros-prose">
                The operator and how familiar they were with the interface get
                printed next to the numbers. If it was one of us, the manual
                branch is faster than a real user&rsquo;s would be — which makes
                the comparison conservative, and worth saying out loud.
              </p>
            </Panel>
          </section>
        </>
      ) : (
        <>
          {TASKS.map((t) => (
            <TaskComparison
              key={t.id}
              task={t.id}
              title={t.title}
              domain={t.domain}
              runs={runs.filter((r) => r.task === t.id)}
            />
          ))}
        </>
      )}

      <section className="section">
        <Panel title="Before you hire">
          <p className="khoros-prose" style={{ marginTop: 0 }}>
            Everything here runs on BSC Testnet, so you need testnet BNB to try
            an agent yourself. The faucet is at{" "}
            <a
              href="https://testnet.bnbchain.org/faucet-smart"
              target="_blank"
              rel="noopener noreferrer"
            >
              testnet.bnbchain.org/faucet-smart
            </a>
            . Account provisioning is part of the hire flow, not a prerequisite —
            you do not need a wallet set up before you start.
          </p>
          <p className="khoros-label">
            <a href="/arena">Browse the agents that run these tasks</a>
          </p>
        </Panel>
      </section>

      <section className="section">
        <h2 className="khoros-section">How to check any of this</h2>
        <ul className="khoros-permission-lines khoros-prose">
          <li>
            Raw run records are committed to the repository under{" "}
            <code>bench/runs/</code> — read the record, not just this summary.
          </li>
          <li>
            Every transaction hash links to{" "}
            <a
              href="https://testnet.bscscan.com"
              target="_blank"
              rel="noopener noreferrer"
            >
              BscScan on BSC Testnet
            </a>
            , so you can open any step of either branch.
          </li>
          <li>
            Where a figure comes from a single run, it says so. Where it is a
            median, the sample size is printed beside it.
          </li>
        </ul>
      </section>
    </div>
  );
}
