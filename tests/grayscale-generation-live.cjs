/* eslint-disable @typescript-eslint/no-require-imports, @next/next/no-assign-module-variable */
// Real model + Sandbox verification. Does not install or change database records.
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
require("@next/env").loadEnvConfig(process.cwd());
function load(file) {
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  new Function("require", "module", "exports", source)((name) => {
    if (name === "server-only") return {};
    if (name.startsWith("@/")) return load(name.slice(2) + ".ts");
    if (name.startsWith(".")) return load(path.resolve(path.dirname(file), name + ".ts"));
    return require(name);
  }, module, module.exports);
  return module.exports;
}
async function main() {
  const { generateTool } = load("lib/openai.ts");
  const { testTool } = load("lib/sandbox.ts");
  const { validateCode, validateUiSchema } = load("lib/generated-validation.ts");
  const { RunBudget } = load("lib/run-budget.ts");
  const budget = new RunBudget();
  const spec = { name: "Black & White", description: "Make this photo black and white. Preserve its dimensions and transparency. Return PNG.", operation: "grayscale", width: 800, height: 800, angle: 0, outputFormat: "png" };
  const evidence = { passed: false, installed: false, attempts: [] };
  const reportPath = `/tmp/grayscale-generation-${Date.now()}.json`;
  let previous;
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      console.log(attempt ? "Fixing" : "Writing Code");
      const generated = await generateTool(spec, previous, undefined, budget);
      let report;
      try {
        validateCode(generated.code); validateCode(generated.tests); validateUiSchema(generated.uiSchemaJson, spec);
        report = await testTool(generated.code, generated.tests, spec, undefined, { attempt: attempt + 1 }, budget);
      } catch (error) { report = { passed: false, results: [{ name: "Artifact validation", passed: false, error: String(error) }] }; }
      evidence.attempts.push({ attempt: attempt + 1, ...generated, report });
      console.log(JSON.stringify(report));
      if (report.passed) { evidence.passed = true; return; }
      previous = { code: generated.code, tests: generated.tests, errors: JSON.stringify(report), verification: report };
    }
    throw new Error("Grayscale generation failed verification after four attempts.");
  } finally {
    evidence.budget = budget.snapshot();
    fs.writeFileSync(reportPath, JSON.stringify(evidence, null, 2));
    console.log("Evidence:", reportPath);
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
