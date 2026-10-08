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
