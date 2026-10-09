/* eslint-disable @typescript-eslint/no-require-imports, @next/next/no-assign-module-variable */
// Execute trusted server validation/orchestration only; generated code is never evaluated here.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const path = require("node:path");

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
    (name) => {
      if (name === "server-only") return {};
      if (stubs[name]) return stubs[name];
      const relative = path.resolve(path.dirname(file), name + ".ts");
      if (name.startsWith(".") && fs.existsSync(relative))
        return load(relative, stubs);
      return require(name);
    },
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

test("Extended contracts preserve old tools and accept named inputs and format controls", () => {
  const { proposalInputs, resolvedOutputFormat } = load("lib/tool-contract.ts");
  assert.deepEqual(proposalInputs(customSpec), [
    { id: "image", type: "image", required: true },
  ]);
  const inputs = [
    { id: "image", type: "image", required: true },
    { id: "logo", type: "image", required: true },
  ];
  const converter = {
    ...customSpec,
    inputs,
    parameters: [
      {
        id: "outputFormat",
        label: "Format",
        type: "select",
        default: "png",
        min: null,
        max: null,
        options: ["png", "jpeg", "webp", "avif"].map((value) => ({
          label: value,
          value,
        })),
      },
    ],
  };
  assert.deepEqual(validateProposal(converter), converter);
  const ui = {
    inputs,
    parameters: [{ ...converter.parameters[0] }],
    output: { type: "image" },
  };
  delete ui.parameters[0].min;
  delete ui.parameters[0].max;
  validateUiSchema(JSON.stringify(ui), converter);
  assert.throws(() =>
    validateUiSchema(
      JSON.stringify({ ...ui, inputs: inputs.slice(0, 1) }),
      converter,
    ),
  );
  for (const invalidInputs of [
    [],
    inputs.concat(inputs),
    [{ id: "constructor", type: "image", required: true }],
    [{ id: "logo", type: "image", required: false }],
  ]) {
    assert.throws(() =>
      validateProposal({ ...converter, inputs: invalidInputs }),
    );
  }
  assert.throws(() =>
    validateProposal({
      ...converter,
      parameters: [
        {
          ...converter.parameters[0],
          options: [{ label: "GIF", value: "gif" }],
        },
      ],
    }),
  );
  assert.throws(() =>
    validateProposal({
      ...converter,
      inputs: [{ id: "sigma", type: "image", required: true }],
      parameters: customSpec.parameters,
    }),
  );
  for (const format of ["png", "jpeg", "webp", "avif"]) {
    assert.equal(
      resolvedOutputFormat({ ...customSpec, outputFormat: format }),
      format,
    );
    assert.equal(
      resolvedOutputFormat({
        ...converter,
        parameters: [{ ...converter.parameters[0], default: format }],
      }),
      format,
    );
  }
});

function sandboxHarness(output) {
  const written = new Map();
  let readPath;
  const runtime = load("lib/sandbox.ts", {
    "@vercel/sandbox": {
      Sandbox: {
        create: async () => ({
          status: "running",
          writeFiles: async (files) =>
            files.forEach((file) => written.set(file.path, file.content)),
          runCommand: async () => ({ exitCode: 0 }),
          updateNetworkPolicy: async () => {},
          readFileToBuffer: async ({ path }) => {
            readPath = path;
            return output;
          },
          stop: async () => {},
        }),
      },
    },
  });
  return { ...runtime, written, readPath: () => readPath };
}

test("Runtime decodes all four formats, rejects mismatches and preserves input ordering", async () => {
  const sharp = require("sharp");
  const first = await sharp({
    create: { width: 4, height: 3, channels: 4, background: "red" },
  })
    .png()
    .toBuffer();
  const second = await sharp({
    create: { width: 2, height: 2, channels: 4, background: "blue" },
  })
    .png()
    .toBuffer();
  const inputs = [
    { id: "image", type: "image", required: true },
    { id: "logo", type: "image", required: true },
  ];
  for (const format of ["png", "jpeg", "webp", "avif"]) {
    const output = await sharp(first).toFormat(format).toBuffer();
    const h = sandboxHarness(output);
    await h.executeTool(
      "unused",
      { ...customSpec, inputs, outputFormat: format },
      [
        { id: "logo", files: [second] },
        { id: "image", files: [first] },
      ],
    );
    assert.equal(h.readPath(), `/vercel/sandbox/job/output.${format}`);
    const manifest = JSON.parse(
      h.written.get("/vercel/sandbox/job/inputs.json"),
    );
    assert.deepEqual(
      manifest.map((entry) => entry.id),
      ["image", "logo"],
    );
    assert(h.written.get(manifest[0].paths[0]).equals(first));
    assert(h.written.get(manifest[1].paths[0]).equals(second));
  }
  const h = sandboxHarness(first);
  await h.executeTool("unused", spec, first); // Existing Buffer signature remains supported.
  await assert.rejects(
    h.executeTool("unused", { ...customSpec, outputFormat: "jpeg" }, first),
    /format/,
  );
  await assert.rejects(
    h.executeTool("unused", { ...customSpec, inputs }, [
      { id: "image", files: [first] },
    ]),
    /input/,
  );
  await assert.rejects(
    h.executeTool("unused", customSpec, [
      { id: "image", files: [first, second] },
    ]),
    /input/,
  );
  await assert.rejects(
    h.executeTool(
      "unused",
      {
        ...customSpec,
        inputs: [{ id: "photos", type: "images", required: true }],
      },
      [{ id: "photos", files: Array(11).fill(first) }],
    ),
    /10 images/,
  );
});

