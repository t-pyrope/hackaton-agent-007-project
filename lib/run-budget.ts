/** Conservative reservations are never refunded, including failed requests. */
export const RUN_LIMITS = Object.freeze({ modelCalls: 8, tokenUnits: 300000, sandboxStarts: 28 });
export type BudgetSnapshot = { modelCalls: number; tokenUnits: number; sandboxStarts: number };
export class BudgetExceeded extends Error {}
export class RunBudget {
  private used: BudgetSnapshot;
  constructor(initial?: BudgetSnapshot) {
    this.used = { modelCalls: 0, tokenUnits: 0, sandboxStarts: 0, ...initial };
    for (const key of Object.keys(RUN_LIMITS) as Array<keyof BudgetSnapshot>) {
      if (!Number.isInteger(this.used[key]) || this.used[key] < 0 || this.used[key] > RUN_LIMITS[key])
        throw new BudgetExceeded("Invalid run budget.");
    }
  }
  model(input: unknown, outputTokens: number) {
    // UTF-8 bytes overestimate text tokens; reserve extra for schema/message framing.
    const units = Buffer.byteLength(JSON.stringify(input)) + outputTokens + 8192;
    if (this.used.modelCalls + 1 > RUN_LIMITS.modelCalls || this.used.tokenUnits + units > RUN_LIMITS.tokenUnits)
      throw new BudgetExceeded("Run budget exhausted before model call. Start a smaller task.");
    this.used.modelCalls++;
    this.used.tokenUnits += units;
  }
  sandbox() {
    if (this.used.sandboxStarts >= RUN_LIMITS.sandboxStarts)
      throw new BudgetExceeded("Run sandbox budget exhausted.");
    this.used.sandboxStarts++;
  }
  snapshot(): BudgetSnapshot { return { ...this.used }; }
}
