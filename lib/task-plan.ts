import "server-only";
import type { BudgetSnapshot } from "./run-budget";
import { compressEntry } from "./builtin-registry";
import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "./db";
import { tools } from "@/db/schema";
import {
  validateSteps,
  type RegistryEntry,
  type TaskStep,
} from "./task-contract";
import { validateProposal } from "./tool-contract";
import { issueProposal } from "./proposals";
export async function loadRegistry(): Promise<RegistryEntry[]> {
  return [
    compressEntry,
    ...(await db.select().from(tools))
      .filter((t) => t.testReport.passed && t.testReport.proposal)
      .map((t) => ({
        id: t.id,
        name: t.name,
        spec: validateProposal(t.testReport.proposal),
      })),
  ];
}
function sign(payload: string) {
  const key = process.env.TOOL_PROPOSAL_SECRET || process.env.OPENAI_API_KEY;
  if (!key) throw new Error("Task confirmation is not configured.");
  return createHmac("sha256", key)
    .update("victor-task-v1:" + payload)
    .digest("base64url");
}
export function issuePlan(steps: TaskStep[], budget?: BudgetSnapshot) {
  const payload = Buffer.from(
    JSON.stringify({
      steps,
      budget,
      builds: steps.map((s) =>
        s.proposal ? issueProposal(s.proposal).token : null,
      ),
      expiresAt: Date.now() + 30 * 60_000,
    }),
  ).toString("base64url");
  return { steps, token: payload + "." + sign(payload) };
}
export function verifyPlan(token: unknown) {
  if (typeof token !== "string" || token.length > 100000)
    throw new Error("Confirm a valid plan.");
  const [payload, signature, extra] = token.split(".");
  const expected = Buffer.from(sign(payload || "")),
    actual = Buffer.from(signature || "");
  if (
    extra ||
    expected.length !== actual.length ||
    !timingSafeEqual(expected, actual)
  )
    throw new Error("Invalid plan confirmation.");
  const plan = JSON.parse(Buffer.from(payload, "base64url").toString());
  if (!Number.isFinite(plan.expiresAt) || plan.expiresAt < Date.now())
    throw new Error("Plan expired. Ask Victor for a new plan.");
  return plan as {
    steps: TaskStep[];
    budget?: BudgetSnapshot;
    builds: Array<string | null>;
    expiresAt: number;
  };
}
export { validateSteps };
