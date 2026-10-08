import { eq } from "drizzle-orm";
import sharp from "sharp";
import { db } from "@/lib/db";
import { tools } from "@/db/schema";
import { executeTool, MAX_FILE_BYTES } from "@/lib/sandbox";
import { validateCode } from "@/lib/generated-validation";
import { validateProposal, validateParameterValue } from "@/lib/tool-contract";
import { sameOrigin } from "@/lib/request";

export const runtime = "nodejs";
export const maxDuration = 150;

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    // Read with an actual byte cap, including chunked uploads, before parsing multipart.
    const reader = request.body?.getReader();
    if (!reader) throw new Error("Upload an image.");
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_FILE_BYTES + 16000) {
        await reader.cancel();
        throw new Error("Image exceeds 10 MB.");
      }
      chunks.push(value);
    }
    const form = await new Response(Buffer.concat(chunks), {
      headers: { "Content-Type": request.headers.get("content-type") || "" },
    }).formData();
    const id = form.get("id");
    const file = form.get("image");
    if (
      typeof id !== "string" ||
      !/^[0-9a-f-]{36}$/.test(id) ||
      !(file instanceof File) ||
      file.size > MAX_FILE_BYTES
    )
      throw new Error("Send a tool ID and one image up to 10 MB.");
    const [tool] = await db.select().from(tools).where(eq(tools.id, id));
    if (!tool?.testReport.passed || !tool.testReport.proposal)
      throw new Error("Verified tool not found.");
    const spec = validateProposal(tool.testReport.proposal);
    for (const p of tool.uiSchema.parameters) {
      const value = form.get(p.id);
      if (value !== null) {
        if (spec.operation === "custom") {
          if (typeof value !== "string")
            throw new Error("Invalid tool settings.");
          const parameter = spec.parameters.find(
            (setting) => setting.id === p.id,
          );
          if (!parameter) throw new Error("Unknown tool setting.");
          let parsed: string | number | boolean = value;
          if (parameter.type === "number" || parameter.type === "slider") {
            if (!value.trim()) throw new Error("Invalid tool settings.");
            parsed = Number(value);
          }
          if (parameter.type === "boolean") {
            if (!["true", "false"].includes(value))
              throw new Error("Invalid tool settings.");
            parsed = value === "true";
          }
          validateParameterValue(parameter, parsed);
          parameter.default = parsed;
          continue;
        }
        const n = Number(value);
        if (
          !Number.isInteger(n) ||
          (p.id === "angle"
            ? ![0, 90, 180, 270].includes(n)
            : n < 1 || n > 4096)
        )
          throw new Error("Invalid tool settings.");
        if (p.id === "width") spec.width = n;
        if (p.id === "height") spec.height = n;
        if (p.id === "angle") spec.angle = n;
      }
    }
    const input = Buffer.from(await file.arrayBuffer());
    const metadata = await sharp(input, {
      limitInputPixels: 16777216,
    }).metadata();
    if (
      !["png", "jpeg", "webp"].includes(metadata.format || "") ||
      (metadata.pages || 1) > 1
    )
      throw new Error("Use one PNG, JPEG or WebP image.");
    validateCode(tool.code);
    const output = await executeTool(tool.code, spec, input);
    await sharp(output, { limitInputPixels: 16777216 }).raw().toBuffer();
    return new Response(new Uint8Array(output), {
      headers: {
        "Content-Type": "image/png",
        "Content-Disposition": 'attachment; filename="result.png"',
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Tool execution failed.",
      },
      { status: 400 },
    );
  }
}
