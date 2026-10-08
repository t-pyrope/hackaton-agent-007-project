export type Operation = "grayscale" | "invert" | "resize" | "rotate";

type LegacyProposal = {
  name: string;
  description: string;
  operation: Operation;
  width: number;
  height: number;
  angle: number;
  outputFormat: "png";
};

const legacyProposalSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string" },
    description: { type: "string" },
    operation: {
      type: "string",
      enum: ["grayscale", "invert", "resize", "rotate"],
    },
    width: { type: "integer" },
    height: { type: "integer" },
    angle: { type: "integer", enum: [0, 90, 180, 270] },
    outputFormat: { type: "string", enum: ["png"] },
  },
  required: [
    "name",
    "description",
    "operation",
    "width",
    "height",
    "angle",
    "outputFormat",
  ],
};

export type Parameter = {
  id: string;
  label: string;
  type: "number" | "slider" | "text" | "select" | "boolean" | "color";
  default: string | number | boolean;
  min: number | null;
  max: number | null;
  options: Array<{ label: string; value: string }> | null;
};
export type CustomProposal = {
  name: string;
  description: string;
  operation: "custom";
  outputFormat: "png";
  parameters: Parameter[];
};
export type Proposal = LegacyProposal | CustomProposal;
export const proposalSchema = {
  anyOf: [
    legacyProposalSchema,
    {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string" },
        description: { type: "string" },
        operation: { type: "string", enum: ["custom"] },
        outputFormat: { type: "string", enum: ["png"] },
        parameters: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              id: { type: "string" },
              label: { type: "string" },
              type: {
                type: "string",
                enum: [
                  "number",
                  "slider",
                  "text",
                  "select",
                  "boolean",
                  "color",
                ],
              },
              default: {
                anyOf: [
                  { type: "string" },
                  { type: "number" },
                  { type: "boolean" },
                ],
              },
              min: { type: ["number", "null"] },
              max: { type: ["number", "null"] },
              options: {
                anyOf: [
                  { type: "null" },
                  {
                    type: "array",
                    items: {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        label: { type: "string" },
                        value: { type: "string" },
                      },
                      required: ["label", "value"],
                    },
                  },
                ],
              },
            },
            required: [
              "id",
              "label",
              "type",
              "default",
              "min",
              "max",
              "options",
            ],
          },
        },
      },
      required: [
        "name",
        "description",
        "operation",
        "outputFormat",
        "parameters",
      ],
    },
  ],
};

export function validateParameterValue(p: Parameter, value: unknown) {
  if (p.type === "number" || p.type === "slider") {
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      p.min === null ||
      p.max === null ||
      value < p.min ||
      value > p.max
    )
      throw new Error("Invalid numeric setting.");
  } else if (p.type === "boolean") {
    if (typeof value !== "boolean") throw new Error("Invalid boolean setting.");
  } else if (
    typeof value !== "string" ||
    value.length > 1000 ||
    (p.type === "color" && !/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value)) ||
    (p.type === "select" && !p.options?.some((o) => o.value === value))
  ) {
    throw new Error("Invalid tool setting.");
  }
}

export function validateProposal(value: unknown): Proposal {
  const custom = value as CustomProposal;
  if (custom?.operation === "custom") {
    if (
      Object.keys(custom).sort().join() !==
        "description,name,operation,outputFormat,parameters" ||
      typeof custom.name !== "string" ||
      !custom.name.trim() ||
      custom.name.length > 80 ||
      typeof custom.description !== "string" ||
      !custom.description.trim() ||
      custom.description.length > 1000 ||
      custom.outputFormat !== "png" ||
      !Array.isArray(custom.parameters) ||
      custom.parameters.length > 16
    )
      throw new Error("Invalid tool proposal.");
    const ids = new Set<string>();
    for (const p of custom.parameters) {
      if (
        !p ||
        Object.keys(p).sort().join() !==
          "default,id,label,max,min,options,type" ||
        typeof p.id !== "string" ||
        !/^[a-z][a-zA-Z0-9_]{0,39}$/.test(p.id) ||
        ["image", "id", "constructor", "prototype", "__proto__"].includes(
          p.id,
        ) ||
        ids.has(p.id) ||
        typeof p.label !== "string" ||
        !p.label.trim() ||
        p.label.length > 80 ||
        !["number", "slider", "text", "select", "boolean", "color"].includes(
          p.type,
        ) ||
        (p.min !== null && !Number.isFinite(p.min)) ||
        (p.max !== null && !Number.isFinite(p.max)) ||
        (p.min !== null && p.max !== null && p.min > p.max) ||
        (p.type === "select"
          ? !Array.isArray(p.options) ||
            !p.options.length ||
            p.options.length > 32 ||
            new Set(p.options.map((o) => o?.value)).size !== p.options.length ||
            p.options.some(
              (o) =>
                !o ||
                Object.keys(o).sort().join() !== "label,value" ||
                typeof o.label !== "string" ||
                !o.label.trim() ||
                o.label.length > 80 ||
                typeof o.value !== "string" ||
                o.value.length > 1000,
            )
          : p.options !== null)
      )
        throw new Error("Invalid proposal parameter.");
      validateParameterValue(p, p.default);
      ids.add(p.id);
    }
    return custom;
  }
  const p = value as LegacyProposal;
  if (
    !p ||
    typeof p !== "object" ||
    Object.keys(p).sort().join() !==
      "angle,description,height,name,operation,outputFormat,width" ||
    typeof p.name !== "string" ||
    !p.name.trim() ||
    p.name.length > 80 ||
    typeof p.description !== "string" ||
    !p.description.trim() ||
    p.description.length > 1000 ||
    !["grayscale", "invert", "resize", "rotate"].includes(p.operation) ||
    p.outputFormat !== "png" ||
    !Number.isInteger(p.width) ||
    !Number.isInteger(p.height) ||
    p.width < 1 ||
    p.width > 4096 ||
    p.height < 1 ||
    p.height > 4096 ||
    ![0, 90, 180, 270].includes(p.angle)
  )
    throw new Error("Invalid tool proposal.");
  return p;
}

export type ConfirmableProposal = {
  id: string;
  spec: Proposal;
  token: string;
  expiresAt: number;
};

export type BuildStatus = "Writing Code" | "Testing" | "Fixing" | "Installed";
