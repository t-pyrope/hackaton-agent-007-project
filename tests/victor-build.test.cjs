/* eslint-disable @typescript-eslint/no-require-imports, @next/next/no-assign-module-variable */
// Execute trusted server validation/orchestration only; generated code is never evaluated here.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");

function load(file, stubs = {}) {
  const source = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", source)(
    (name) => (name === "server-only" ? {} : stubs[name] || require(name)),
    module,
    module.exports,
  );
  return module.exports;
}

const { validateCode, validateUiSchema } = load("lib/generated-validation.ts");
const { validateProposal } = load("lib/tool-contract.ts");

const spec = {
  name: "Black & White",
  description: "Grayscale PNG",
  operation: "grayscale",
  width: 800,
  height: 800,
  angle: 0,
  outputFormat: "png",
};

test("AST rejects unsafe imports and indirect dynamic access", () => {
  for (const code of [
    "require('node:child_process')",
    "const r=require;r('sharp')",
    "import('sharp')",
    "process.env",
    "x.constructor('return process')()",
    "const {[name]:value}=x",
    "Object.getOwnPropertyDescriptor(x, key)",
    "x[name]",
    "eval('1')",
  ])
    assert.throws(() => validateCode(code), code);
  validateCode(
    "const sharp=require('sharp');module.exports=async function({inputPath,outputPath}){await sharp(inputPath).greyscale().png().toFile(outputPath);return outputPath;}",
  );
});

test("Proposal and UI validate semantics without JSON property order dependence", () => {
  assert.deepEqual(validateProposal(spec), spec);
  assert.throws(() => validateProposal({ ...spec, width: 99999 }));
  assert.throws(() => validateProposal({ ...spec, code: "anything" }));
  const ui = {
    output: { type: "image" },
    parameters: [],
    inputs: [{ required: true, type: "image", id: "image" }],
  };
  assert.deepEqual(validateUiSchema(JSON.stringify(ui), spec), ui);
  assert.throws(() =>
    validateUiSchema(
      JSON.stringify({ ...ui, parameters: [{ id: "extra" }] }),
      spec,
    ),
  );
});

class ChatError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function buildHarness({
  existing,
  n = 0,
  pass = true,
  failInsert = false,
} = {}) {
  let generations = 0,
    saves = 0,
    tests = 0,
    committed = false;
  const tx = {
    execute: async () => {},
    select: (fields) => ({
      from: () =>
        fields
          ? Promise.resolve([{ n }])
          : { where: async () => (existing ? [existing] : []) },
    }),
    insert: () => ({
      values: (value) => ({
        returning: async () => {
          saves++;
          if (failInsert) throw new Error("database failure");
          return [value];
        },
      }),
    }),
  };
  const { buildTool } = load("lib/tool-build.ts", {
    "./db": {
      db: {
        transaction: async (callback) => {
          const result = await callback(tx);
          committed = true;
          return result;
        },
      },
    },
    "@/db/schema": { tools: { id: "id" } },
    "./openai": {
      ChatError,
      generateTool: async () => {
        generations++;
        return { code: "code", tests: "tests", uiSchemaJson: "{}" };
      },
    },
    "./proposals": { verifyProposal: () => ({ id: "same-id", spec }) },
    "./generated-validation": {
      validateCode: () => {},
      validateUiSchema: () => ({
        inputs: [],
        parameters: [],
        output: { type: "image" },
      }),
    },
    "./sandbox": {
      testTool: async () => {
        tests++;
        return {
          passed: pass,
          results: [
            {
              name: "independent",
              passed: pass,
              error: pass ? undefined : "bad pixels",
            },
          ],
        };
      },
    },
  });
  return {
    run: () => buildTool("token", () => {}),
    state: () => ({ generations, saves, tests, committed }),
  };
}

process.env.DATABASE_URL ||= "test";

test("Server limit blocks generation at ten", async () => {
  const h = buildHarness({ n: 10 });
  await assert.rejects(h.run(), (e) => e.status === 409);
  assert.equal(h.state().generations, 0);
  assert.equal(h.state().saves, 0);
});

test("Same proposal returns existing record without generation", async () => {
  const existing = { id: "same-id" };
  const h = buildHarness({ existing, n: 10 });
  assert.deepEqual(await h.run(), existing);
  assert.equal(h.state().generations, 0);
});

test("Four failed attempts never save or commit", async () => {
  const h = buildHarness({ pass: false });
  await assert.rejects(h.run(), (e) => e.status === 422);
  assert.deepEqual(h.state(), {
    generations: 4,
    saves: 0,
    tests: 4,
    committed: false,
  });
});

