import { ChatError, replyToChat, validateHistory } from "@/lib/openai";

export const runtime = "nodejs";
const MAX_BODY_BYTES = 256 * 1024;

export async function POST(request: Request) {
  try {
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
    const message = await replyToChat(messages);
    return Response.json(
      { message },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
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
