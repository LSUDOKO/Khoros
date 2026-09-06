/**
 * VerifyLink — an external link to an independent verifier.
 * From docs/08-DESIGN_SYSTEM.md.
 *
 * "VerifyLink is a primitive specifically so it is impossible to render a claim
 * without a verifier."
 *
 * CLAUDE.md rule 7: every claim links to a verifier. Agent identity to 8004scan,
 * sessions to the Altana Explorer, transactions to BscScan. A judge should be
 * able to independently confirm anything the UI asserts, in one click.
 *
 * The `kind` is required rather than defaulted, so adding a new claim surface
 * forces an explicit decision about who verifies it.
 */

export type VerifierKind = "bscscan" | "8004scan" | "altana";

export type VerifyLinkProps = {
  kind: VerifierKind;
  /** Transaction hash, agent id, address, or session key, per kind. */
  value: string;
  /** What the link points at. Governs the URL path. */
  target?: "tx" | "address" | "agent" | "session" | "block";
  /** Chain id. 97 is BSC Testnet, where all execution happens. */
  chainId?: 56 | 97;
  children?: React.ReactNode;
};

const BSCSCAN: Record<56 | 97, string> = {
  56: "https://bscscan.com",
  97: "https://testnet.bscscan.com",
};

function href(
  kind: VerifierKind,
  value: string,
  target: NonNullable<VerifyLinkProps["target"]>,
  chainId: 56 | 97,
): string {
  switch (kind) {
    case "bscscan": {
      const base = BSCSCAN[chainId];
      const path =
        target === "address" ? "address" : target === "block" ? "block" : "tx";
      return `${base}/${path}/${value}`;
    }
    case "8004scan":
      return target === "address"
        ? `https://8004scan.io/address/${value}`
        : `https://8004scan.io/agent/${value}`;
    case "altana":
      return target === "session"
        ? `https://explorer.altana.network/session/${value}`
        : `https://explorer.altana.network/tx/${value}`;
  }
}

const VERIFIER_NAME: Record<VerifierKind, string> = {
  bscscan: "BscScan",
  "8004scan": "8004scan",
  altana: "Altana Explorer",
};

/** Shorten a hash or address for display without hiding what it is. */
export function truncateHex(value: string, lead = 6, tail = 4): string {
  if (value.length <= lead + tail + 1) return value;
  return `${value.slice(0, lead)}…${value.slice(-tail)}`;
}

export function VerifyLink({
  kind,
  value,
  target = "tx",
  chainId = 97,
  children,
}: VerifyLinkProps): React.ReactElement {
  const url = href(kind, value, target, chainId);
  const verifier = VERIFIER_NAME[kind];

  return (
    <a
      className="khoros-verify-link"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
    >
      {children ?? truncateHex(value)}
      <span className="khoros-sr-only"> — verify on {verifier}, opens in a new tab</span>
      <svg
        className="khoros-verify-icon"
        viewBox="0 0 12 12"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M4 2h6v6M10 2L3 9" fill="none" strokeWidth="1.5" />
      </svg>
    </a>
  );
}
