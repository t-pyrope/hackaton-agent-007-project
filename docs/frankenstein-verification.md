# Frankenstein acceptance — 2026-10-09

Real OpenAI, Neon and Vercel Sandbox were used. No generated implementation was
seeded by the team. The existing Black & White and background-removal capabilities
were already in the image registry before this request; the creation demo extended
that registry with Add Border. The built-in Compress PNG is team-written and was
not counted as a generated capability in either image composition.

## Verified scenario

1. First real task: prepare a monochrome photo proof with an adjustable white border.
2. The agent-created registry search was generated and tested in microVMs, installed
   in Neon and reused for discovery. Its successful build required four attempts;
   the first three failed assertions. Earlier failed requests are retained too.
3. Planner selected existing Black & White and identified missing Add Border.
4. Initial border code was rejected for forbidden prototype access. The agent repaired
   it; model tests and independent output decoding passed before installation.
5. The task reused one image tool and created one. The result was independently
   checked for expected 108 × 84 dimensions, white border pixels and grayscale content.
6. A second request carried only a new user task, with no prior conversation or
   manually wired IDs. It asked for a different proof with a 4-pixel black border.
7. The planner chose the same Black & White ID plus the newly generated Add Border ID.
   Result: **two reused, zero created**. No Writing Code, Fixing or Installed events
   occurred. Registry contents before/after composition were identical.
8. The second result passed independent checks for 56 × 40 dimensions, black border
   pixels and grayscale content. Registry discovery was reused without rebuilding.

The signed plan carried shared budget reservations from planning into execution.
First successful image task: 3 model requests, 115,503 reserved token units and 5
Sandbox starts. Second task: 1 model request, 19,899 reserved token units and 3
Sandbox starts. Limits are 8 / 300,000 / 28. These are conservative resource
reservations, not measured dollar charges or exact token consumption.

## Evidence

- [Successful run](evidence/frankenstein-live.json), with pre-run registry, both plans,
  installation/test reports, failed repair history, statuses and budget snapshots.
- [Earlier failed runs](evidence/failed-runs.json). Failures were not converted into
  installs; search generation and numeric-plan validation required fixes.
- [First result](evidence/session-1.png) and [second result](evidence/session-2.png).
- Local safeguards: 30 tests passed; TypeScript and ESLint passed.
- Production build passed; bundle tracing includes both trusted runners and runtime
  dependency files for chat, tasks/run, tools/build and tools/run.

## Remaining limits and submission

The search is lexical and advisory; it is not semantic retrieval. All generated
image code is sandboxed; custom image effect correctness still partly relies on
model-written tests. Chat composition accepts a single image flowing through up
to four steps. Accounts, account-wide spending quotas and operator rollback are
not implemented. Registry search has a persisted version but no upgrade UI.

A 90-second demo video has not been recorded. Suggested recording: show the actual
pre-run registry and task; retain the rejected prototype attempt; show passing
tests and output; open a fresh chat and show reuse of both IDs with zero created.
For a new creation recording, choose a useful task that actually exposes a new gap:
the border capability now exists, so replaying the same task should reuse it.
Do not delete or seed code to fake an empty registry. Commit new files before freeze.
