import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { ChatError } from "./openai";
import {
  validateProposal,
  type Proposal,
  type ConfirmableProposal,
} from "./tool-contract";

function secret() {
  const key = process.env.TOOL_PROPOSAL_SECRET || process.env.OPENAI_API_KEY;
  if (!key) throw new ChatError("Tool confirmation is not configured.", 503);
  return key;
}

function sign(payload: string) {
  return createHmac("sha256", secret())
    .update("victor-proposal-v1:" + payload)
    .digest("base64url");
}

export function issueProposal(spec: Proposal): ConfirmableProposal {
  const id = randomUUID();
  const expiresAt = Date.now() + 30 * 60_000;
  const payload = Buffer.from(
    JSON.stringify({ id, spec: validateProposal(spec), expiresAt }),
  ).toString("base64url");
  return { id, spec, expiresAt, token: payload + "." + sign(payload) };
}

export function verifyProposal(token: unknown): ConfirmableProposal {
  if (typeof token !== "string" || token.length > 10000)
    throw new ChatError("Confirm a valid proposal first.");
  const [payload, signature, extra] = token.split(".");
  const expected = Buffer.from(sign(payload || ""));
  const actual = Buffer.from(signature || "");
  if (
    extra ||
    expected.length !== actual.length ||
    !timingSafeEqual(expected, actual)
  )
    throw new ChatError("Proposal confirmation is invalid.");
  try {
    const p = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (
      !/^[0-9a-f-]{36}$/.test(p.id) ||
      !Number.isFinite(p.expiresAt) ||
      p.expiresAt < Date.now()
    )
      throw new Error();
    return {
      id: p.id,
      spec: validateProposal(p.spec),
      expiresAt: p.expiresAt,
      token,
    };
  } catch {
    throw new ChatError(
      "Proposal expired or invalid. Ask Victor for a new proposal.",
    );
  }
}
