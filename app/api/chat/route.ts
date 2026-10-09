import { RunBudget, RUN_LIMITS } from "@/lib/run-budget";
import { discoverRegistry } from "@/lib/registry-discovery";
import { sameOrigin } from "@/lib/request";
import { loadRegistry, issuePlan, validateSteps } from "@/lib/task-plan";
import {
  ChatError,
  replyToChat,
  validateHistory,
  planImageTask,
} from "@/lib/openai";

import { issueProposal } from "@/lib/proposals";

export const runtime = "nodejs";
export const maxDuration = 240;
const MAX_BODY_BYTES = 256 * 1024;

export async function POST(request: Request) {
  let budget: RunBudget | undefined;
  try {
    sameOrigin(request);
    if (
      request.headers.get("content-type")?.split(";")[0].trim() !==
      "application/json"
    ) {
      throw new ChatError("Send JSON with a messages array.", 415);
    }
    if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) {
      throw new ChatError("Chat request is too large.", 413);
    }
    const reader = request.body?.getReader();
    if (!reader) throw new ChatError("Send a messages array.");
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new ChatError("Chat request is too large.", 413);
      }
      chunks.push(value);
    }
    let body: unknown;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new ChatError("Invalid JSON. Send a messages array.");
    }
    const messages = validateHistory(body);
    if ((body as { imageTask?: boolean }).imageTask === true) {
      budget = new RunBudget();
      const available = await loadRegistry();
      const { registry, discovery } = await discoverRegistry(messages.at(-1)!.content, available, budget);
      const reply = await planImageTask(messages, registry, budget);
      const plan =
        reply.steps === null
          ? null
          : issuePlan(validateSteps(reply.steps, registry), budget.snapshot());
      return Response.json(
        { message: reply.message, plan, discovery, budget: budget.snapshot(), limits: RUN_LIMITS },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const reply = await replyToChat(messages);
    return Response.json(
      {
        message: reply.message,
        proposal: reply.proposal ? issueProposal(reply.proposal) : null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Task planning failed", JSON.stringify(error instanceof Error ? { name: error.name, message: error.message } : "Unknown error"));
    return Response.json(
      {
        budget: budget?.snapshot(),
        limits: RUN_LIMITS,
        error:
          error instanceof ChatError
            ? error.message
            : "Victor could not reply. Please try again.",
      },
      {
        status: error instanceof ChatError ? error.status : 500,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
