/* eslint-disable @typescript-eslint/no-require-imports */
// Real services, no seeded generated code; keeps failures in the evidence file.
const assert = require("node:assert/strict");
const sharp = require("sharp");
const fs = require("node:fs/promises");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:3001";
const evidence = { startedAt: new Date().toISOString(), sessions: [], passed: false };
const reportPath = process.env.TEST_REPORT_PATH || `/tmp/frankenstein-live-${Date.now()}.json`;
async function registry() {
  const response = await fetch(base + "/api/tools");
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  return body.tools.map(({ id, name, testReport }) => ({ id, name, passed: testReport.passed }));
}
async function session(task, width, height, border, color) {
  const record = { task, events: [] }; evidence.sessions.push(record);
  const reply = await fetch(base + "/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ imageTask: true, messages: [{ role: "user", content: task }] }) });
  const data = await reply.json();
  assert.equal(reply.status, 200, JSON.stringify(data));
  assert(data.plan, JSON.stringify(data));
  record.discovery = data.discovery;
  record.steps = data.plan.steps;
  record.budget = data.budget;
  console.log("Plan:", data.plan.steps.map((s) => ({ id: s.toolId, capability: s.capability })));
  const image = await sharp({ create: { width, height, channels: 4, background: { r: 190, g: 50, b: 20, alpha: 1 } } }).png().toBuffer();
  const form = new FormData();
  form.set("image", new Blob([image], { type: "image/png" }), "photo.png");
  form.set("confirmed", "true"); form.set("token", data.plan.token);
  const response = await fetch(base + "/api/tasks/run", { method: "POST", body: form });
  assert.equal(response.status, 200, await (response.status === 200 ? Promise.resolve("") : response.text()));
  let pending = ""; const decoder = new TextDecoder();
  for await (const chunk of response.body) {
    pending += decoder.decode(chunk, { stream: true });
    let newline;
    while ((newline = pending.indexOf("\n")) !== -1) {
      const event = JSON.parse(pending.slice(0, newline)); pending = pending.slice(newline + 1);
      if (event.result) {
        const output = Buffer.from(event.result.base64, "base64");
        const pixels = await sharp(output).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        assert.equal(pixels.info.width, width + 2 * border);
        assert.equal(pixels.info.height, height + 2 * border);
        assert.deepEqual([...pixels.data.subarray(0, 4)], [color, color, color, 255]);
        const center = ((border + 1) * pixels.info.width + border + 1) * 4;
        assert.equal(pixels.data[center], pixels.data[center + 1]);
        assert.equal(pixels.data[center], pixels.data[center + 2]);
        record.result = { ...event.result, base64: undefined };
        await fs.writeFile(`/tmp/frankenstein-session-${evidence.sessions.length}.png`, output);
      }
      const safe = { ...event, result: event.result ? { ...event.result, base64: undefined } : undefined };
      record.events.push(safe);
      console.log(event.status || (event.tests ? JSON.stringify(event.tests) : event.error || (event.result ? "Result received" : "Budget " + JSON.stringify(event.budget))));
      if (event.error) throw new Error(event.error);
    }
  }
  assert(record.result, "No completed result");
  return record;
}
async function main() {
  evidence.before = await registry();
  console.log("Registry before:", evidence.before);
  const first = await session("Prepare a monochrome photo proof as PNG: first make the photo black and white preserving dimensions and alpha; then add an opaque white border of exactly 12 pixels on all four sides, without resizing the original image. Keep border width and color adjustable for future proofs.", 84, 60, 12, 255);
  evidence.afterCreation = await registry();
  // This request carries no prior conversation and no manual tool IDs.
  const second = await session("For a different monochrome print proof, add an opaque black border of exactly 4 pixels on all sides without resizing the photo, and make the photo black and white preserving its alpha. Export PNG. Reuse available capabilities.", 48, 32, 4, 0);
  assert(second.steps.every((s) => s.toolId && !s.toolId.startsWith("builtin:")), "Fresh session must use generated tools only");
  assert(new Set(second.steps.map((s) => s.toolId)).size >= 2, "Must compose two generated capabilities");
  assert.equal(second.result.created, 0);
  assert(second.result.reused >= 2);
  assert.equal(second.discovery.created, false);
  assert(!second.events.some((e) => ["Writing Code", "Fixing", "Installed"].includes(e.status)));
  evidence.afterComposition = await registry();
  assert.deepEqual(evidence.afterComposition, evidence.afterCreation);
  assert(first.result.created > 0, "Creation demo requires a real missing capability, not only reuse");
  evidence.passed = true;
}
main().catch((error) => { evidence.error = error.message; console.error(error.message); process.exitCode = 1; }).finally(async () => { await fs.writeFile(reportPath, JSON.stringify(evidence, null, 2)); console.log("Evidence:", reportPath); });
