import "server-only";
import { RunBudget, BudgetExceeded } from "./run-budget";
import { BUILD_TIMEOUT_MS, timedStage } from "./build-timing";
import { Sandbox } from "@vercel/sandbox";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Writable } from "node:stream";
import sharp from "sharp";
import {
  proposalInputs,
  resolvedOutputFormat,
  type Proposal,
} from "./tool-contract";
import type { Tool } from "@/db/schema";

const ROOT = "/vercel/sandbox";
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_INPUT_FILES = 10;
export const MAX_TOTAL_BYTES = MAX_FILE_BYTES * MAX_INPUT_FILES;
export type ToolInput = { id: string; files: Buffer[] };

function normalizeInputs(
  spec: Proposal,
  input: Buffer | ToolInput[],
): ToolInput[] {
  const supplied = Buffer.isBuffer(input)
    ? [{ id: "image", files: [input] }]
    : input;
  const definitions = proposalInputs(spec);
  if (
    supplied.some((i) => !definitions.some((d) => d.id === i.id)) ||
    new Set(supplied.map((i) => i.id)).size !== supplied.length
  )
    throw new Error("Unknown or duplicate image input.");
  const ordered = definitions.map((d) => ({
    id: d.id,
    files: supplied.find((i) => i.id === d.id)?.files ?? [],
  }));
  let count = 0,
    bytes = 0;
  for (const [index, entry] of ordered.entries()) {
    const definition = definitions[index];
    if (
      (definition.required && !entry.files.length) ||
      (definition.type === "image" && entry.files.length > 1)
    )
      throw new Error("Missing or invalid image input.");
    for (const file of entry.files) {
      if (
        !Buffer.isBuffer(file) ||
        !file.length ||
        file.length > MAX_FILE_BYTES
      )
        throw new Error("Input exceeds 10 MB or is empty.");
      count++;
      bytes += file.length;
    }
  }
  if (!count || count > MAX_INPUT_FILES || bytes > MAX_TOTAL_BYTES)
    throw new Error("Upload at most 10 images.");
  return ordered;
}

function inputFiles(input: ToolInput[]) {
  let index = 0;
  const manifest = input.map((entry) => ({
    id: entry.id,
    paths: entry.files.map(
      () =>
        ROOT +
        (index++ === 0 ? "/job/input.png" : `/job/input-${index - 1}.png`),
    ),
  }));
  const files = input.flatMap((entry, i) =>
    entry.files.map((content, j) => ({ path: manifest[i].paths[j], content })),
  );
  return [
    ...files,
    {
      path: ROOT + "/job/inputs.json",
      content: Buffer.from(JSON.stringify(manifest)),
    },
  ];
}

export async function checkSandboxConnection() {
  const sandbox = await Sandbox.create({
    persistent: false,
    timeout: 30_000,
    resources: { vcpus: 1 },
    networkPolicy: "deny-all",
  });
  try {
    const result = await sandbox.runCommand({
      cmd: "node",
      args: ["-e", "console.log('sandbox-ok')"],
      timeoutMs: 10_000,
    });
    return { stdout: await result.stdout(), exitCode: result.exitCode };
  } finally {
    if (sandbox.status !== "stopped") await sandbox.stop();
  }
}

export async function runtimeSandbox(
  signal?: AbortSignal,
  context?: Record<string, unknown>,
  budget?: RunBudget,
) {
  budget?.sandbox();
  const buildTimeout = context ? BUILD_TIMEOUT_MS : undefined;
  const sandbox = await timedStage(
    "sandbox-start",
    () =>
      Sandbox.create({
        persistent: false,
        timeout: buildTimeout ?? 120_000,
        resources: { vcpus: 1 },
        networkPolicy: { allow: ["registry.npmjs.org"] },
        signal,
      }),
    context,
  );
  try {
    const files = await Promise.all(
      ["package.json", "package-lock.json", "runner.cjs", "discovery-runner.cjs"].map(async (name) => ({
        path: `${ROOT}/${name}`,
        content: await readFile(join(process.cwd(), "sandbox-runtime", name)),
      })),
    );
    await sandbox.writeFiles(files);
    await timedStage(
      "sandbox-dependencies",
      async () => {
        const install = await sandbox.runCommand({
          cmd: "npm",
          args: ["ci", "--ignore-scripts", "--no-audit", "--no-fund"],
          cwd: ROOT,
          timeoutMs: buildTimeout ?? 60_000,
          signal,
        });
        if (install.exitCode !== 0)
          throw new Error(
            "Sandbox dependency installation failed: " +
              (await install.stderr()).slice(-2000),
          );
      },
      context,
    );
    await sandbox.updateNetworkPolicy("deny-all");
    await sandbox.runCommand({
      cmd: "mkdir",
      args: ["-p", `${ROOT}/job`],
      timeoutMs: buildTimeout ?? 5000,
      signal,
    });
    return sandbox;
  } catch (error) {
    await sandbox.stop();
    throw error;
  }
}

