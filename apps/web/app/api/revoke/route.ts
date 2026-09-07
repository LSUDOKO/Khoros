/**
 * POST /api/revoke — stop an agent.
 *
 * Like /api/hire, revoking needs the account's own signature, which never
 * leaves the browser. So this route validates and reports; it does not
 * fabricate a transaction hash.
 *
 * The important property, stated in the response: a session lives in the
 * Altana KeyStore and is enforced by the account contract, so a user is never
 * dependent on this service to stop an agent. If Khoros is down, revoking still
 * works directly on-chain. Saying that plainly is more useful than a button
 * that pretends to have done something.
 */

import { NextResponse } from "next/server";

type RevokeRequest = { engagementId: string; sessionKey: string };

function parseBody(body: unknown): RevokeRequest | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const b = body as Record<string, unknown>;
  if (typeof b.engagementId !== "string" || b.engagementId.length === 0) {
    return undefined;
  }
  if (typeof b.sessionKey !== "string" || !b.sessionKey.startsWith("0x")) {
    return undefined;
  }
  return { engagementId: b.engagementId, sessionKey: b.sessionKey };
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
      { error: "That request was missing a session key, so nothing was attempted." },
      { status: 400 },
    );
  }

  return NextResponse.json(
    {
      error:
        "Revoking from this deployment is not live yet — it needs a signature from the account that granted the session, and that key never reaches our servers. " +
        "Your session is unaffected. You can revoke it directly in the Altana Explorer, which works whether or not Khoros is running.",
      sessionKey: body.sessionKey,
      explorerUrl: `https://explorer.altana.network/session/${body.sessionKey}`,
      notLive: true,
    },
    { status: 503 },
  );
}