test("Independent verification executes each selectable output format", async () => {
  const sharp = require("sharp");
  const formats = [];
  let currentFormat;
  const { testTool } = load("lib/sandbox.ts", {
    "@vercel/sandbox": {
      Sandbox: {
        create: async () => ({
          status: "running",
          writeFiles: async (files) => {
            const specFile = files.find((f) => f.path.endsWith("/spec.json"));
            if (specFile) {
              const spec = JSON.parse(specFile.content);
              currentFormat = spec.parameters.find(
                (p) => p.id === "outputFormat",
              ).default;
            }
          },
          runCommand: async ({ args }) => {
            if (args?.at(-1) === "execute") formats.push(currentFormat);
            return { exitCode: 0 };
          },
          updateNetworkPolicy: async () => {},
          stop: async () => {},
          readFileToBuffer: async () =>
            sharp({
              create: { width: 2, height: 2, channels: 4, background: "red" },
            })
              .toFormat(currentFormat)
              .toBuffer(),
        }),
      },
    },
  });
  const report = await testTool("unused", "unused", {
    ...customSpec,
    inputs: [{ id: "image", type: "image", required: true }],
    parameters: [
      {
        id: "outputFormat",
        type: "select",
        label: "Format",
        default: "png",
        min: null,
        max: null,
        options: ["png", "jpeg", "webp", "avif"].map((value) => ({
          label: value,
          value,
        })),
      },
    ],
  });
  assert.equal(report.passed, true, JSON.stringify(report));
  assert.deepEqual(formats, ["png", "jpeg", "webp", "avif"]);
});

test("Run API accepts AVIF and multiple images, returns selected MIME and rejects invalid uploads", async () => {
  const sharp = require("sharp");
  const { proposalInputs, MAX_FILE_BYTES } = {
    ...load("lib/tool-contract.ts"),
    MAX_FILE_BYTES: 10 * 1024 * 1024,
  };
  const png = await sharp({
    create: { width: 3, height: 2, channels: 4, background: "red" },
  })
    .png()
    .toBuffer();
  const avif = await sharp(png).avif().toBuffer();
  const contract = load("lib/tool-contract.ts");
  let called;
  let current = {
    ...customSpec,
    inputs: [{ id: "photos", type: "images", required: true }],
    outputFormat: "avif",
    parameters: [],
  };
  const { POST } = load("app/api/tools/run/route.ts", {
    "@/lib/db": {
      db: {
        select: () => ({
          from: () => ({
            where: async () => [
              {
                code: "module.exports=async function(){}",
                testReport: {
                  passed: true,
                  proposal: structuredClone(current),
                },
                uiSchema: {
                  inputs: proposalInputs(current),
                  parameters: current.parameters ?? [],
                },
              },
            ],
          }),
        }),
      },
    },
    "@/db/schema": { tools: { id: "id" } },
    "@/lib/request": { sameOrigin: () => {} },
    "@/lib/tool-contract": contract,
    "@/lib/generated-validation": { validateCode },
    "@/lib/sandbox": {
      MAX_FILE_BYTES,
      MAX_INPUT_FILES: 10,
      MAX_TOTAL_BYTES: MAX_FILE_BYTES * 10,
      executeTool: async (_code, spec, input) => {
        called = { spec, input };
        return spec.outputFormat === "avif" ? avif : png;
      },
    },
  });
  async function request(entries) {
    called = null;
    const form = new FormData();
    form.set("id", "00000000-0000-0000-0000-000000000001");
    for (const [key, data] of entries)
      form.append(key, new Blob([data]), "image");
    return POST(
      new Request("http://localhost/api/tools/run", {
        method: "POST",
        body: form,
      }),
    );
  }
  const result = await request([
    ["photos", png],
    ["photos", avif],
  ]);
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("content-type"), "image/avif");
  assert.equal(
    result.headers.get("content-disposition"),
    'attachment; filename="result.avif"',
  );
  assert.equal(called.input[0].files.length, 2);
  for (const entries of [
    [],
    [["other", png]],
    [["photos", Buffer.from("broken")]],
    Array(11).fill(["photos", png]),
  ]) {
    assert.equal((await request(entries)).status, 400);
    assert.equal(called, null);
  }
  current = spec;
  assert.equal((await request([["image", png]])).status, 200);
  assert.equal(
    (
      await request([
        ["image", png],
        ["image", png],
      ])
    ).status,
    400,
  );
});

