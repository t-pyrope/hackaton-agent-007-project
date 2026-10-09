/* eslint-disable @typescript-eslint/no-require-imports, @next/next/no-assign-module-variable */
// Trusted harness, executed only inside a credential-free microVM.
const vm = require("node:vm");
const fs = require("node:fs/promises");
const assert = require("node:assert/strict");
async function load(file, assertions = assert) {
  const module = { exports: {} };
  const context = vm.createContext({ module, require: (name) => {
    if (name === "node:assert/strict") return assertions;
    throw new Error("Discovery has no filesystem, network or image-library permissions.");
  } }, { codeGeneration: { strings: false, wasm: false } });
  new vm.Script(await fs.readFile(file, "utf8")).runInContext(context, { timeout: 1000 });
  assert.equal(typeof module.exports, "function");
  return module.exports;
}
(async () => {
  const input = JSON.parse(await fs.readFile("job/discovery-input.json", "utf8"));
  const run = await load("job/discovery.cjs");
  if (process.argv[2] === "tests") {
    let executions = 0, assertions = 0;
    const tracked = new Proxy(assert, {
      apply(target, receiver, args) { assertions++; return Reflect.apply(target, receiver, args); },
      get(target, key) { return typeof target[key] === "function" ? (...args) => {
        assertions++; return Reflect.apply(target[key], target, args);
      } : target[key]; },
    });
    const tests = await load("job/discovery-tests.cjs", tracked);
    await tests(async (value) => { executions++; return run(value); }, tracked);
    assert(executions > 0 && assertions > 0, "Tests must execute discovery and assert.");
  } else {
    const result = await run(input);
    assert(Array.isArray(result) && result.length <= input.registry.length);
    assert(result.every((id) => typeof id === "string" && input.registry.some((t) => t.id === id)));
    assert.equal(new Set(result).size, result.length);
    await fs.writeFile("job/discovery-output.json", JSON.stringify(result));
  }
})().catch((error) => { console.error(String(error)); process.exitCode = 1; });
