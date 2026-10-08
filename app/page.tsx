"use client";
/* eslint-disable @next/next/no-img-element -- Local blob images are rendered without a server image optimizer. */

import Link from "next/link";
import { useEffect, useRef, useState, type PointerEvent } from "react";

type Tool = { name: string; request: string };
const stages = ["Writing Code", "Testing", "Fixing", "Installed"];
const parts = [
  "Head",
  "Torso",
  "Left upper arm",
  "Right upper arm",
  "Left hand",
  "Right hand",
  "Left leg",
  "Right leg",
  "Left foot",
  "Right foot",
];
function Icon({ name, size = 22 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    crop: (
      <>
        <path d="M6 3v15h15M3 6h15v15" />
      </>
    ),
    upload: (
      <>
        <path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5" />
      </>
    ),
    download: (
      <>
        <path d="M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4" />
      </>
    ),
    arrow: <path d="m5 12 14 0m-6-6 6 6-6 6" />,
    spark: (
      <>
        <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z" />
      </>
    ),
    close: <path d="m6 6 12 12M6 18 18 6" />,
    shield: (
      <>
        <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z" />
        <path d="m8 12 3 3 5-6" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] || paths.spark}
    </svg>
  );
}
function Creature({
  count,
  onPart,
}: {
  count: number;
  onPart?: (index: number) => void;
}) {
  const shapes = [
    <rect key="h" x="85" y="22" width="70" height="66" rx="22" />,
    <rect key="t" x="76" y="98" width="88" height="98" rx="25" />,
    <rect
      key="a"
      x="42"
      y="102"
      width="27"
      height="67"
      rx="13"
      transform="rotate(12 42 102)"
    />,
    <rect
      key="b"
      x="171"
      y="102"
      width="27"
      height="67"
      rx="13"
      transform="rotate(-12 171 102)"
    />,
    <circle key="c" cx="43" cy="184" r="17" />,
    <circle key="d" cx="197" cy="184" r="17" />,
    <rect key="l" x="81" y="205" width="32" height="68" rx="13" />,
    <rect key="r" x="127" y="205" width="32" height="68" rx="13" />,
    <rect key="f" x="65" y="280" width="48" height="23" rx="11" />,
    <rect key="g" x="127" y="280" width="48" height="23" rx="11" />,
  ];
  return (
    <svg
      className="creature"
      viewBox="0 0 240 325"
      aria-label={`${count} of 10 body parts installed`}
    >
      {shapes.map((shape, i) => (
        <g
          key={i}
          className={i < count ? "part installed" : "part"}
          role={onPart ? "button" : undefined}
          tabIndex={onPart ? 0 : undefined}
          aria-label={`${parts[i]}${i < count ? ", installed" : ", not installed"}`}
          onClick={() => onPart?.(i)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onPart?.(i);
            }
          }}
        >
          {shape}
        </g>
      ))}
      <g stroke="currentColor" strokeWidth="3" fill="none">
        <path d="M100 48v7m40-7v7m-36 14q16 10 32 0M84 123h72M113 123v13m12-13v8" />
      </g>
      <path d="M91 23v-8h58v8" fill="currentColor" />
      <path d="M76 52H65m99 0h11" stroke="currentColor" strokeWidth="7" />
    </svg>
  );
}
export default function Home() {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [filename, setFilename] = useState("");
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [x, setX] = useState(50);
  const [y, setY] = useState(50);
  const [chat, setChat] = useState(true);
  const [prompt, setPrompt] = useState("");
  const [tools, setTools] = useState<Tool[]>([]);
  const [stage, setStage] = useState(-1);
  const [request, setRequest] = useState("");
  const [modal, setModal] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [activeTool, setActiveTool] = useState("Crop to Square");
  const input = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const busy = stage >= 0 && stage < 3;
  const side = image
    ? Math.round(
        (Math.min(image.naturalWidth, image.naturalHeight) * 100) / zoom,
      )
    : 0;
  const sx = image ? ((image.naturalWidth - side) * x) / 100 : 0;
  const sy = image ? ((image.naturalHeight - side) * y) / 100 : 0;
  useEffect(
    () => () => {
      if (image) URL.revokeObjectURL(image.src);
    },
    [image],
  );
  useEffect(() => {
    if (!image || !canvas.current) return;
    const target = canvas.current;
    target.width = side;
    target.height = side;
    target
      .getContext("2d")
      ?.drawImage(image, sx, sy, side, side, 0, 0, side, side);
  }, [image, side, sx, sy]);
  useEffect(() => {
    if (!busy) return;
    const timer = setTimeout(() => {
      if (stage === 2) {
        const name =
          request
            .trim()
            .replace(/[.!?]+$/, "")
            .slice(0, 38) || "Custom Tool";
        setTools((old) => [...old, { name, request }]);
      }
      setStage(stage + 1);
    }, 1300);
    return () => clearTimeout(timer);
  }, [stage, busy, request]);
  useEffect(() => {
    if (modal) {
      returnFocus.current = document.activeElement as HTMLElement;
      dialog.current?.showModal();
    } else {
      dialog.current?.close();
      returnFocus.current?.focus();
    }
  }, [modal]);
  function load(file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please choose a valid image file.");
      return;
    }
    const url = URL.createObjectURL(file);
    const next = new Image();
    next.onload = () => {
      setImage(next);
      setFilename(file.name);
      setZoom(100);
      setX(50);
      setY(50);
      setError("");
    };
    next.onerror = () => {
      setError("This image could not be opened. Try PNG, JPEG or WebP.");
      URL.revokeObjectURL(url);
    };
    next.src = url;
  }
  function download() {
    canvas.current?.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${filename.replace(/\.[^.]+$/, "")}-square.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, "image/png");
  }
  function move(e: PointerEvent<HTMLDivElement>) {
    if (!image || e.buttons !== 1) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * image.naturalWidth;
    const py = ((e.clientY - rect.top) / rect.height) * image.naturalHeight;
    setX(
      image.naturalWidth === side
        ? 50
        : Math.max(
            0,
            Math.min(
              100,
              ((px - side / 2) / (image.naturalWidth - side)) * 100,
            ),
          ),
    );
    setY(
      image.naturalHeight === side
        ? 50
        : Math.max(
            0,
            Math.min(
              100,
              ((py - side / 2) / (image.naturalHeight - side)) * 100,
            ),
          ),
    );
  }
  function addTool() {
    setChat(true);
    setTimeout(() => textarea.current?.focus(), 0);
  }
  function send() {
    if (!prompt.trim() || busy || tools.length >= 10) return;
    setRequest(prompt.trim());
    setPrompt("");
    setStage(0);
  }
  return (
    <div className="app">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="Frankenframe home">
          <span className="brand-mark">
            <Icon name="crop" size={26} />
          </span>
          frankenframe<span className="brand-dot">.</span>
        </Link>
        <button className="collection" onClick={() => setModal(true)}>
          <span className="mini-face">⊞</span> My Frankenstein · {tools.length}
          /10 <Icon name="arrow" size={18} />
        </button>
      </header>
      <div className={`workspace ${chat ? "" : "chat-closed"}`}>
        <aside className="tool-panel">
          <div className="section-label">
            Your tools <span>{tools.length + 1}</span>
          </div>
          <nav aria-label="Image tools">
            <button
              className={
                activeTool === "Crop to Square" ? "tool active" : "tool"
              }
              onClick={() => setActiveTool("Crop to Square")}
            >
              <Icon name="crop" />
              <span>Crop to Square</span>
              <span className="tool-dot" />
            </button>
            {tools.map((tool, i) => (
              <button
                className={activeTool === tool.name ? "tool active" : "tool"}
                key={i}
                onClick={() => setActiveTool(tool.name)}
              >
                <Icon name="spark" />
                <span>{tool.name}</span>
              </button>
            ))}
          </nav>
          <button className="add-tool" onClick={addTool}>
            + Add Tool
          </button>
          <div className="sidebar-bottom">
            <div className="little-creature">
              <Creature count={tools.length} />
            </div>
            <h3>
              A work in progress.
              <br />
              Just like all good things.
            </h3>
            <p>Every new tool brings your Frankenstein to life.</p>
            <button className="text-button" onClick={() => setModal(true)}>
              Meet your creation <Icon name="arrow" size={18} />
            </button>
          </div>
        </aside>
        <main className="editor">
          <div className="editor-heading">
            <div>
              <h2>{activeTool}</h2>
              <p>
                {activeTool === "Crop to Square"
                  ? "Find your focus. Get the perfect square."
                  : "Your new tool is installed as a demo."}
              </p>
            </div>
            <span className="ratio-badge">
              {activeTool === "Crop to Square" ? "1 : 1" : "Mock"}
            </span>
          </div>
          {activeTool !== "Crop to Square" && (
            <div className="mock-notice">
              This tool uses a simulated installation. Image editing is
              available in Crop to Square.
              <button
                className="text-button"
                onClick={() => setActiveTool("Crop to Square")}
              >
                Open Crop to Square →
              </button>
            </div>
          )}
          <input
            ref={input}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              load(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <div
            className={`upload ${dragging ? "dragging" : ""} ${image ? "has-image" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              load(e.dataTransfer.files[0]);
            }}
          >
            {image ? (
              <>
                <div className="file-heading">
                  <span>{filename}</span>
                  <button
                    className="text-button"
                    onClick={() => input.current?.click()}
                  >
                    Replace image
                  </button>
                </div>
                <div
                  className="image-stage"
                  style={{
                    aspectRatio: `${image.naturalWidth}/${image.naturalHeight}`,
                  }}
                  onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId);
                    move(e);
                  }}
                  onPointerMove={move}
                >
                  <img
                    src={image.src}
                    alt="Uploaded image with crop selection"
                    draggable={false}
                  />
                  <div
                    className="crop-selection"
                    style={{
                      left: `${(sx / image.naturalWidth) * 100}%`,
                      top: `${(sy / image.naturalHeight) * 100}%`,
                      width: `${(side / image.naturalWidth) * 100}%`,
                      height: `${(side / image.naturalHeight) * 100}%`,
                    }}
                  >
                    <i />
                    <i />
                    <i />
                    <i />
                    <div className="grid-lines" />
                  </div>
                </div>
                <p className="drag-hint">
                  Drag to position your square, or use the controls below.
                </p>
              </>
            ) : (
              <button
                className="upload-trigger"
                onClick={() => input.current?.click()}
              >
                <span className="upload-art">
                  <span className="photo-back" />
                  <span className="photo-front">
                    <svg viewBox="0 0 80 65" fill="none">
                      <rect
                        x="1"
                        y="1"
                        width="78"
                        height="63"
                        rx="8"
                        stroke="currentColor"
                        strokeWidth="2"
                      />
                      <circle cx="56" cy="19" r="7" fill="currentColor" />
                      <path
                        d="m8 54 21-25 17 19 9-10 17 16"
                        stroke="currentColor"
                        strokeWidth="2"
                      />
                    </svg>
                    <span className="upload-plus">+</span>
                  </span>
                </span>
                <h3>Upload Image</h3>
                <p>
                  Drop an image here or <u>browse files</u>
                </p>
                <span className="file-types">PNG, JPG, WebP & more</span>
              </button>
            )}
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="crop-controls">
            <div className="section-label">
              Crop settings{" "}
              <button
                className="text-button"
                disabled={!image}
                onClick={() => {
                  setZoom(100);
                  setX(50);
                  setY(50);
                }}
              >
                Reset ↺
              </button>
            </div>
            <div className="controls-grid">
              <div className="ratio-setting">
                <span>Aspect ratio</span>
                <div>
                  <Icon name="crop" size={18} /> Square <strong>1:1</strong>
                </div>
              </div>
              <label>
                Zoom <span>{zoom}%</span>
                <input
                  aria-label="Zoom"
                  type="range"
                  min="100"
                  max="400"
                  value={zoom}
                  disabled={!image}
                  onChange={(e) => setZoom(+e.target.value)}
                />
              </label>
            </div>
            {image && (
              <div className="position-controls">
                <label>
                  Horizontal position
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={x}
                    onChange={(e) => setX(+e.target.value)}
                  />
                </label>
                <label>
                  Vertical position
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={y}
                    onChange={(e) => setY(+e.target.value)}
                  />
                </label>
              </div>
            )}
          </div>
          <div className="preview-row">
            <div className="preview-image">
              {image ? (
                <canvas ref={canvas} aria-label="Square crop preview" />
              ) : (
                <Icon name="crop" size={29} />
              )}
            </div>
            <div>
              <h3>Preview</h3>
              <p>
                {image
                  ? `${side} × ${side} px · PNG`
                  : "Your square, ready to go."}
              </p>
            </div>
            <button
              className="primary download"
              disabled={!image}
              onClick={download}
            >
              <Icon name="download" size={19} /> Download Image
            </button>
          </div>
          <div className="editor-foot">
            <Icon name="shield" size={17} /> Processed on your device. Never
            uploaded.
          </div>
        </main>
        {chat ? (
          <aside className="agent-panel">
            <div className="agent-heading">
              <span className="agent-icon">
                <Icon name="spark" />
              </span>
              <h2>Agent</h2>
              <span className="online-dot" />
              <button
                className="icon-button"
                aria-label="Collapse agent chat"
                onClick={() => setChat(false)}
              >
                →
              </button>
            </div>
            <div className="agent-conversation" aria-live="polite">
              <span className="demo-label">
                YOUR CREATIVE SIDEKICK <span>Demo</span>
              </span>
              <div className="agent-avatar">
                <Icon name="spark" size={30} />
              </div>
              <h3>Got a tool in mind?</h3>
              <p>
                Tell me what you need. I’ll build a new tool for your workshop.
              </p>
              <div className="message">
                Try something like “add a tool to remove backgrounds” or “make
                my images black and white”.
              </div>
              <div className="suggestions">
                <button
                  disabled={busy || tools.length >= 10}
                  onClick={() => {
                    setPrompt("Remove Background");
                    textarea.current?.focus();
                  }}
                >
                  Remove background <span>↗</span>
                </button>
                <button
                  disabled={busy || tools.length >= 10}
                  onClick={() => {
                    setPrompt("Black & White");
                    textarea.current?.focus();
                  }}
                >
                  Make it black & white <span>↗</span>
                </button>
              </div>
              {stage >= 0 && (
                <div className="build-card">
                  <p className="request-message">“{request}”</p>
                  <div className="build-stages">
                    {stages.map((s, i) => (
                      <div key={s} className={stage >= i ? "reached" : ""}>
                        <span>
                          {stage > i || stage === 3
                            ? "✓"
                            : stage === i
                              ? "◌"
                              : "○"}
                        </span>
                        {s}
                      </div>
                    ))}
                  </div>
                  {stage === 3 && (
                    <p className="installed-note">
                      Your tool is installed. A new part is alive!
                    </p>
                  )}
                </div>
              )}
            </div>
            <form
              className="chat-form"
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
            >
              <textarea
                ref={textarea}
                aria-label="Describe the tool you want to add"
                placeholder="Describe the tool you want to add…"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                disabled={busy || tools.length >= 10}
              />
              <div>
                <span>
                  {tools.length >= 10
                    ? "Your creation is complete!"
                    : "A little imagination goes a long way."}
                </span>
                <button
                  className="primary"
                  disabled={!prompt.trim() || busy || tools.length >= 10}
                >
                  Send <Icon name="arrow" size={18} />
                </button>
              </div>
            </form>
          </aside>
        ) : (
          <button className="reopen-agent" onClick={() => setChat(true)}>
            <Icon name="spark" /> Agent ←
          </button>
        )}
      </div>
      <footer className="page-footer">
        <span>Made for your wonderfully specific ideas.</span>
        <span>
          <span className="footer-dot" /> Local-first. Creative-always.
        </span>
      </footer>
      <dialog
        ref={dialog}
        className="franken-modal"
        onCancel={() => setModal(false)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setModal(false);
        }}
      >
        <div className="modal-heading">
          <div className="eyebrow">PIECE BY PIECE</div>
          <button
            className="icon-button"
            aria-label="Close My Frankenstein"
            onClick={() => setModal(false)}
          >
            <Icon name="close" />
          </button>
        </div>
        <h2>My Frankenstein</h2>
        <p>Build your toolkit. Bring your creation to life.</p>
        <div className="creature-display">
          <Creature count={tools.length} onPart={setSelected} />
        </div>
        <h3>Tools Installed: {tools.length}/10</h3>
        <div className="progress-track">
          <span style={{ width: `${tools.length * 10}%` }} />
        </div>
        <div className="part-detail" aria-live="polite">
          {selected === null ? (
            <p>Select a body part to explore its tool and tests.</p>
          ) : (
            <>
              <strong>
                {parts[selected]} ·{" "}
                {tools[selected]?.name || "Not installed yet"}
              </strong>
              <p>
                {tools[selected]
                  ? "Mock tests: 3/3 passed · Input validation ✓ · Output format ✓ · UI integration ✓"
                  : "Add a new tool with the Agent to unlock this part."}
              </p>
            </>
          )}
        </div>
        <button
          className="primary"
          onClick={() => {
            setModal(false);
            addTool();
          }}
        >
          + Add a new tool
        </button>
      </dialog>
    </div>
  );
}
