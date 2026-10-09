This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Victor: verified tools in Vercel Sandbox

Configure `OPENAI_API_KEY`, `OPENAI_MODEL` (defaults to `gpt-5.4-mini`), and a Neon
`DATABASE_URL`. Optional `TOOL_PROPOSAL_SECRET` signs confirmations; otherwise the
OpenAI key is used server-side for signing. Never use `NEXT_PUBLIC_` for these values.
For local Sandbox access, run `vercel link` and `vercel env pull .env.local` to obtain
`VERCEL_OIDC_TOKEN`; refresh it when expired. On Vercel the SDK authenticates
with deployment OIDC automatically. See the [Sandbox SDK reference](https://vercel.com/docs/sandbox/sdk-reference)
and [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs).

The existing `tools` table is retained; no migration is needed. On a new database,
apply `drizzle/0000_blue_kabuki.sql` or run `npm run db:migrate`. Drizzle uses Neon's
WebSocket Pool to support interactive transactions over port 443. All custom tools
share the current collection and its limit of ten (the built-in Compress PNG does
not count). A transaction advisory lock serializes builds across instances; the
signed proposal UUID is the tools primary key, so resending a confirmation returns
the same record. A busy lock times out after five seconds; retry after the running
build finishes. This prototype has no per-user collection/authentication model.

Chat returns English text and a validated proposal for algorithmic image tools,
including conversion, compression, aspect-preserving resize, padding/cropping,
masks, edge-connected color background removal, watermarks, logo compositing,
shadows, filters, region pixelation, collages and metadata stripping. AI processing
and external services are unsupported. Legacy grayscale, invert, stretching resize
and right-angle rotation retain their existing PNG contract. Other behaviors use
custom proposals with confirmed settings and input controls. Confirm & Build submits the signed, 30-minute proposal; no code is
generated before confirmation. Build progress is streamed as NDJSON: Writing Code,
Testing, Fixing, Installed. Installed is sent only after the database commits.
Up to three repairs follow the initial attempt. Failure rolls back without saving.

The CommonJS contract is:

```js
module.exports = async function ({
  inputPath,
  inputPaths,
  inputs,
  outputPath,
  outputFormat,
  parameters,
}) {
  // inputPath: first image, retained for existing tools.
  // inputPaths: uploaded paths in confirmed input order and upload order.
  // inputs: [{ id, paths }] for each confirmed image/images input control.
  // Write one static image in outputFormat to outputPath; return outputPath.
};
```

Allowed imports: `sharp`, `node:fs/promises` (limited readFile/writeFile/stat),
`node:path` (join/basename/extname), `node:assert/strict`. AST validation rejects
other imports, dynamic loading, environment access, dangerous reflective properties
and dynamic indexed properties. A restricted VM loader is a convenience layer;
the actual isolation boundary is Vercel's microVM, not Node's vm module.
Generated modules and tests execute exclusively in Sandbox, never in Next.js.

`sandbox-runtime/package.json` and its separate lockfile pin Sharp 0.35.5, including
Linux native packages. Each Sandbox uploads these files and runs `npm ci
--ignore-scripts`; only registry.npmjs.org is allowed during installation. The SDK
then sets `deny-all` before any generated code is uploaded/executed. No application
secrets or environment variables are passed to Sandbox. Sandboxes are nonpersistent
and stopped in finally. Limits: 1 vCPU / 2 GB VM RAM, 256 MB JavaScript heap,
120-second Sandbox lifetime, 60-second dependency install and 15-second command for
installed tool execution, 10 MB per file/output, up to ten input files (100 MB total),
16,777,216 decoded pixels per image. Inputs and outputs support PNG, JPEG, WebP
and AVIF. Custom proposals declare up to four image/images input controls; old
proposals without inputs default to one image. An optional outputFormat select
parameter enables format selection, with the proposal format as its default. During a
build, OpenAI requests, Sandbox lifetime and commands allow 750 seconds, sharing
one 750-second overall abort budget across all attempts. Database lock and statement
timeouts are 750 seconds, with an 800-second idle transaction timeout. The
Vercel route declares maxDuration 800 (deployment plan must support this).

Server logs labeled `Tool build timing` record `stage`, `durationMs`, `outcome`,
`buildId` and `attempt` for generation, Sandbox startup, dependency installation,
tests and tool installation, including failed operations.

Model tests run in one microVM. Independent verification uses a fresh microVM and a
trusted colored RGBA fixture plus secondary image fixtures for multi-image tools.
The server decodes the selected output format and enforces file/pixel limits; each
selectable format is executed independently. Legacy operations additionally check
dimensions, exact operation pixels and alpha against a trusted reference. Custom
effects rely on operation-specific model tests; independent decoding alone does
not prove effect correctness. Tests cannot forge the independent report. The actual results, failed attempts, and confirmed
proposal are saved in `test_report`. The UI loads persisted tools, renders their
settings and single/multiple upload controls, executes them through `/api/tools/run`,
and downloads results with the selected MIME type and extension. Region pixelation
uses numeric coordinates rather than a mouse selection overlay. JPEG export must
flatten transparency onto the confirmed background. PNG quality uses palette
quantization; compression cannot guarantee a smaller file for every input.

Development-only `GET /api/sandbox/check` returns `{stdout:"sandbox-ok\n",exitCode:0}`;
production returns 404. Run `node tests/victor-e2e.cjs` against the dev server for the
live connection → proposal → confirmation → generation/testing → Neon save →
idempotent retry → actual image processing → reload test. This live test installs
one real Black & White tool and consumes OpenAI/Sandbox usage. Results are written
to `/tmp/victor-e2e-report.json`.

Offline safeguards and the existing compression checks:
`node --test tests/victor-build.test.cjs tests/compress-png.test.cjs`.
After the live test, `node tests/sandbox-verification.cjs` checks the saved module in
fresh microVMs and confirms rejection of empty tests and an incorrect operation;
it does not install another tool. Report: `/tmp/victor-sandbox-verification.json`.

## Frankenstein task loop

The chat accepts one image and a result-oriented task. Each confirmed plan has at
most four sequential steps. Invalid plans get at most two model repairs within
the same run budget. Missing image tools are generated and tested before
registration; verified existing IDs are reused. Each step consumes the previous
image output. A new chat sends no previous conversation and reloads the database
registry. Multi-image composition in chat is currently unsupported.

Registry discovery is itself agent-built. When a real image task first needs
capability discovery, the agent writes a general search module and its tests.
Generated tests and independent searches run in credential-free microVMs before
installation in `registry_capabilities`. The table is created additively on first
use. The module has the explicit `{query, registry} -> string[]` interface and only
`registry:read` permission; its loader exposes no filesystem or network. Its code,
tests, version, permissions, failed repair history and passing report persist in
Neon. Later chats execute that same module in a fresh microVM. Search ranks the
registry for planning; the full registry remains available to avoid rebuilding on
lexical misses. Neither search results nor generated code can install image tools
or widen execution permissions. The search bootstrap installs after tests without
a human gate; image-tool installation remains behind the confirmed task plan.

A shared `RunBudget` spans discovery, planning, repairs and image execution using a
signed budget snapshot in the plan. Hard limits per run: eight model requests,
300,000 conservatively reserved token units, and 28 Sandbox starts. Reservations
include input UTF-8 bytes, maximum output/reasoning tokens and framing allowance;
failed requests are charged and reservations are never refunded. Checks occur
before API requests or microVM creation. These are resource caps, not an exact USD
meter: actual prices depend on the configured model and infrastructure plan.
Each Sandbox also has a lifetime/resource cap. Repeating a confirmed request is a
new bounded execution, while proposal IDs prevent reinstalling successful tools.
There is no account-wide billing quota or authentication in this prototype.

The chat shows individual test outcomes, failed attempts and run budget usage.
Model tests for custom image algorithms do not constitute an independent semantic
oracle; independent image decoding alone cannot prove every arbitrary effect.
Registry search has independent positive, compound and negative query checks.

Run the real two-session acceptance check against an already configured dev server:

```bash
TEST_BASE_URL=http://127.0.0.1:3000 node tests/frankenstein-live.cjs
```

It records the registry before the run, submits a photo-proof task, processes an
image, then submits a different task with no conversation history or manually
specified tool IDs. It requires two distinct generated tools, no new generation
in session two, persisted discovery reuse and independently checked image pixels
and dimensions. It consumes real API resources and installs missing capabilities.
It intentionally fails if the first task has no gap; do not delete or seed tools
to manufacture a pass. Every invocation writes a distinct `/tmp/frankenstein-live-*.json`
report, including failures, and successful session images. For a creation demo on
an already populated registry, use a genuinely new useful task.

For the 90-second video: show registry before the task; show the actual gap, test
results and installation; show the resulting photo; start a new chat and show
composition of two generated IDs with zero created tools. Waiting may be sped up;
keep failed attempts visible. Commit all new files before the repository freeze.
