"use client";
/* eslint-disable @next/next/no-img-element -- Previews use local object URLs. */
import { useEffect, useRef, useState } from "react";
import ImageUpload from "./ImageUpload";

type Result = {
  url: string;
  size: number;
  originalSize: number;
  noReduction: boolean;
};
const formatSize = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / (1024 * 1024)).toFixed(2)} MB`;

export default function CompressPng() {
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [processing, setProcessing] = useState(false);
  const urls = useRef<{ source?: string; result?: string }>({});
  const request = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      request.current?.abort();
      if (urls.current.source) URL.revokeObjectURL(urls.current.source);
      if (urls.current.result) URL.revokeObjectURL(urls.current.result);
      urls.current = {};
    },
    [],
  );

  function clearResult() {
    if (urls.current.result) URL.revokeObjectURL(urls.current.result);
    delete urls.current.result;
    setResult(null);
  }
  function load(files: FileList | null) {
    if (request.current || !files?.length) return;
    setError("");
    clearResult();
    if (urls.current.source) URL.revokeObjectURL(urls.current.source);
    delete urls.current.source;
    setSource("");
    setFile(null);
    if (files.length !== 1) {
      setError("Please upload exactly one static PNG file.");
      return;
    }
    const next = files[0];
    if (next.size > 10 * 1024 * 1024) {
      setError("PNG files must be 10 MB or smaller.");
      return;
    }
    // The server checks actual PNG bytes; MIME type and extension are not trusted.
    const url = URL.createObjectURL(next);
    urls.current.source = url;
    setSource(url);
    setFile(next);
    void compress(next);
  }

  async function compress(next: File) {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setProcessing(true);
    setError("");
    clearResult();
    try {
      const form = new FormData();
      form.append("file", next);
      form.append("mode", "lossless");
      const response = await fetch("/api/image-tools/compress-png", {
        method: "POST",
        body: form,
        signal: controller.signal,
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Compression failed. Please try again.");
      }
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      urls.current.result = url;
      setResult({
        url,
        size: blob.size,
        originalSize: Number(response.headers.get("X-Original-Size")),
        noReduction: response.headers.get("X-No-Reduction") === "true",
      });
    } catch (error) {
      if (!controller.signal.aborted)
        setError(
          error instanceof Error
            ? error.message
            : "Compression failed. Please try again.",
        );
    } finally {
      if (!controller.signal.aborted) {
        request.current = null;
        setProcessing(false);
      }
    }
  }

  return (
    <section aria-label="Compress PNG" aria-busy={processing}>
      <div className="editor-heading">
        <div>
          <h2>Compress PNG</h2>
        </div>
      </div>
      <ImageUpload
        accept="image/png,.png"
        title="Upload PNG"
        description="Drop one PNG here or"
        fileTypes="Static PNG · Up to 10 MB · Up to 25 MP"
        processing={processing}
        hasImage={!!file}
        onFiles={load}
      />
      <div aria-live="polite" role="status">
        {file && (
          <div className="compression-result">
            <img
              className="compression-thumbnail"
              src={result?.url || source}
              alt={result ? "Compressed PNG preview" : "Original PNG preview"}
            />
            <div className="compression-file">
              <strong title={file.name}>{file.name}</strong>
              <div className="compression-file-meta">
                <span className="compression-format">PNG</span>
                <span>{formatSize(result?.originalSize ?? file.size)}</span>
              </div>
            </div>
            {processing && (
              <span className="compression-status">Compressing…</span>
            )}
            {result && (
              <>
                <div className="compression-savings">
                  <strong>
                    {result.noReduction
                      ? "0%"
                      : `−${((1 - result.size / result.originalSize) * 100).toFixed(0)}%`}
                  </strong>
                  <span>{formatSize(result.size)}</span>
                </div>
                <a
                  className="compression-download"
                  href={result.url}
                  download={`${file.name.replace(/\.[^.]+$/, "") || "image"}-compressed.png`}
                  aria-label={`Download compressed ${file.name}`}
                >
                  <svg
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  PNG
                </a>
              </>
            )}
            {error && !processing && (
              <button
                className="text-button"
                onClick={() => void compress(file)}
              >
                Try again
              </button>
            )}
          </div>
        )}
        {result?.noReduction && (
          <p className="no-reduction">No size reduction</p>
        )}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