async function run(
  sandbox: Sandbox,
  mode: string,
  signal?: AbortSignal,
  context?: Record<string, unknown>,
) {
  // Linux file-size limit covers Sharp's native writes too. Builds share the overall deadline.
  let bytes = 0;
  let logs = "";
  const sink = new Writable({
    write(chunk, _encoding, callback) {
      bytes += chunk.length;
      if (bytes <= 16000) logs += chunk.toString();
      callback();
    },
  });
  const result = await sandbox.runCommand({
    cmd: "bash",
    args: [
      "-c",
      'ulimit -f 10240; exec node --max-old-space-size=256 runner.cjs "$1"',
      "victor",
      mode,
    ],
    cwd: ROOT,
    timeoutMs: context ? BUILD_TIMEOUT_MS : 15_000,
    signal,
    stdout: sink,
    stderr: sink,
  });
  if (result.exitCode !== 0)
    throw new Error(
      `Sandbox ${mode} exited ${result.exitCode}: ${logs.slice(-8000)}`,
    );
  return result.exitCode;
}

export async function executeTool(
  code: string,
  spec: Proposal,
  input: Buffer | ToolInput[],
  signal?: AbortSignal,
  context?: Record<string, unknown>,
  budget?: RunBudget,
) {
  const normalized = normalizeInputs(spec, input);
  const format = resolvedOutputFormat(spec);
  const sandbox = await runtimeSandbox(signal, context, budget);
  try {
    await sandbox.writeFiles([
      { path: ROOT + "/job/tool.cjs", content: Buffer.from(code) },
      {
        path: ROOT + "/job/spec.json",
        content: Buffer.from(JSON.stringify(spec)),
      },
      ...inputFiles(normalized),
    ]);
    await run(sandbox, "execute", signal, context);
    const result = await sandbox.readFileToBuffer({
      path: ROOT + `/job/output.${format}`,
    });
    if (!result || result.length > MAX_FILE_BYTES)
      throw new Error("Missing or oversized output.");
    const metadata = await sharp(result, {
      limitInputPixels: 16777216,
    }).metadata();
    if (
      metadata.format !== (format === "avif" ? "heif" : format) ||
      (metadata.pages || 1) !== 1 ||
      (format === "avif" && metadata.compression !== "av1")
    )
      throw new Error("Output must match the selected static image format.");
    await sharp(result, { limitInputPixels: 16777216 }).raw().toBuffer();
    return result;
  } finally {
    if (sandbox.status !== "stopped") await sandbox.stop();
  }
}

