/* eslint-disable @typescript-eslint/no-require-imports */
// Live integration test: uses configured services, installs one verified Black & White tool.
const assert = require("node:assert/strict");
const sharp = require("sharp");
const fs = require("node:fs/promises");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:3000";

async function post(path, body) {
  return fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function main() {
  const check = await fetch(base + "/api/sandbox/check");
  assert.equal(check.status, 200);
  const connection = await check.json();
  assert.equal(connection.stdout, "sandbox-ok\n");
  assert.equal(connection.exitCode, 0);
  console.log("Sandbox connection: PASS");
  const chat = await post("/api/chat", {
    messages: [
      {
        role: "user",
        content:
          "Create a Black & White tool. Convert a single image to grayscale, preserve dimensions and transparency, output PNG. Use no parameters.",
      },
    ],
  });
  const reply = await chat.json();
  assert.equal(chat.status, 200, JSON.stringify(reply));
  assert.equal(reply.proposal.spec.operation, "grayscale");
  assert(reply.message);
  console.log("Structured chat proposal: PASS");
  const unconfirmed = await post("/api/tools/build", {
    token: reply.proposal.token,
  });
  assert.equal(unconfirmed.status, 400);
  const tampered = await post("/api/tools/build", {
    token: reply.proposal.token + "x",
    confirmed: true,
  });
  assert.equal(tampered.status, 400);
  console.log("Missing/tampered confirmation: PASS");
  const build = await post("/api/tools/build", {
    token: reply.proposal.token,
    confirmed: true,
  });
  assert.equal(build.status, 200);
  const reader = build.body.getReader();
  const decoder = new TextDecoder();
  let all = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const part = decoder.decode(value, { stream: true });
    all += part;
    for (const line of part.trim().split("\n")) {
      try {
        const e = JSON.parse(line);
        console.log(e.status || e.error);
      } catch {}
    }
  }
  const events = all
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const last = events.at(-1);
  assert(!last.error, last.error);
  assert.equal(last.status, "Installed");
  assert(last.tool.testReport.passed);
  assert(last.tool.testReport.results.every((r) => r.passed));
  const tool = last.tool;
  assert(!tool.code);
  console.log("Sandbox build and persisted testReport: PASS");
  const retry = await post("/api/tools/build", {
    token: reply.proposal.token,
    confirmed: true,
  });
  const retryEvents = (await retry.text()).trim().split("\n").map(JSON.parse);
  assert.equal(retryEvents.at(-1).tool.id, tool.id);
  assert.equal(retryEvents.length, 1);
  console.log("Idempotent retry: PASS");
  const raw = Buffer.from([
    255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 255, 210, 50, 120, 0, 20, 40, 60,
    255, 230, 200, 80, 128,
  ]);
  const input = await sharp(raw, { raw: { width: 3, height: 2, channels: 4 } })
    .png()
    .toBuffer();
  const form = new FormData();
  form.set("id", tool.id);
  form.set("image", new Blob([input], { type: "image/png" }), "input.png");
  const run = await fetch(base + "/api/tools/run", {
    method: "POST",
    body: form,
  });
  assert.equal(run.status, 200, run.status === 200 ? "" : await run.text());
  const output = Buffer.from(await run.arrayBuffer());
  const actual = await sharp(output).ensureAlpha().raw().toBuffer();
  const expected = await sharp(await sharp(input).greyscale().png().toBuffer())
    .ensureAlpha()
    .raw()
    .toBuffer();
  assert(actual.equals(expected));
  console.log("Installed tool execution: PASS");
  const list = await (await fetch(base + "/api/tools")).json();
  assert.equal(list.tools.filter((t) => t.id === tool.id).length, 1);
  console.log("Neon reload and no duplicate: PASS");
  await fs.writeFile(
    "/tmp/victor-e2e-report.json",
    JSON.stringify(
      {
        connection,
        tool,
        events: events.map(({ status, attempt }) => ({ status, attempt })),
        checks: [
          "connection",
          "proposal",
          "confirmation",
          "build",
          "idempotency",
          "execution",
          "persistence",
        ],
      },
      null,
      2,
    ),
  );
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
