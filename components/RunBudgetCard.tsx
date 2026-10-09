import type { BudgetSnapshot } from "@/lib/run-budget";

const resources: Array<{ key: keyof BudgetSnapshot; label: string }> = [
  { key: "modelCalls", label: "Model calls" },
  { key: "tokenUnits", label: "Reserved tokens" },
  { key: "sandboxStarts", label: "Sandbox starts" },
];
const number = new Intl.NumberFormat("en-US");

export function RunBudgetCard({ used, limits, status }: {
  used: BudgetSnapshot | null;
  limits: BudgetSnapshot;
  status: "Running" | "Stopped" | "Completed" | "Ready" | "Per task";
}) {
  const exhausted = used && resources.some(({ key }) => used[key] >= limits[key]);
  return (
    <section className="run-budget" aria-label="Task budget">
      <div className="run-budget-heading">
        <strong>Task budget</strong>
        <span className={exhausted ? "run-budget-warning" : ""}>{exhausted ? "Limit reached" : status}</span>
      </div>
      {resources.map(({ key, label }) => (
        <div className="run-budget-resource" key={key}>
          <div>
            <span>{label}</span>
            <span>{used ? number.format(used[key]) : "—"} / {number.format(limits[key])}</span>
          </div>
          <progress aria-label={label} value={used?.[key] ?? 0} max={limits[key]} />
        </div>
      ))}
      <p>Failed attempts count. Reserved tokens are a safety allowance, not a dollar charge.</p>
    </section>
  );
}
