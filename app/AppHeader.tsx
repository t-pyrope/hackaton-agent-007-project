import Link from "next/link";
import { Icon } from "@/components/Icon";
import { useEffect, useRef, useState } from "react";
import { Tool } from "@/app/types";

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

const partImages = [
  { file: "head", x: 83, y: 12, width: 74, height: 80 },
  { file: "body", x: 76, y: 96, width: 88, height: 100 },
  { file: "left-sleeve", x: 32, y: 100, width: 48, height: 72 },
  { file: "right-sleeve", x: 160, y: 100, width: 48, height: 72 },
  { file: "left-hand", x: 26, y: 165, width: 34, height: 39 },
  { file: "right-hand", x: 180, y: 165, width: 34, height: 39 },
  { file: "left-leg", x: 79, y: 195, width: 36, height: 83 },
  { file: "right-leg", x: 125, y: 195, width: 36, height: 83 },
  { file: "left-boot", x: 65, y: 271, width: 50, height: 37 },
  { file: "right-boot", x: 125, y: 271, width: 50, height: 37 },
];

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
          {i < count ? (
            <image
              href={`/franken-parts/${partImages[i].file}.png`}
              x={partImages[i].x}
              y={partImages[i].y}
              width={partImages[i].width}
              height={partImages[i].height}
              preserveAspectRatio="xMidYMid meet"
            />
          ) : (
            shape
          )}
        </g>
      ))}
      {count === 0 && (
        <g pointerEvents="none">
          <path
            d="M100 48v7m40-7v7m-36 14q16 10 32 0"
            stroke="currentColor"
            strokeWidth="3"
            fill="none"
          />
          <path d="M91 23v-8h58v8" fill="currentColor" />
          <path d="M76 52H65m99 0h11" stroke="currentColor" strokeWidth="7" />
        </g>
      )}
      {count < 2 && (
        <path
          d="M84 123h72M113 123v13m12-13v8"
          stroke="currentColor"
          strokeWidth="3"
          fill="none"
          pointerEvents="none"
        />
      )}
    </svg>
  );
}

export const AppHeader = ({ tools }: { tools: Tool[] }) => {
  const [modal, setModal] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (modal) {
      returnFocus.current = document.activeElement as HTMLElement;
      dialog.current?.showModal();
    } else {
      dialog.current?.close();
      returnFocus.current?.focus();
    }
  }, [modal]);

  return (
    <>
      <header className="topbar">
        <Link className="brand" href="/" aria-label="Frankenframe home">
          <span className="brand-mark">
            <Icon name="compress" size={26} />
          </span>
          frankenframe<span className="brand-dot">.</span>
        </Link>
        <button className="collection" onClick={() => setModal(true)}>
          <span className="mini-face">⊞</span> My Creature · {tools.length}
          /10 <Icon name="arrow" size={18} />
        </button>
      </header>

      <dialog
        ref={dialog}
        className="franken-modal"
        onCancel={() => setModal(false)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setModal(false);
        }}
      >
        <div className="modal-heading">
          <div>
            <h2 className="eyebrow">My creature</h2>
            <p>Build your toolkit. Bring your creation to life.</p>
          </div>
          <button
            className="icon-button"
            aria-label="Close My Creature"
            onClick={() => setModal(false)}
          >
            <Icon name="close" />
          </button>
        </div>
        <div className="creature-display">
          <Creature count={tools.length} onPart={setSelected} />
        </div>
        <h3>Tools Installed: {tools.length}/10</h3>
        <div className="progress-track">
          <span
            style={{ width: `${Math.min(tools.length, parts.length) * 10}%` }}
          />
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
                  ? `${tools[selected].testReport.results.filter((r) => r.passed).length}/${tools[selected].testReport.results.length} checks passed`
                  : "Add a new tool with Victor to unlock this part."}
              </p>
              {tools[selected]?.testReport.results.map((result, index) => (
                <p key={index}>
                  {result.passed ? "✓" : "✕"} {result.name}
                </p>
              ))}
            </>
          )}
        </div>
      </dialog>
    </>
  );
};
