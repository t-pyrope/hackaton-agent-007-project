/* eslint-disable @next/next/no-img-element -- blob URLs are browser-only processing results. */
import { useEffect, useRef, useState } from "react";
import ImageUpload from "@/components/image-tools/ImageUpload";
import CompressPng from "@/components/image-tools/CompressPng";
import type { Tool } from "./types";
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
  const [file, setFile] = useState<File | null>(null);
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

  async function run(next: File, nextValues = values) {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    setResult("");

    try {
      const form = new FormData();
      form.set("id", tool.id);
      form.set("image", next);
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
      if (!controller.signal.aborted) setResult(URL.createObjectURL(blob));
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
      <ImageUpload
        accept="image/png,image/jpeg,image/webp"
        title={file ? "Change image" : "Upload image"}
        description="Drop one PNG, JPEG or WebP here or"
        fileTypes="One image · Up to 10 MB · Up to 16 MP"
        processing={busy}
        hasImage={!!file}
        onFiles={(files) => {
          if (request.current || !files?.length) return;
          setResult("");
          setError("");
          if (files.length !== 1) {
            setError("Please upload exactly one image.");
            return;
          }
          const next = files[0];
          if (next.size > 10 * 1024 * 1024) {
            setError("Images must be 10 MB or smaller.");
            return;
          }
          setFile(next);
          void run(next);
        }}
      />
      <div className="compression-controls">
        {tool.uiSchema.parameters.map((p) => (
          <p key={p.id}>
            <label>
              {p.label}{" "}
              {p.type === "select" ? (
                <select
                  disabled={busy}
                  value={values[p.id] ?? String(p.default)}
                  onChange={(e) => {
                    const nextValues = { ...values, [p.id]: e.target.value };
                    setValues(nextValues);
                    if (file) void run(file, nextValues);
                  }}
                >
                  {p.options?.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="number"
                  min={p.min}
                  max={p.max}
                  disabled={busy}
                  value={values[p.id] ?? String(p.default)}
                  onChange={(e) => {
                    const nextValues = { ...values, [p.id]: e.target.value };
                    setValues(nextValues);
                    if (file) void run(file, nextValues);
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
              <a className="primary" href={result} download="result.png">
                Download PNG
              </a>
            </Box>
          </>
        )}
      </div>
    </>
  );
}
