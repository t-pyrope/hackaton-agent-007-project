import "server-only";
import { ChatError } from "./openai";

export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    throw new ChatError("Cross-origin requests are not allowed.", 403);
}

export async function readJson(
  request: Request,
  limit: number,
): Promise<Record<string, unknown>> {
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json")
    throw new ChatError("Send JSON.", 415);
  const reader = request.body?.getReader();
  if (!reader) throw new ChatError("Missing request body.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      throw new ChatError("Request too large.", 413);
    }
    chunks.push(value);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString());
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new Error();
    return body;
  } catch {
    throw new ChatError("Invalid JSON.");
  }
}
