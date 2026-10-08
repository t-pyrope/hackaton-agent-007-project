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

Chat returns English text and a validated proposal for grayscale, invert, exact
resize or right-angle rotation. Unsupported operations get an explanation without
a build button. Confirm & Build submits the signed, 30-minute proposal; no code is
generated before confirmation. Build progress is streamed as NDJSON: Writing Code,
Testing, Fixing, Installed. Installed is sent only after the database commits.
Up to three repairs follow the initial attempt. Failure rolls back without saving.

The CommonJS contract is:

```js
module.exports = async function ({ inputPath, outputPath, parameters }) {
  // Read the supplied file, write one PNG to outputPath, return outputPath.
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
120-second Sandbox lifetime, 60-second install, 15-second command, 10 MB input/output,
16,777,216 decoded pixels; build has a 270-second overall abort budget and the
Vercel route declares maxDuration 300 (deployment plan must support this).

Model tests run in one microVM. Independent verification uses a fresh microVM and a
trusted colored RGBA fixture; the server decodes the returned PNG and checks format,
dimensions, exact operation pixels and preserved alpha against a trusted reference.
Tests cannot forge this report. The actual results, failed attempts, and confirmed
proposal are saved in `test_report`. The UI loads persisted tools, renders their
settings, executes them through `/api/tools/run`, and downloads PNG results.

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
