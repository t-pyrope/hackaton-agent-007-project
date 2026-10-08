import { Dispatch, SetStateAction, useEffect, useRef, useState } from "react";
import { Icon } from "@/app/components/Icon";
import { Tool } from "@/app/types";

const stages = ["Writing Code", "Testing", "Fixing", "Installed"];

export const Chat = ({
  tools,
  setTools,
}: {
  tools: Tool[];
  setTools: Dispatch<SetStateAction<Tool[]>>;
}) => {
  const [chat, setChat] = useState(true);
  const [prompt, setPrompt] = useState("");
  const [stage, setStage] = useState(-1);
  const [request, setRequest] = useState("");

  const textarea = useRef<HTMLTextAreaElement>(null);

  function send() {
    if (!prompt.trim() || busy || tools.length >= 10) return;
    setRequest(prompt.trim());
    setPrompt("");
    setStage(0);
  }

  const busy = stage >= 0 && stage < 3;
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

  return chat ? (
    <aside className="agent-panel">
      <div className="agent-heading">
        <span className="agent-icon">
          <Icon name="spark" />
        </span>
        <h2>Victor</h2>
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
        <div className="agent-avatar">
          <Icon name="spark" size={30} />
        </div>
        <h3>Got a tool in mind?</h3>
        <p>Tell me what you need. I’ll build a new tool for you.</p>
        <div className="message">
          Try something like “add a tool to remove backgrounds” or “make my
          images black and white”.
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
                    {stage > i || stage === 3 ? "✓" : stage === i ? "◌" : "○"}
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
  );
};
