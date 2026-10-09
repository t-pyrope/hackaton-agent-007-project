import type { RegistryEntry } from "./task-contract";
export const compressEntry: RegistryEntry = {
  id: "builtin:compress-png",
  name: "Compress PNG",
  spec: {
    name: "Compress PNG",
    description:
      "Compress a static PNG. Lossless preserves pixels; smaller uses palette quantization. A smaller file is not guaranteed. PNG input only.",
    operation: "custom",
    outputFormat: "png",
    inputs: [{ id: "image", type: "image", required: true }],
    parameters: [
      {
        id: "mode",
        label: "Mode",
        type: "select",
        default: "lossless",
        min: null,
        max: null,
        options: [
          { label: "Lossless", value: "lossless" },
          { label: "Smaller File", value: "smaller" },
        ],
      },
      {
        id: "quality",
        label: "Quality",
        type: "number",
        default: 80,
        min: 1,
        max: 100,
        options: null,
      },
    ],
  },
};
