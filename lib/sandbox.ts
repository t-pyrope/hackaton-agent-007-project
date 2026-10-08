import "server-only";
import { Sandbox } from "@vercel/sandbox";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Writable } from "node:stream";
import sharp from "sharp";
import type { Proposal } from "./tool-contract";
import type { Tool } from "@/db/schema";

const ROOT = "/vercel/sandbox";
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

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

async function runtimeSandbox(signal?: AbortSignal) {
  const sandbox = await Sandbox.create({
    persistent: false,
    timeout: 120_000,
    resources: { vcpus: 1 },
    networkPolicy: { allow: ["registry.npmjs.org"] },
    signal,
  });
  try {
    const files = await Promise.all(
      ["package.json", "package-lock.json", "runner.cjs"].map(async (name) => ({
        path: `${ROOT}/${name}`,
        content: await readFile(join(process.cwd(), "sandbox-runtime", name)),
      })),
    );
    await sandbox.writeFiles(files);
    const install = await sandbox.runCommand({
      cmd: "npm",
      args: ["ci", "--ignore-scripts", "--no-audit", "--no-fund"],
      cwd: ROOT,
      timeoutMs: 60_000,
      signal,
    });
    if (install.exitCode !== 0)
      throw new Error(
        "Sandbox dependency installation failed: " +
          (await install.stderr()).slice(-2000),
      );
    await sandbox.updateNetworkPolicy("deny-all");
    await sandbox.runCommand({
      cmd: "mkdir",
      args: ["-p", `${ROOT}/job`],
      timeoutMs: 5000,
    });
    return sandbox;
  } catch (error) {
    await sandbox.stop();
    throw error;
  }
}

async function run(sandbox: Sandbox, mode: string, signal?: AbortSignal) {
  // Linux file-size limit covers Sharp's native writes too. SDK kills the process at 15s.
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
    timeoutMs: 15_000,
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
  input: Buffer,
  signal?: AbortSignal,
) {
  if (input.length > MAX_FILE_BYTES) throw new Error("Input exceeds 10 MB.");
  const sandbox = await runtimeSandbox(signal);
  try {
    await sandbox.writeFiles([
      { path: ROOT + "/job/tool.cjs", content: Buffer.from(code) },
      {
        path: ROOT + "/job/spec.json",
        content: Buffer.from(JSON.stringify(spec)),
      },
      { path: ROOT + "/job/input.png", content: input },
    ]);
    await run(sandbox, "execute", signal);
    const result = await sandbox.readFileToBuffer({
      path: ROOT + "/job/output.png",
    });
    if (!result || result.length > MAX_FILE_BYTES)
      throw new Error("Missing or oversized output.");
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
): Promise<Tool["testReport"]> {
  const results: Tool["testReport"]["results"] = [];
  const sandbox = await runtimeSandbox(signal);
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
    await sandbox.writeFiles([
      { path: ROOT + "/job/tool.cjs", content: Buffer.from(code) },
      { path: ROOT + "/job/tests.cjs", content: Buffer.from(tests) },
      {
        path: ROOT + "/job/spec.json",
        content: Buffer.from(JSON.stringify(spec)),
      },
      { path: ROOT + "/job/input.png", content: fixture },
    ]);
    try {
      await run(sandbox, "tests", signal);
      results.push({ name: "Model tests (Sandbox exit 0)", passed: true });
    } catch (error) {
      results.push({
        name: "Model tests",
        passed: false,
        error: String(error).slice(0, 8000),
      });
    }
    await sandbox.stop();
    try {
      // Fresh microVM: generated tests cannot alter the module, fixture or trusted runner.
      const output = await executeTool(code, spec, fixture, signal);
      if (!output || output.length > MAX_FILE_BYTES)
        throw new Error("Missing/oversized output.");
      const metadata = await sharp(output, {
        limitInputPixels: 16777216,
      }).metadata();
      if (metadata.format !== "png") throw new Error("Output must be PNG.");
      results.push({
        name: "Independent PNG decoding and file limit",
        passed: true,
      });
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
