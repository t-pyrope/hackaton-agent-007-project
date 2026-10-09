import { RunBudget, RUN_LIMITS } from "@/lib/run-budget";
import { verifyProposal } from "@/lib/proposals";
import { compressEntry } from "@/lib/builtin-registry";
import {
  compressPng,
  type CompressionMode,
} from "@/lib/image-tools/compress-png";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { tools } from "@/db/schema";
import { sameOrigin } from "@/lib/request";
import { loadRegistry, verifyPlan, validateSteps } from "@/lib/task-plan";
import { stepSpec } from "@/lib/task-contract";
import { buildTool } from "@/lib/tool-build";
import { validateCode } from "@/lib/generated-validation";
import { executeTool, MAX_FILE_BYTES } from "@/lib/sandbox";
import {
  proposalInputs,
  resolvedOutputFormat,
  FORMAT_MIME,
} from "@/lib/tool-contract";
export const runtime = "nodejs";
export const maxDuration = 800;
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const reader = request.body?.getReader();
    if (!reader) throw new Error("Upload an image.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_FILE_BYTES + 150000) {
        await reader.cancel();
        throw new Error("Image must be 10 MB or smaller.");
      }
      chunks.push(value);
    }
    const form = await new Response(Buffer.concat(chunks), {
      headers: { "Content-Type": request.headers.get("content-type") || "" },
    }).formData();
    if (form.get("confirmed") !== "true")
      throw new Error("Confirm the plan first.");
    const plan = verifyPlan(form.get("token"));
    const budget = new RunBudget(plan.budget);
    const registry = await loadRegistry();
    const steps = validateSteps(plan.steps, registry);
    const file = form.get("image");
    if (!(file instanceof File) || !file.size || file.size > MAX_FILE_BYTES)
      throw new Error("Upload one image, up to 10 MB.");
    let output: Buffer = Buffer.from(await file.arrayBuffer());
    const metadata = await sharp(output, {
      limitInputPixels: 16777216,
    }).metadata();
    if (
      !["png", "jpeg", "webp", "heif"].includes(metadata.format || "") ||
      (metadata.format === "heif" && metadata.compression !== "av1") ||
      (metadata.pages || 1) > 1
    )
      throw new Error("Use a static PNG, JPEG, WebP or AVIF image.");
    await sharp(output, { limitInputPixels: 16777216 }).raw().toBuffer();
    const encoder = new TextEncoder();
    let closed = false;
    const signal = AbortSignal.any([
      request.signal,
      AbortSignal.timeout(780000),
    ]);
    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: unknown) => {
          if (!closed) {
            try {
              controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
            } catch {
              closed = true;
            }
          }
        };
        let created = 0,
          reused = 0;
        try {
          send({ budget: budget.snapshot(), limits: RUN_LIMITS });
          // Resolve/build every missing tool before execution; only verified builds are registered.
          const resolved = [];
          for (let i = 0; i < steps.length; i++) {
            signal.throwIfAborted();
            const step = steps[i];
            if (step.toolId === compressEntry.id) {
              reused++;
              resolved.push({
                tool: null,
                spec: stepSpec(step, [compressEntry]),
              });
              continue;
            }
            let tool;
            if (step.toolId === null) {
              const buildId = verifyProposal(plan.builds[i]).id;
              const [alreadyInstalled] = await db
                .select()
                .from(tools)
                .where(eq(tools.id, buildId));
              tool = await buildTool(
                plan.builds[i],
                (status, attempt) => send({ step: i + 1, status, attempt, budget: budget.snapshot(), limits: RUN_LIMITS }),
                signal,
                budget,
                (report) => send({ step: i + 1, tests: report, budget: budget.snapshot(), limits: RUN_LIMITS }),
              );
              if (alreadyInstalled) reused++;
              else created++;
              const { code: _code, ...record } = tool;
              void _code;
              send({ step: i + 1, status: "Installed", tool: record });
            } else {
              [tool] = await db
                .select()
                .from(tools)
                .where(eq(tools.id, step.toolId));
              reused++;
            }
            if (!tool?.testReport.passed || !tool.testReport.proposal)
              throw new Error("Verified tool no longer available.");
            const spec = stepSpec(
              { ...step, toolId: tool.id, proposal: null },
              [
                {
                  id: tool.id,
                  name: tool.name,
                  spec: tool.testReport.proposal,
                },
              ],
            );
            validateCode(tool.code);
            resolved.push({ tool, spec });
          }
          let format = resolvedOutputFormat(resolved[0].spec);
          for (let i = 0; i < resolved.length; i++) {
            signal.throwIfAborted();
            const { tool, spec } = resolved[i];
            send({
              step: i + 1,
              status: "Running " + (tool?.name || compressEntry.name),
            });
            const inputs = proposalInputs(spec);
            const primary = inputs.find((d) => d.required) || inputs[0];
            if (tool) {
              output = await executeTool(
                tool.code,
                spec,
                inputs.map((d) => ({
                  id: d.id,
                  files: d.id === primary.id ? [output] : [],
                })),
                signal,
                undefined,
                budget,
              );
            } else {
              if (spec.operation !== "custom")
                throw new Error("Invalid compression settings.");
              const settings = Object.fromEntries(
                spec.parameters.map((p) => [p.id, p.default]),
              );
              output = (
                await compressPng(
                  output,
                  settings.mode as CompressionMode,
                  Number(settings.quality),
                )
              ).output;
            }
            format = resolvedOutputFormat(spec);
            send({ step: i + 1, status: "Step completed" });
            send({ budget: budget.snapshot(), limits: RUN_LIMITS });
          }
          send({
            result: {
              base64: output.toString("base64"),
              mime: FORMAT_MIME[format],
              filename: "victor-result." + format,
              reused,
              created,
            },
          });
        } catch (error) {
          send({
            error: error instanceof Error ? error.message : "Task failed.",
            reused,
            created,
            budget: budget.snapshot(),
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
      { error: error instanceof Error ? error.message : "Task failed." },
      { status: 400 },
    );
  }
}
