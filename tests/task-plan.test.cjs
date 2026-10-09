/* eslint-disable @typescript-eslint/no-require-imports, @next/next/no-assign-module-variable */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
function load(file, stubs = {}) {
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  new Function("require", "module", "exports", source)(
    (name) => {
      if (name === "server-only") return {};
      if (name in stubs) return stubs[name];
      if (name.startsWith("@/")) return load(name.slice(2) + ".ts", stubs);
      if (name.startsWith("."))
        return load(path.resolve(path.dirname(file), name + ".ts"), stubs);
      return require(name);
    },
    module,
    module.exports,
  );
  return module.exports;
}
const contract = load("lib/task-contract.ts");
const spec = {
  name: "Grayscale",
  description: "Grayscale PNG",
  operation: "grayscale",
  width: 800,
  height: 800,
  angle: 0,
  outputFormat: "png",
};
const registry = [{ id: "verified", name: spec.name, spec }];
const step = {
  toolId: "verified",
  capability: "Make black and white",
  parameters: [],
  proposal: null,
};
test("plans reject invented IDs, excessive steps, unknown settings and multi-image dependencies", () => {
  assert.deepEqual(contract.validateSteps([step], registry), [step]);
  assert.throws(() =>
    contract.validateSteps([{ ...step, toolId: "invented" }], registry),
  );
  assert.throws(() => contract.validateSteps(Array(5).fill(step), registry));
  assert.throws(() =>
    contract.validateSteps(
      [{ ...step, parameters: [{ id: "width", value: 100 }] }],
      registry,
    ),
  );
  assert.throws(() =>
    contract.validateSteps(
      [
        {
          ...step,
          toolId: null,
          proposal: {
            name: "Blend",
            description: "Blend two images",
            operation: "custom",
            outputFormat: "png",
            parameters: [],
            inputs: [
              { id: "a", type: "image", required: true },
              { id: "b", type: "image", required: true },
            ],
          },
        },
      ],
      registry,
    ),
  );
});
test("plan confirmation rejects tampering and expires", () => {
  process.env.TOOL_PROPOSAL_SECRET = "test-only-secret";
  const plans = load("lib/task-plan.ts", {
    "./db": {},
    "@/db/schema": {},
    "./proposals": { issueProposal: () => ({ token: "build-token" }) },
  });
  const issued = plans.issuePlan([step]);
  assert.deepEqual(plans.verifyPlan(issued.token).steps, [step]);
  assert.throws(() => plans.verifyPlan(issued.token + "tamper"));
  const original = Date.now;
  Date.now = () => original() + 31 * 60000;
  try {
    assert.throws(() => plans.verifyPlan(issued.token));
  } finally {
    Date.now = original;
  }
});
test("execution chains actual outputs and stops on failed steps without a result", async () => {
  const sharp = require("sharp");
  const input = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "red" },
  })
    .png()
    .toBuffer();
  const intermediate = await sharp(input).greyscale().png().toBuffer();
  const final = await sharp(intermediate).negate().png().toBuffer();
  for (const fail of [false, true]) {
    const received = [];
    const route = load("app/api/tasks/run/route.ts", {
      "@/lib/proposals": { verifyProposal: () => ({ id: "build" }) },
      "@/lib/builtin-registry": { compressEntry: { id: "builtin" } },
      "@/lib/image-tools/compress-png": {},
      "@/lib/db": {
        db: {
          select: () => ({
            from: () => ({
              where: async () => [
                {
                  id: "verified",
                  name: "Grayscale",
                  code: "safe",
                  testReport: { passed: true, proposal: spec },
                },
              ],
            }),
          }),
        },
      },
      "@/db/schema": { tools: { id: "id" } },
      "drizzle-orm": { eq: () => null },
      "@/lib/request": { sameOrigin: () => {} },
      "@/lib/task-plan": {
        loadRegistry: async () => registry,
        verifyPlan: () => ({ steps: [step, step], builds: [null, null] }),
        validateSteps: contract.validateSteps,
      },
      "@/lib/task-contract": contract,
      "@/lib/tool-build": {
        buildTool: () => {
          throw new Error("unexpected build");
        },
      },
      "@/lib/generated-validation": { validateCode: () => {} },
      "@/lib/tool-contract": load("lib/tool-contract.ts"),
      "@/lib/sandbox": {
        MAX_FILE_BYTES: 10 * 1024 * 1024,
        executeTool: async (_code, _spec, inputs) => {
          received.push(inputs[0].files[0]);
          if (fail && received.length === 2) throw new Error("Sandbox failure");
          return received.length === 1 ? intermediate : final;
        },
      },
    });
    const form = new FormData();
    form.set("confirmed", "true");
    form.set("token", "signed");
    form.set("image", new Blob([input]), "input.png");
    const response = await route.POST(
      new Request("http://localhost/api/tasks/run", {
        method: "POST",
        body: form,
      }),
    );
    const events = (await response.text()).trim().split("\n").map(JSON.parse);
    assert.equal(received.length, 2);
    assert.deepEqual(received[1], intermediate);
    if (fail) {
      assert.equal(events.at(-1).error, "Sandbox failure");
      assert.ok(!events.some((e) => e.result));
    } else {
      assert.deepEqual(
        Buffer.from(events.at(-1).result.base64, "base64"),
        final,
      );
      assert.equal(events.at(-1).result.reused, 2);
      assert.equal(events.at(-1).result.created, 0);
    }
  }
});

