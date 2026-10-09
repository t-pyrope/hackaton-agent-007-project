/* eslint-disable @typescript-eslint/no-require-imports, @next/next/no-assign-module-variable */
// Trusted harness. This file is uploaded, never executed by Next.js.
const vm = require("node:vm");
const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const sharp = require("sharp");

sharp.cache(false);
sharp.concurrency(1);

const ROOT = "/vercel/sandbox";

function safePath(p) {
  if (typeof p !== "string" || !path.resolve(p).startsWith(ROOT + "/job/"))
    throw new Error("File path outside job directory.");
  return p;
}

const limitedFs = Object.freeze({
  readFile: async (p) => {
    const s = await fs.stat(safePath(p));
    if (s.size > 10 * 1024 * 1024) throw new Error("File too large.");
    return fs.readFile(p);
  },
  writeFile: async (p, data) => {
    if (Buffer.byteLength(data) > 10 * 1024 * 1024)
      throw new Error("File too large.");
    return fs.writeFile(safePath(p), data);
  },
  stat: (p) => fs.stat(safePath(p)),
});

async function load(file, assertionLibrary = assert) {
  const module = { exports: {} };
  const context = vm.createContext(
    {
      module,
      Buffer,
      require: (name) => {
        if (name === "sharp") return sharp;
        if (name === "node:fs/promises") return limitedFs;
        if (name === "node:path")
          return Object.freeze({
            join: path.join,
            basename: path.basename,
            extname: path.extname,
          });
        if (name === "node:assert/strict") return assertionLibrary;
        throw new Error("Module not allowed: " + name);
      },
    },
    { codeGeneration: { strings: false, wasm: false } },
  );
  new vm.Script(await fs.readFile(file, "utf8"), {
    filename: file,
  }).runInContext(context, { timeout: 1000 });
  if (typeof module.exports !== "function")
    throw new Error("module.exports must be an async function.");
  return module.exports;
}

(async () => {
  const spec = JSON.parse(await fs.readFile("job/spec.json", "utf8"));
  const run = await load("job/tool.cjs");
  const parameters =
    spec.operation === "custom"
      ? Object.fromEntries(spec.parameters.map((p) => [p.id, p.default]))
      : {
          width: spec.width,
          height: spec.height,
          angle: spec.angle,
        };
  const inputs = JSON.parse(await fs.readFile("job/inputs.json", "utf8"));
  const inputPaths = inputs.flatMap((input) => input.paths);
  const inputPath = inputPaths[0];
  const outputFormat = spec.inputs
    ? parameters.outputFormat || spec.outputFormat
    : spec.outputFormat;
  assert(
    ["png", "jpeg", "webp", "avif"].includes(outputFormat),
    "Unsupported output format.",
  );
  if (process.argv[2] === "tests") {
    let assertions = 0;
    let executions = 0;
    const trackedAssert = new Proxy(assert, {
      apply(target, receiver, args) {
        assertions++;
        return Reflect.apply(target, receiver, args);
      },
      get(target, key) {
        const value = target[key];
        return typeof value === "function"
          ? (...args) => {
              assertions++;
              return Reflect.apply(value, target, args);
            }
          : value;
      },
    });
    const test = await load("job/tests.cjs", trackedAssert);
    await test(
      async (...args) => {
        executions++;
        return run(...args);
      },
      trackedAssert,
      inputPath,
      ROOT + `/job/model-test.${outputFormat}`,
      parameters,
      inputPaths,
      inputs,
      outputFormat,
    );
    assert(executions > 0, "Model tests must execute the generated module.");
    assert(assertions > 0, "Model tests must perform at least one assertion.");
  } else {
    const outputPath = ROOT + `/job/output.${outputFormat}`;
    const result = await run({
      inputPath,
      inputPaths,
      inputs,
      outputFormat,
      outputPath,
      parameters,
    });
    assert.equal(result, outputPath, "Module must return outputPath.");
    const stat = await fs.lstat(outputPath);
    assert(
      stat.isFile() &&
        !stat.isSymbolicLink() &&
        stat.size > 0 &&
        stat.size <= 10 * 1024 * 1024,
      "Output must be a regular file of at most 10 MB.",
    );
  }
})().catch((error) => {
  console.error(String(error.stack || error));
  process.exitCode = 1;
});
