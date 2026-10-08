/* eslint-disable @next/next/no-img-element -- blob URLs are browser-only processing results. */
import { useEffect, useRef, useState } from "react";
import CompressPng from "@/components/image-tools/CompressPng";
import type { Tool } from "./types";

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
  const input = useRef<HTMLInputElement>(null);
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

  async function run() {
    if (!file || busy) return;
    setBusy(true);
    setError("");
    setResult("");
    try {
      const form = new FormData();
      form.set("id", tool.id);
      form.set("image", file);
      for (const p of tool.uiSchema.parameters)
        form.set(p.id, values[p.id] ?? String(p.default));
      const response = await fetch("/api/tools/run", {
        method: "POST",
        body: form,
      });
      if (!response.ok)
        throw new Error((await response.json()).error || "Processing failed.");
      setResult(URL.createObjectURL(await response.blob()));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Processing failed.");
    } finally {
      setBusy(false);
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
      <div className="upload">
        <input
          ref={input}
          hidden
          aria-label="Input image"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={busy}
          onChange={(e) => {
            setFile(e.target.files?.[0] || null);
            setResult("");
            setError("");
          }}
        />
        <button
          className="upload-trigger"
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          <span className="upload-plus">+</span>
          <h3>{file ? "Change image" : "Upload image"}</h3>
          <p>{file ? file.name : "Choose a PNG, JPEG or WebP image"}</p>
          <span className="file-types">
            One image · Up to 10 MB · Up to 16 MP
          </span>
        </button>
      </div>
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
                    setValues({ ...values, [p.id]: e.target.value });
                    setResult("");
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
                    setValues({ ...values, [p.id]: e.target.value });
                    setResult("");
                  }}
                />
              )}
            </label>
          </p>
        ))}
        <p>
          <button className="primary" disabled={!file || busy} onClick={run}>
            {busy ? "Processing…" : "Process image"}
          </button>
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {result && (
          <>
            <p>
              <a className="primary" href={result} download="result.png">
                Download PNG
              </a>
            </p>
            <img
              src={result}
              alt="Processed image"
              style={{ maxWidth: "100%", maxHeight: 500 }}
            />
          </>
        )}
      </div>
    </>
  );
}