const { RunBudget, RUN_LIMITS, BudgetExceeded } = load("lib/run-budget.ts");
test("shared budget survives plan boundary and rejects before excess model or sandbox work", () => {
  const budget = new RunBudget();
  budget.model({ task: "plan" }, 6000);
  const resumed = new RunBudget(budget.snapshot());
  while (resumed.snapshot().modelCalls < RUN_LIMITS.modelCalls) resumed.model("small", 100);
  const before = resumed.snapshot();
  assert.throws(() => resumed.model("small", 100), BudgetExceeded);
  assert.deepEqual(resumed.snapshot(), before);
  const tokens = new RunBudget({ modelCalls: 0, tokenUnits: RUN_LIMITS.tokenUnits - 1, sandboxStarts: 0 });
  assert.throws(() => tokens.model("x", 100), BudgetExceeded);
  for (let i = 0; i < RUN_LIMITS.sandboxStarts; i++) budget.sandbox();
  assert.throws(() => budget.sandbox(), BudgetExceeded);
  assert.throws(() => new RunBudget({ modelCalls: -1, tokenUnits: 0, sandboxStarts: 0 }));
});
test("exhausted budgets block real adapters before model request or Sandbox creation", async () => {
  let modelRequests = 0, sandboxCreates = 0;
  const budget = new RunBudget({ modelCalls: RUN_LIMITS.modelCalls, tokenUnits: 0, sandboxStarts: RUN_LIMITS.sandboxStarts });
  class Client {
    constructor() { this.responses = { create: () => { modelRequests++; throw new Error("Unexpected request"); } }; }
  }
  process.env.OPENAI_API_KEY = "test-only-key";
  const openai = load("lib/openai.ts", { openai: Client });
  await assert.rejects(() => openai.generateTool(spec, undefined, undefined, budget), BudgetExceeded);
  await assert.rejects(() => openai.planImageTask([{ role: "user", content: "grayscale" }], registry, budget), BudgetExceeded);
  const sandbox = load("lib/sandbox.ts", { "@vercel/sandbox": { Sandbox: { create: () => { sandboxCreates++; throw new Error("Unexpected sandbox"); } } } });
  await assert.rejects(() => sandbox.runtimeSandbox(undefined, undefined, budget), BudgetExceeded);
  assert.equal(modelRequests, 0);
  assert.equal(sandboxCreates, 0);
});
test("planner repairs invalid numeric overrides within the shared call budget", async () => {
  const border = { name: "Border", description: "Add border", operation: "custom", outputFormat: "png", inputs: [{ id: "image", type: "image", required: true }], parameters: [{ id: "border", label: "Border", type: "number", default: 4, min: 0, max: 100, options: null }] };
  const entries = [{ id: "border", name: "Border", spec: border }];
  let calls = 0;
  class Client {
    constructor() { this.responses = { create: async () => { calls++; return { status: "completed", output_text: JSON.stringify({ message: "Add a border", steps: [{ toolId: "border", capability: "Border", proposal: null, parameters: [{ id: "border", value: calls === 1 ? "8" : 8 }] }] }) }; } }; }
  }
  const planner = load("lib/openai.ts", { openai: Client });
  const budget = new RunBudget();
  const result = await planner.planImageTask([{ role: "user", content: "Add an 8 pixel border" }], entries, budget);
  assert.equal(result.steps[0].parameters[0].value, 8);
  assert.equal(calls, 2);
  assert.equal(budget.snapshot().modelCalls, 2);
});
