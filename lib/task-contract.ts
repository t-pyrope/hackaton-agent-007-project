import {
  proposalInputs,
  validateProposal,
  validateParameterValue,
  type Proposal,
} from "./tool-contract";
export type RegistryEntry = { id: string; name: string; spec: Proposal };
export type TaskStep = {
  toolId: string | null;
  capability: string;
  parameters: Array<{ id: string; value: string | number | boolean }>;
  proposal: Proposal | null;
};
export type TaskPlan = { steps: TaskStep[]; token: string };
export function stepSpec(step: TaskStep, registry: RegistryEntry[]): Proposal {
  const entry =
    step.toolId === null ? null : registry.find((t) => t.id === step.toolId);
  if (step.toolId !== null && !entry)
    throw new Error("Unknown or unverified tool ID.");
  if ((step.toolId === null) !== (step.proposal !== null))
    throw new Error("Choose an existing tool or a missing capability.");
  const spec = validateProposal(structuredClone(entry?.spec ?? step.proposal));
  const inputs = proposalInputs(spec);
  if (inputs.filter((i) => i.required).length > 1)
    throw new Error("This chat supports one image flowing through each step.");
  const seen = new Set<string>();
  for (const p of step.parameters) {
    if (seen.has(p.id)) throw new Error("Duplicate parameter.");
    seen.add(p.id);
    if (spec.operation === "custom") {
      const definition = spec.parameters.find((d) => d.id === p.id);
      if (!definition) throw new Error("Unknown tool parameter.");
      validateParameterValue(definition, p.value);
      definition.default = p.value;
    } else {
      if (!(
        (spec.operation === "resize" && ["width", "height"].includes(p.id)) ||
        (spec.operation === "rotate" && p.id === "angle")
      ))
        throw new Error("Unknown tool parameter.");
      if (
        typeof p.value !== "number" ||
        !Number.isInteger(p.value) ||
        (p.id === "angle"
          ? ![0, 90, 180, 270].includes(p.value)
          : p.value < 1 || p.value > 4096)
      )
        throw new Error("Invalid tool parameter.");
      Object.assign(spec, { [p.id]: p.value });
    }
  }
  return validateProposal(spec);
}
export function validateSteps(
  value: unknown,
  registry: RegistryEntry[],
): TaskStep[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 4)
    throw new Error("A plan must have 1–4 steps.");
  return value.map((s) => {
    if (
      !s ||
      typeof s !== "object" ||
      Object.keys(s).some(
        (k) => !["toolId", "capability", "parameters", "proposal"].includes(k),
      ) ||
      !(s.toolId === null || typeof s.toolId === "string") ||
      typeof s.capability !== "string" ||
      !s.capability.trim() ||
      s.capability.length > 1000 ||
      !Array.isArray(s.parameters) ||
      s.parameters.length > 20 ||
      s.parameters.some(
        (p: { id: unknown; value: unknown }) =>
          !p ||
          typeof p.id !== "string" ||
          !["string", "number", "boolean"].includes(typeof p.value),
      )
    )
      throw new Error("Invalid plan step.");
    stepSpec(s, registry);
    return s as TaskStep;
  });
}
