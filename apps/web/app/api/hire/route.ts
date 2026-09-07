/**
 * POST /api/hire — the hire flow's server half.
 *
 * CLAUDE.md rule 6: "If a flow cannot reach the chain yet, mark it clearly as
 * not-yet-live rather than faking a hash." This route therefore validates the
 * request fully, builds the real session scope, and then reports precisely which
 * prerequisite is missing — it never returns a fabricated success or a made-up
 * transaction hash.
 *
 * Everything up to the signature is real: the scope built here is the object
 * that would be passed to grantSession, and the permissions the user read in
 * the form were rendered from it.
 */

import { AGENT_CATEGORIES } from "@khoros/core";
import type { AgentCategory } from "@khoros/core";
import { NextResponse } from "next/server";

import { buildSessionScope } from "@/lib/altana/sessions";
import {
  EXECUTION_TOKEN,
  EXECUTION_TOKEN_DECIMALS,
  TESTNET_TARGETS,
} from "@/lib/chain/addresses";

type HireRequest = {
  agentId: string;
  category: AgentCategory;
  capital: string;
  dailyCap: string;
  expiryDays: number;
};

function isCategory(value: unknown): value is AgentCategory {
  return (
    typeof value === "string" &&
    (AGENT_CATEGORIES as readonly string[]).includes(value)
  );
}

/** Narrow the untrusted body without `any`. */
function parseBody(body: unknown): HireRequest | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const b = body as Record<string, unknown>;

  if (typeof b.agentId !== "string" || b.agentId.length === 0) return undefined;
  if (!isCategory(b.category)) return undefined;
  if (typeof b.capital !== "string") return undefined;
  if (typeof b.dailyCap !== "string") return undefined;
  if (typeof b.expiryDays !== "number" || !Number.isFinite(b.expiryDays)) {
    return undefined;
  }

  return {
    agentId: b.agentId,
    category: b.category,
    capital: b.capital,
    dailyCap: b.dailyCap,
    expiryDays: b.expiryDays,
  };
}

function toBaseUnits(value: string, decimals: number): bigint {
  const [whole = "0", fraction = ""] = value.trim().split(".");
  const padded = (fraction + "0".repeat(decimals)).slice(0, decimals);
  try {
    return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(padded || "0");
  } catch {
    return 0n;
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request body." }, { status: 400 });
  }

  const body = parseBody(raw);
  if (!body) {
    return NextResponse.json(
      { error: "That request was missing required fields, so nothing was attempted." },
      { status: 400 },
    );
  }

  // Build the real scope. If this throws, the configuration is genuinely
  // incomplete and the user needs to know rather than get an opaque failure.
  let scope;
  try {
    scope = buildSessionScope({
      category: body.category,
      targets: TESTNET_TARGETS,
      spendToken: EXECUTION_TOKEN,
      spendLimit: toBaseUnits(body.dailyCap, EXECUTION_TOKEN_DECIMALS),
      spendPeriodSeconds: 86_400,
      expirySeconds: Math.max(1, Math.round(body.expiryDays)) * 86_400,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not build a session scope for this category.",
      },
      { status: 500 },
    );
  }

  // Granting requires a browser-side Passkey signature — the admin key never
  // reaches the server, which is the point of self-custody. So the server's job
  // ends at validating and describing; the signature happens client-side.
  //
  // Until the client-side signing path is wired to a funded testnet wallet,
  // this says so plainly instead of returning a hash nobody can verify.
  return NextResponse.json(
    {
      error:
        "Hiring is not live yet on this deployment. The session scope below is real and validated, " +
        "but granting it needs a Passkey signature from a funded BSC Testnet account, which is not " +
        "provisioned here. Nothing was signed and nothing was granted.",
      // Returned so the client can show exactly what WOULD be granted — the
      // same object, not a description of it.
      scope: {
        calls: scope.calls,
        selectors: scope.selectors,
        spend: scope.spend.map((s) => ({
          token: s.token,
          limit: s.limit.toString(),
          periodSeconds: s.periodSeconds,
        })),
        expiry: scope.expiry.toString(),
      },
      notLive: true,
    },
    { status: 503 },
  );
}