test("Verified report saved once, including failed-attempt history", async () => {
  const h = buildHarness();
  const tool = await h.run();
  assert.equal(tool.testReport.passed, true);
  assert.equal(tool.testReport.attempts.length, 1);
  assert.deepEqual(h.state(), {
    generations: 1,
    saves: 1,
    tests: 1,
    committed: true,
  });
});

test("Database failure never triggers code repairs", async () => {
  const h = buildHarness({ failInsert: true });
  await assert.rejects(h.run(), /database failure/);
  assert.equal(h.state().generations, 1);
  assert.equal(h.state().committed, false);
});

const customSpec = {
  name: "Blur",
  description: "Gaussian blur with sigma; preserve alpha.",
  operation: "custom",
  outputFormat: "png",
  parameters: [
    {
      id: "sigma",
      type: "number",
      label: "Blur strength",
      default: 2,
      min: 0.3,
      max: 100,
      options: null,
    },
  ],
};
test("Custom algorithm proposals and confirmed UI settings", () => {
  assert.deepEqual(validateProposal(customSpec), customSpec);
  const ui = {
    inputs: [{ id: "image", type: "image", required: true }],
    parameters: [
      {
        id: "sigma",
        type: "number",
        label: "Blur strength",
        default: 2,
        min: 0.3,
        max: 100,
      },
    ],
    output: { type: "image" },
  };
  assert.deepEqual(validateUiSchema(JSON.stringify(ui), customSpec), ui);
  for (const changes of [
    { default: 200 },
    { min: 3 },
    { type: "invalid" },
    { id: "constructor" },
  ]) {
    assert.throws(() =>
      validateProposal({
        ...customSpec,
        parameters: [{ ...customSpec.parameters[0], ...changes }],
      }),
    );
  }
  assert.throws(() =>
    validateProposal({
      ...customSpec,
      parameters: customSpec.parameters.concat(customSpec.parameters),
    }),
  );
  assert.throws(() => validateProposal({ ...customSpec, outputFormat: "gif" }));
  assert.throws(() =>
    validateUiSchema(
      JSON.stringify({
        ...ui,
        parameters: [{ ...ui.parameters[0], default: 3 }],
      }),
      customSpec,
    ),
  );
  assert.deepEqual(
    validateProposal({ ...customSpec, parameters: [] }).parameters,
    [],
  );
});

test("Custom settings validate all supported UI types", () => {
  const { validateParameterValue } = load("lib/tool-contract.ts");
  for (const [type, value, invalid, options] of [
    ["number", 0.5, NaN, null],
    ["slider", 0.5, 2, null],
    ["boolean", true, "true", null],
    ["text", "caption", 3, null],
    ["color", "#123456", "red", null],
    ["select", "a", "b", [{ label: "A", value: "a" }]],
  ]) {
    const p = {
      id: "setting",
      label: "Setting",
      type,
      default: value,
      min: type === "number" || type === "slider" ? 0 : null,
      max: type === "number" || type === "slider" ? 1 : null,
      options,
    };
    validateProposal({ ...customSpec, parameters: [p] });
    assert.doesNotThrow(() => validateParameterValue(p, value));
    assert.throws(() => validateParameterValue(p, invalid));
  }
});

test("Pixel loops allow coerced numeric indices while rejecting dynamic property names", () => {
  validateCode(
    "module.exports=async function(){const pixels=Buffer.alloc(16);for(let i=0;i<pixels.length;i++){pixels[+i]=255-pixels[+(i+1)];}}",
  );
  for (const code of [
    "pixels[i]",
    "pixels['constructor']",
    "pixels[name]",
    "pixels[+process.env]",
    "x[+i].constructor",
  ])
    assert.throws(() => validateCode(code));
});

test("Custom sandbox checks format without assuming unchanged pixels or dimensions", async () => {
  const sharp = require("sharp");
  const output = await sharp({
    create: {
      width: 3,
      height: 2,
      channels: 4,
      background: { r: 10, g: 20, b: 30, alpha: 0.5 },
    },
  })
    .png()
    .toBuffer();
  let creates = 0;
  const { testTool } = load("lib/sandbox.ts", {
    "@vercel/sandbox": {
      Sandbox: {
        create: async () => {
          creates++;
          return {
            status: "running",
            writeFiles: async () => {},
            runCommand: async () => ({ exitCode: 0 }),
            updateNetworkPolicy: async () => {},
            readFileToBuffer: async () => output,
            stop: async () => {},
          };
        },
      },
    },
  });
  const report = await testTool("unused", "unused", customSpec);
  assert.equal(report.passed, true);
  assert.equal(creates, 2);
  assert(
    report.results.some(
      (r) => r.name === "Custom effect checked by model tests only",
    ),
  );
  const legacy = await testTool("unused", "unused", spec);
  assert.equal(legacy.passed, false);
  assert(legacy.results.some((r) => r.error?.includes("dimensions")));
});