test("Trusted runner passes legacy and multi-image arguments and writes selected output", async () => {
  const sharp = require("sharp");
  const os = require("node:os");
  const { execFileSync } = require("node:child_process");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "victor-runner-"));
  try {
    fs.mkdirSync(path.join(root, "job"));
    const runner = fs
      .readFileSync("sandbox-runtime/runner.cjs", "utf8")
      .replace(
        'const ROOT = "/vercel/sandbox";',
        `const ROOT = ${JSON.stringify(root)};`,
      )
      .replace(
        'require("sharp")',
        `require(${JSON.stringify(require.resolve("sharp"))})`,
      );
    fs.writeFileSync(path.join(root, "runner.cjs"), runner);
    const image = await sharp({
      create: { width: 7, height: 5, channels: 4, background: "red" },
    })
      .png()
      .toBuffer();
    const logo = await sharp({
      create: { width: 2, height: 2, channels: 4, background: "blue" },
    })
      .png()
      .toBuffer();
    fs.writeFileSync(path.join(root, "job/input-0.png"), image);
    fs.writeFileSync(path.join(root, "job/input-1.png"), logo);
    const toolCode = `const sharp=require('sharp'); module.exports=async function({inputPath,inputPaths,inputs,outputPath,outputFormat}) {
      let image=sharp(inputPath);
      if(inputPaths.length>1) image=image.composite([{input:inputs.find(i=>i.id==='logo').paths[0],left:0,top:0}]);
      await image.toFormat(outputFormat).toFile(outputPath); return outputPath;
    }`;
    validateCode(toolCode);
    fs.writeFileSync(path.join(root, "job/tool.cjs"), toolCode);
    fs.writeFileSync(
      path.join(root, "job/inputs.json"),
      JSON.stringify([
        { id: "image", paths: [path.join(root, "job/input-0.png")] },
        { id: "logo", paths: [path.join(root, "job/input-1.png")] },
      ]),
    );
    fs.writeFileSync(
      path.join(root, "job/spec.json"),
      JSON.stringify({ ...customSpec, outputFormat: "webp", parameters: [] }),
    );
    execFileSync(process.execPath, ["runner.cjs", "execute"], { cwd: root });
    const output = await sharp(path.join(root, "job/output.webp"))
      .raw()
      .toBuffer();
    assert(output[2] > output[0], "Logo contributes blue pixels");
    fs.writeFileSync(
      path.join(root, "job/inputs.json"),
      JSON.stringify([
        { id: "image", paths: [path.join(root, "job/input-0.png")] },
      ]),
    );
    fs.writeFileSync(path.join(root, "job/spec.json"), JSON.stringify(spec));
    // Original installed signature needs only inputPath/outputPath/parameters.
    fs.writeFileSync(
      path.join(root, "job/tool.cjs"),
      "const sharp=require('sharp');module.exports=async function({inputPath,outputPath}){await sharp(inputPath).greyscale().png().toFile(outputPath);return outputPath;}",
    );
    execFileSync(process.execPath, ["runner.cjs", "execute"], { cwd: root });
    const legacy = await sharp(path.join(root, "job/output.png"))
      .raw()
      .toBuffer();
    assert.equal(legacy[0], legacy[1]);
    assert.equal(legacy[1], legacy[2]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Pre-existing custom parameters named outputFormat keep their PNG contract", () => {
  const { resolvedOutputFormat } = load("lib/tool-contract.ts");
  const old = {
    ...customSpec,
    parameters: [
      {
        id: "outputFormat",
        type: "text",
        label: "Caption",
        default: "old caption",
        min: null,
        max: null,
        options: null,
      },
    ],
  };
  validateProposal(old);
  assert.equal(resolvedOutputFormat(old), "png");
});
