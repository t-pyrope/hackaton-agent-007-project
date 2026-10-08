import { buildTool } from "@/lib/tool-build";
import { ChatError } from "@/lib/openai";
import { verifyProposal } from "@/lib/proposals";
import { readJson, sameOrigin } from "@/lib/request";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const body = await readJson(request, 16000);
    if (body.confirmed !== true)
      throw new ChatError("Click Confirm & Build first.");
    verifyProposal(body.token);
    const encoder = new TextEncoder();
    let closed = false;
    const stream = new ReadableStream({
      async start(controller) {
        const send = (data: unknown) => {
          if (!closed) {
            try {
              controller.enqueue(encoder.encode(JSON.stringify(data) + "\n"));
            } catch {
              closed = true;
            }
          }
        };
        try {
          const tool = await buildTool(body.token, (status, attempt) =>
            send({ status, attempt }),
          );
          const { code: _code, ...record } = tool;
          void _code;
          send({ status: "Installed", tool: record });
        } catch (error) {
          const cause =
            error instanceof Error && error.cause instanceof Error
              ? error.cause
              : error;
          console.error(
            "Tool build failed:",
            cause instanceof Error ? cause.message : "Unknown failure",
          );
          send({
            error:
              error instanceof ChatError
                ? error.message
                : "Build failed. Nothing was installed. Please check server configuration and try again.",
          });
        } finally {
          if (!closed) {
            closed = true;
            controller.close();
          }
        }
      },
      cancel() {
        closed = true;
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Invalid confirmation.",
      },
      { status: error instanceof ChatError ? error.status : 400 },
    );
  }
}
