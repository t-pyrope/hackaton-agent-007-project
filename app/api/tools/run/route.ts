import { eq } from "drizzle-orm";
import sharp from "sharp";
import { db } from "@/lib/db";
import { tools } from "@/db/schema";
import {
  executeTool,
  MAX_FILE_BYTES,
  MAX_INPUT_FILES,
  MAX_TOTAL_BYTES,
} from "@/lib/sandbox";
import { validateCode } from "@/lib/generated-validation";
import {
  validateProposal,
  validateParameterValue,
  proposalInputs,
  resolvedOutputFormat,
  FORMAT_MIME,
} from "@/lib/tool-contract";
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
      if (size > MAX_TOTAL_BYTES + 64000) {
        await reader.cancel();
        throw new Error("Upload exceeds 100 MB.");
      }
      chunks.push(value);
    }
    const form = await new Response(Buffer.concat(chunks), {
      headers: { "Content-Type": request.headers.get("content-type") || "" },
    }).formData();
    const id = form.get("id");
    if (typeof id !== "string" || !/^[0-9a-f-]{36}$/.test(id))
      throw new Error("Send a valid tool ID.");
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
    const definitions = proposalInputs(spec);
    let count = 0;
    for (const [key, value] of form.entries()) {
      if (value instanceof File && !definitions.some((d) => d.id === key))
        throw new Error("Unknown image input.");
    }
    const input = [];
    for (const definition of definitions) {
      const files = form.getAll(definition.id);
      if (
        (definition.required && !files.length) ||
        (definition.type === "image" && files.length > 1)
      )
        throw new Error("Missing or invalid image input.");
      const buffers = [];
      for (const file of files) {
        if (!(file instanceof File) || !file.size || file.size > MAX_FILE_BYTES)
          throw new Error("Each image must be 1 byte–10 MB.");
        if (++count > MAX_INPUT_FILES)
          throw new Error("Upload at most 10 images.");
        const buffer = Buffer.from(await file.arrayBuffer());
        const metadata = await sharp(buffer, {
          limitInputPixels: 16777216,
        }).metadata();
        if (
          !["png", "jpeg", "webp", "heif"].includes(metadata.format || "") ||
          (metadata.format === "heif" && metadata.compression !== "av1") ||
          (metadata.pages || 1) > 1
        )
          throw new Error("Use static PNG, JPEG, WebP or AVIF images.");
        buffers.push(buffer);
      }
      input.push({ id: definition.id, files: buffers });
    }
    const format = resolvedOutputFormat(spec);
    validateCode(tool.code);
    const output = await executeTool(tool.code, spec, input);
    await sharp(output, { limitInputPixels: 16777216 }).raw().toBuffer();
    return new Response(new Uint8Array(output), {
      headers: {
        "Content-Type": FORMAT_MIME[format],
        "Content-Disposition": `attachment; filename="result.${format}"`,
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
