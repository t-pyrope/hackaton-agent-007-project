import "server-only";
import { count, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { tools } from "@/db/schema";
import { ChatError, generateTool } from "./openai";
import { verifyProposal } from "./proposals";
import { validateCode, validateUiSchema } from "./generated-validation";
import { testTool } from "./sandbox";
import type { BuildStatus } from "./tool-contract";
import { BUILD_TIMEOUT_MS, timedStage } from "./build-timing";

export async function buildTool(
  token: unknown,
  emit: (status: BuildStatus, attempt: number) => void,
) {
  const proposal = verifyProposal(token);
  const signal = AbortSignal.timeout(BUILD_TIMEOUT_MS);
  if (!process.env.DATABASE_URL)
    throw new ChatError("Set DATABASE_URL on the server.", 503);
  // Transaction-scoped lock serializes all creators across server instances. No schema change required.
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL lock_timeout = '750s'`);
    await tx.execute(sql`SET LOCAL statement_timeout = '750s'`);
    await tx.execute(sql`SET LOCAL idle_in_transaction_session_timeout = '800s'`);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(706007)`);
    const [existing] = await tx
      .select()
      .from(tools)
      .where(eq(tools.id, proposal.id));
    if (existing) return existing;
    const [total] = await tx.select({ n: count() }).from(tools);
    if (total.n >= 10)
      throw new ChatError("You can install at most 10 tools.", 409);
    let previous: { code: string; tests: string; errors: string } | undefined;
    const attempts: Array<{
      attempt: number;
      report: typeof tools.$inferSelect.testReport;
    }> = [];
    for (let attempt = 0; attempt < 4; attempt++) {
      if (signal.aborted)
        throw new ChatError("Build timed out. Nothing was installed.", 504);
      emit(attempt === 0 ? "Writing Code" : "Fixing", attempt);
      const context = { buildId: proposal.id, attempt: attempt + 1 };
      const generated = await timedStage(
        "generation",
        () => generateTool(proposal.spec, previous, signal),
        context,
      );
      let uiSchema: typeof tools.$inferSelect.uiSchema;
      let report: typeof tools.$inferSelect.testReport;
      try {
        validateCode(generated.code);
        validateCode(generated.tests);
        uiSchema = validateUiSchema(generated.uiSchemaJson, proposal.spec);
        emit("Testing", attempt);
        report = await timedStage(
          "tests",
          () =>
            testTool(
              generated.code,
              generated.tests,
              proposal.spec,
              signal,
              context,
            ),
          context,
        );
        attempts.push({ attempt, report });
        if (!report.passed) throw new Error(JSON.stringify(report));
      } catch (error) {
        console.error(
          `Tool verification attempt ${attempt + 1}:`,
          String(error).slice(0, 12000),
        );
        if (!attempts.some((a) => a.attempt === attempt))
          attempts.push({
            attempt,
            report: {
              passed: false,
              results: [
                {
                  name: "Generated artifact validation",
                  passed: false,
                  error: String(error).slice(0, 8000),
                },
              ],
            },
          });
        previous = {
          code: generated.code,
          tests: generated.tests,
          errors: String(error).slice(0, 12000),
        };
        if (attempt === 3)
          throw new ChatError(
            "Tool failed verification after three repairs. Nothing was installed.",
            422,
          );
        continue;
      }
      if (signal.aborted)
        throw new ChatError("Build timed out. Nothing was installed.", 504);
      const [saved] = await timedStage(
        "installation",
        () =>
          tx
            .insert(tools)
            .values({
              id: proposal.id,
              name: proposal.spec.name,
              description: proposal.spec.description,
              code: generated.code,
              uiSchema,
              testReport: { ...report, proposal: proposal.spec, attempts },
            })
            .returning(),
        context,
      );
      return saved;
    }
    throw new Error("Unreachable build state.");
  });
}
