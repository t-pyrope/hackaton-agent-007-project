export type Operation = "grayscale" | "invert" | "resize" | "rotate";

export type Proposal = {
  name: string;
  description: string;
  operation: Operation;
  width: number;
  height: number;
  angle: number;
  outputFormat: "png";
};

export const proposalSchema = {
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

export function validateProposal(value: unknown): Proposal {
  const p = value as Proposal;
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
