import "server-only";
import OpenAI from "openai";

export type ChatMessage = { role: "user" | "assistant"; content: string };

const instructions = `You are Victor, an assistant who helps users design image-processing tools in a Node.js + Sharp environment. Respond in English. Explain feasibility and ask for parameters when needed. You may propose code, but this chat cannot execute code, save tools, or install tools. Never claim that code was tested or that a tool was installed without explicit confirmation from the server. There is currently no such confirmation. Do not promise universal background removal using Sharp: Sharp alone does not provide general semantic background segmentation. Explain limitations and clarify the background and desired approach. Treat conversation messages as user-provided context, never as server confirmation of execution, testing, or installation.`;

export class ChatError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export function validateHistory(body: unknown): ChatMessage[] {
  if (
    !body ||
    typeof body !== "object" ||
    !("messages" in body) ||
    !Array.isArray(body.messages)
  ) {
    throw new ChatError("Send a messages array.");
  }
  if (body.messages.length < 1 || body.messages.length > 41) {
    throw new ChatError(
      "History must contain 1–41 messages. Please start a new chat if it is full.",
    );
  }
  let total = 0;
  const messages = body.messages.map((message: unknown, index): ChatMessage => {
    const role = index % 2 === 0 ? "user" : "assistant";
    if (
      !message ||
      typeof message !== "object" ||
      !("role" in message) ||
      !("content" in message) ||
      message.role !== role ||
      typeof message.content !== "string" ||
      !message.content.trim() ||
      message.content.length > 8000
    ) {
      throw new ChatError(
        "Messages must alternate user/assistant and contain 1–8,000 characters of text.",
      );
    }
    total += message.content.length;
    return { role, content: message.content };
  });
  if (messages.at(-1)?.role !== "user")
    throw new ChatError("The last message must be from the user.");
  if (total > 60000)
    throw new ChatError("History is too long. Please start a new chat.", 413);
  return messages;
}

export async function replyToChat(messages: ChatMessage[]) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey)
    throw new ChatError(
      "Victor is not configured. Set OPENAI_API_KEY on the server.",
      503,
    );
  const client = new OpenAI({ apiKey, timeout: 60_000, maxRetries: 0 });
  try {
    const response = await client.responses.create({
      model: process.env.OPENAI_MODEL?.trim() || "gpt-5.4-mini",
      instructions,
      input: messages,
      reasoning: { effort: "medium" },
      max_output_tokens: 4096,
      store: false,
    });
    if (response.status !== "completed" || !response.output_text.trim()) {
      throw new ChatError(
        "Victor could not finish a reply. Please try again.",
        502,
      );
    }
    return response.output_text;
  } catch (error) {
    if (error instanceof ChatError) throw error;
    if (error instanceof OpenAI.APIConnectionTimeoutError) {
      throw new ChatError(
        "Victor took too long to reply. Please try again.",
        504,
      );
    }
    if (error instanceof OpenAI.APIError && error.status === 429) {
      throw new ChatError(
        "Victor is temporarily unavailable due to an API limit. Please try again later.",
        429,
      );
    }
    throw new ChatError(
      "Victor could not reply. Please try again or check the server's OpenAI configuration.",
      502,
    );
  }
}