export async function testTool(
  code: string,
  tests: string,
  spec: Proposal,
  signal?: AbortSignal,
  context?: Record<string, unknown>,
  budget?: RunBudget,
): Promise<Tool["testReport"]> {
  const results: Tool["testReport"]["results"] = [];
  const sandbox = await runtimeSandbox(signal, context, budget);
  try {
    const width = 7,
      height = 5;
    const raw = Buffer.alloc(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      raw[i * 4] = (i * 47) % 256;
      raw[i * 4 + 1] = (i * 83 + 31) % 256;
      raw[i * 4 + 2] = (i * 19 + 119) % 256;
      raw[i * 4 + 3] = i % 4 === 0 ? 128 : 255;
    }
    const fixture = await sharp(raw, { raw: { width, height, channels: 4 } })
      .png()
      .toBuffer();
    const secondaryFixture = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 4,
        background: { r: 240, g: 10, b: 30, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    const testInputs = proposalInputs(spec).map((d, index) => ({
      id: d.id,
      files: Array.from({ length: d.type === "images" ? 3 : 1 }, (_, j) =>
        index === 0 && j === 0 ? fixture : secondaryFixture,
      ),
    }));
    await sandbox.writeFiles([
      { path: ROOT + "/job/tool.cjs", content: Buffer.from(code) },
      { path: ROOT + "/job/tests.cjs", content: Buffer.from(tests) },
      {
        path: ROOT + "/job/spec.json",
        content: Buffer.from(JSON.stringify(spec)),
      },
      ...inputFiles(testInputs),
    ]);
    try {
      await timedStage(
        "sandbox-tests",
        () => run(sandbox, "tests", signal, context),
        context,
      );
      results.push({ name: "Model tests (Sandbox exit 0)", passed: true });
    } catch (error) {
      if (error instanceof BudgetExceeded) throw error;
      results.push({
        name: "Model tests",
        passed: false,
        error: String(error).slice(0, 8000),
      });
    }
    await sandbox.stop();
    try {
      // Fresh microVM: generated tests cannot alter the module, fixture or trusted runner.
      const output = await timedStage(
        "independent-tests",
        () => executeTool(code, spec, testInputs, signal, context, budget),
        context,
      );
      if (!output || output.length > MAX_FILE_BYTES)
        throw new Error("Missing/oversized output.");
      const metadata = await sharp(output, {
        limitInputPixels: 16777216,
      }).metadata();
      if (
        metadata.format !==
        (resolvedOutputFormat(spec) === "avif"
          ? "heif"
          : resolvedOutputFormat(spec))
      )
        throw new Error("Unexpected output format.");
      results.push({
        name: "Independent image decoding and file limit",
        passed: true,
      });
      if (spec.operation === "custom") {
        const formatControl =
          spec.inputs && spec.parameters.find((p) => p.id === "outputFormat");
        for (const option of formatControl?.options ?? []) {
          if (option.value === resolvedOutputFormat(spec)) continue;
          const variant = {
            ...spec,
            parameters: spec.parameters.map((p) =>
              p.id === "outputFormat" ? { ...p, default: option.value } : p,
            ),
          };
          await executeTool(code, variant, testInputs, signal, context, budget);
          results.push({
            name: `Independent ${option.value.toUpperCase()} decoding and file limit`,
            passed: true,
          });
        }
        // Arbitrary algorithms have no trusted universal pixel oracle.
        results.push({
          name: "Custom effect checked by model tests only",
          passed: true,
        });
        return { passed: results.every((r) => r.passed), results };
      }
      const actual = await sharp(output, { limitInputPixels: 16777216 })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      let reference = sharp(fixture);
      if (spec.operation === "grayscale") reference = reference.greyscale();
      if (spec.operation === "invert")
        reference = reference.negate({ alpha: false });
      if (spec.operation === "resize")
        reference = reference.resize(spec.width, spec.height, { fit: "fill" });
      if (spec.operation === "rotate") reference = reference.rotate(spec.angle);
      const expected = await reference.png().toBuffer();
      const expectedRaw = await sharp(expected)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      if (
        actual.info.width !== expectedRaw.info.width ||
        actual.info.height !== expectedRaw.info.height
      )
        throw new Error("Unexpected image dimensions.");
      results.push({ name: "Independent dimensions", passed: true });
      if (!actual.data.equals(expectedRaw.data))
        throw new Error("Pixels/alpha do not match the confirmed operation.");
      results.push({
        name: "Independent operation pixels and alpha",
        passed: true,
      });
    } catch (error) {
      if (error instanceof BudgetExceeded) throw error;
      results.push({
        name: "Independent output verification",
        passed: false,
        error: String(error).slice(0, 8000),
      });
    }
    return { passed: results.every((r) => r.passed), results };
  } finally {
    if (sandbox.status !== "stopped") await sandbox.stop();
  }
}
