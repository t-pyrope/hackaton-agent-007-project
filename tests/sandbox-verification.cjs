/* eslint-disable @typescript-eslint/no-require-imports, @next/next/no-assign-module-variable */
// All candidate code is executed remotely, never by this test process.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const { loadEnvConfig } = require("@next/env");
loadEnvConfig(process.cwd());
const { Pool, neonConfig } = require("@neondatabase/serverless");
neonConfig.webSocketConstructor = require("ws");

function load(file) {
  const source = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", source)(
    (name) => (name === "server-only" ? {} : require(name)),
    module,
    module.exports,
  );
  return module.exports;
}

const { testTool } = load("lib/sandbox.ts");

async function main() {
  const record = JSON.parse(
    fs.readFileSync("/tmp/victor-e2e-report.json", "utf8"),
  ).tool;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  let code;
  try {
    const result = await pool.query("select code from tools where id=$1", [
      record.id,
    ]);
    code = result.rows[0].code;
  } finally {
    await pool.end();
  }
  const tests =
    "module.exports=async function(run,assert,inputPath,outputPath,parameters){ const result=await run({inputPath,outputPath,parameters});assert.equal(result,outputPath); }";
  const passed = await testTool(
    code,
    tests,
    record.testReport.proposal,
    AbortSignal.timeout(100000),
  );
  assert(passed.passed, JSON.stringify(passed));
  console.log(
    "Final runner, fresh independent microVM and grayscale pixels: PASS",
  );
  const empty = await testTool(
    code,
    "module.exports=async function(){}",
    record.testReport.proposal,
    AbortSignal.timeout(100000),
  );
  assert(!empty.passed);
  assert(empty.results.some((r) => !r.passed && r.name === "Model tests"));
  console.log("Empty model tests rejected: PASS");
  const wrong =
    "const sharp=require('sharp');module.exports=async function({inputPath,outputPath}){await sharp(inputPath).png().toFile(outputPath);return outputPath;}";
  const incorrect = await testTool(
    wrong,
    tests,
    record.testReport.proposal,
    AbortSignal.timeout(100000),
  );
  assert(!incorrect.passed);
  assert(
    incorrect.results.some(
      (r) => !r.passed && r.name === "Independent output verification",
    ),
  );
  console.log("Wrong operation rejected independently: PASS");
  fs.writeFileSync(
    "/tmp/victor-sandbox-verification.json",
    JSON.stringify({ passed, empty, incorrect }, null, 2),
  );
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
