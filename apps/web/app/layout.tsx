import type { Metadata } from "next";
import { Archivo, Spectral } from "next/font/google";

import "@khoros/ui/tokens.css";
import "@khoros/ui/components.css";
import "./globals.css";

/**
 * Spectral for display, Archivo for interface and data.
 *
 * Archivo is loaded because it has genuine tabular figures — metric columns
 * only align if the digits are monospaced in width. That is a functional
 * requirement, not a stylistic one (docs/08-DESIGN_SYSTEM.md).
 */
const spectral = Spectral({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-spectral",
  display: "swap",
});

const archivo = Archivo({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-archivo",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Khoros — the front door for AI agents on BNB Smart Chain",
  description:
    "Describe a financial goal, compare verified on-chain agents by a Sybil-pruned track record, and hire one with scoped permissions you can revoke in a click.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <html lang="en" className={`${spectral.variable} ${archivo.variable}`}>
      <body>
        <a className="khoros-skip" href="#main">
          Skip to content
        </a>
        <SiteHeader />
        <main id="main">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}

function SiteHeader(): React.ReactElement {
  return (
    <header className="site-header">
      <div className="site-shell site-header-inner">
        <a href="/" className="site-mark">
          Khoros
        </a>
        <nav aria-label="Primary">
          <ul className="site-nav">
            <li>
              <a href="/arena">Arena</a>
            </li>
            <li>
              <a href="/benchmark">Benchmark</a>
            </li>
            <li>
              <a href="/verify">How trust works</a>
            </li>
            <li>
              <a href="/dashboard">Dashboard</a>
            </li>
          </ul>
        </nav>
      </div>
    </header>
  );
}

function SiteFooter(): React.ReactElement {
  return (
    <footer className="site-footer">
      <div className="site-shell">
        {/*
          Testnet is labelled everywhere, framed as the deliberate choice it is:
          real mainnet agent data, execution on testnet so nobody's capital is
          at risk during judging. CLAUDE.md rule 6.
        */}
        <p className="khoros-label khoros-prose">
          Agent identity and reputation are read from BNB Smart Chain mainnet.
          All execution — sessions, jobs and agent transactions — runs on BSC
          Testnet (chain 97), so no real capital is at risk. Every figure on this
          site comes from a real chain read or a recorded run.
        </p>
      </div>
    </footer>
  );
}
