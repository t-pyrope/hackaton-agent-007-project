import "server-only";

export const BUILD_TIMEOUT_MS = 750_000;

export async function timedStage<T>(
  stage: string,
  operation: () => Promise<T>,
  context: Record<string, unknown> = {},
): Promise<T> {
  const started = performance.now();
  let outcome = "failed";
  try {
    const result = await operation();
    outcome = "completed";
    return result;
  } finally {
    console.info("Tool build timing", {
      ...context,
      stage,
      outcome,
      durationMs: Math.round(performance.now() - started),
    });
  }
}
