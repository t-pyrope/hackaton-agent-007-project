/* eslint-disable @next/next/no-img-element -- blob URLs are browser-only processing results. */
import { useEffect, useRef, useState } from "react";
import ImageUpload from "@/components/image-tools/ImageUpload";
import CompressPng from "@/components/image-tools/CompressPng";
import type { Tool } from "./types";
import {
  proposalInputs,
  resolvedOutputFormat,
  type OutputFormat,
} from "@/lib/tool-contract";
import { Box } from "@mui/material";

export const ActiveTool = ({
  activeTool,
  tools,
}: {
  activeTool: string;
  tools: Tool[];
}) => {
  const tool = tools.find((t) => t.id === activeTool);
  if (activeTool === "Compress PNG")
    return (
      <main className="editor">
        <CompressPng />
      </main>
    );
  return (
    <main className="editor">
      {tool ? (
        <InstalledTool key={tool.id} tool={tool} />
      ) : (
        <p>Select an installed tool.</p>
      )}
    </main>
  );
};

function InstalledTool({ tool }: { tool: Tool }) {
  const request = useRef<AbortController | null>(null);

  useEffect(() => () => request.current?.abort(), []);
  const [files, setFiles] = useState<Record<string, File[]>>({});
  const inputs = tool.testReport.proposal
    ? proposalInputs(tool.testReport.proposal)
    : tool.uiSchema.inputs;
  const [resultFormat, setResultFormat] = useState<OutputFormat>(
    tool.testReport.proposal
      ? resolvedOutputFormat(tool.testReport.proposal)
      : "png",
  );
  const ready = (selected: Record<string, File[]>) =>
    inputs.every((input) => !input.required || selected[input.id]?.length);

  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");

  useEffect(
    () => () => {
      if (result) URL.revokeObjectURL(result);
    },
    [result],
  );

  async function run(next: Record<string, File[]>, nextValues = values) {
    if (request.current || !ready(next)) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    setResult("");

    try {
      const form = new FormData();
      form.set("id", tool.id);
      for (const input of inputs)
        for (const file of next[input.id] ?? []) form.append(input.id, file);
      for (const p of tool.uiSchema.parameters)
        form.set(p.id, nextValues[p.id] ?? String(p.default));
      const response = await fetch("/api/tools/run", {
        method: "POST",
        body: form,
        signal: controller.signal,
      });
      if (!response.ok)
        throw new Error((await response.json()).error || "Processing failed.");
      const blob = await response.blob();
      if (!controller.signal.aborted) {
        setResultFormat(blob.type.replace("image/", "") as OutputFormat);
        setResult(URL.createObjectURL(blob));
      }
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : "Processing failed.");
    } finally {
      if (!controller.signal.aborted) {
        request.current = null;
        setBusy(false);
      }
    }
  }
  return (
    <>
      <div className="editor-heading">
        <div>
          <h2>{tool.name}</h2>
          <p>{tool.description}</p>
        </div>
      </div>
      {inputs.map((input) => (
        <div key={input.id}>
          <ImageUpload
            multiple={input.type === "images"}
            accept="image/png,image/jpeg,image/webp,image/avif"
            title={`${files[input.id]?.length ? "Change" : "Upload"} ${input.id}${input.required ? "" : " (optional)"}`}
            description={`Drop ${input.type === "images" ? "images" : "one image"} here or`}
            fileTypes="PNG, JPEG, WebP, AVIF · 10 MB per image · 16 MP · 10 files total"
            processing={busy}
            hasImage={!!files[input.id]?.length}
            onFiles={(uploaded) => {
              if (request.current || !uploaded?.length) return;
              setResult("");
              setError("");
              const selected = Array.from(uploaded);
              if (input.type === "image" && selected.length !== 1) {
                setError("Please upload exactly one image for this input.");
                return;
              }
              if (
                selected.some(
                  (file) => !file.size || file.size > 10 * 1024 * 1024,
                )
              ) {
                setError("Each image must be nonempty and 10 MB or smaller.");
                return;
              }
              const next = { ...files, [input.id]: selected };
              if (Object.values(next).flat().length > 10) {
                setError("Upload at most 10 images.");
                return;
              }
              setFiles(next);
              if (ready(next)) void run(next);
            }}
          />
          {!!files[input.id]?.length && (
            <p>{files[input.id].map((file) => file.name).join(", ")}</p>
          )}
          {!input.required && !!files[input.id]?.length && (
            <button
              disabled={busy}
              onClick={() => {
                const next = { ...files, [input.id]: [] };
                setFiles(next);
                setResult("");
                if (ready(next)) void run(next);
              }}
            >
              Remove {input.id}
            </button>
          )}
        </div>
      ))}
      <div className="compression-controls">
        {tool.uiSchema.parameters.map((p) => (
          <p key={p.id}>
            <label>
              {p.label}{" "}
              {p.type === "select" || p.type === "boolean" ? (
                <select
                  disabled={busy}
                  value={values[p.id] ?? String(p.default)}
                  onChange={(e) => {
                    const nextValues = { ...values, [p.id]: e.target.value };
                    setValues(nextValues);
                    if (ready(files)) void run(files, nextValues);
                  }}
                >
                  {(p.type === "boolean"
                    ? [
                        { label: "Yes", value: "true" },
                        { label: "No", value: "false" },
                      ]
                    : p.options
                  )?.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type={
                    p.type === "slider"
                      ? "range"
                      : p.type === "text"
                        ? "text"
                        : p.type === "color"
                          ? "color"
                          : "number"
                  }
                  step={
                    p.type === "number" || p.type === "slider"
                      ? "any"
                      : undefined
                  }
                  min={p.min}
                  max={p.max}
                  disabled={busy}
                  value={values[p.id] ?? String(p.default)}
                  onChange={(e) => {
                    const nextValues = { ...values, [p.id]: e.target.value };
                    setValues(nextValues);
                    if (ready(files)) void run(files, nextValues);
                  }}
                />
              )}
            </label>
          </p>
        ))}
        {busy && <p role="status">Processing…</p>}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {result && (
          <>
            <img
              src={result}
              alt="Processed image"
              style={{ maxWidth: "100%", maxHeight: 500 }}
            />

            <Box sx={{ mt: 2 }}>
              <a
                className="primary"
                href={result}
                download={`result.${resultFormat}`}
              >
                Download {resultFormat.toUpperCase()}
              </a>
            </Box>
          </>
        )}
      </div>
    </>
  );
}
