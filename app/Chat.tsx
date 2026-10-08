import { Dispatch, SetStateAction, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Icon } from "@/components/Icon";
import { Tool } from "@/app/types";
import type { ConfirmableProposal, BuildStatus } from "@/lib/tool-contract";

type Message = { role: "user" | "assistant"; content: string };

export const Chat = ({
  setTools,
}: {
  tools: Tool[];
  setTools: Dispatch<SetStateAction<Tool[]>>;
}) => {
  const [proposal, setProposal] = useState<ConfirmableProposal | null>(null);
  const [buildStatus, setBuildStatus] = useState<BuildStatus | "">("");
  const [chat, setChat] = useState(true);
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const textarea = useRef<HTMLTextAreaElement>(null);

  async function build() {
    if (!proposal || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setBuildStatus("");

    try {
      const response = await fetch("/api/tools/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: proposal.token, confirmed: true }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Build failed.");
      }

      const reader = response.body?.getReader();

      if (!reader) throw new Error("Missing build response.");

      const decoder = new TextDecoder();
      let pending = "";
      let installed = false;

      while (true) {
        const { done, value } = await reader.read();
        pending += decoder.decode(value, { stream: !done });
        let end: number;
        while ((end = pending.indexOf("\n")) >= 0) {
          const line = pending.slice(0, end);
          pending = pending.slice(end + 1);
          if (!line) continue;
          const event = JSON.parse(line);
          if (event.error) throw new Error(event.error);
          if (event.status) setBuildStatus(event.status);
          if (event.tool) {
            const tool = event.tool as Tool;
            setTools((current) =>
              current.some((t) => t.id === tool.id)
                ? current
                : [...current, tool],
            );
            installed = true;
            setProposal(null);
          }
        }
        if (done) break;
      }
      if (!installed)
        throw new Error(
          "Build connection ended. Retry confirmation to recover the result.",
        );
    } catch (failure) {
      setBuildStatus("");
      setError(
        failure instanceof Error
          ? failure.message
          : "Build failed. Nothing was installed.",
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function send() {
    if (!prompt.trim() || inFlight.current) return;
    const draft = prompt;
    const history: Message[] = [
      ...messages,
      { role: "user", content: draft.trim() },
    ];
    inFlight.current = true;
    setBusy(true);
    setError("");
    setProposal(null);
    setBuildStatus("");
    setMessages(history);
    setPrompt("");

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
        signal: AbortSignal.timeout(90_000),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(
          typeof data.error === "string"
            ? data.error
            : "Victor could not reply. Please try again.",
        );
      }
      if (typeof data.message !== "string" || !data.message.trim()) {
        throw new Error("Victor returned an empty reply. Please try again.");
      }
      setMessages([...history, { role: "assistant", content: data.message }]);
      setProposal(data.proposal || null);
    } catch (failure) {
      setMessages(messages);
      setPrompt(draft);
      setError(
        failure instanceof Error && failure.name === "Error"
          ? failure.message
          : "Could not reach Victor. Please try again. Your text has been kept.",
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

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
        <p>Tell me what you need. Let’s plan an image tool together.</p>
        <div className="message">
          Try something like “add a tool to remove backgrounds” or “make my
          images black and white”.
        </div>
        <div className="suggestions">
          <button
            disabled={busy}
            onClick={() => {
              setPrompt("Add a tool to remove backgrounds");
              textarea.current?.focus();
            }}
          >
            Remove background <span>↗</span>
          </button>
          <button
            disabled={busy}
            onClick={() => {
              setPrompt("Add a tool to make image black & white");
              textarea.current?.focus();
            }}
          >
            Make it black & white <span>↗</span>
          </button>
        </div>
        {messages.map((message, index) => (
          <div
            className={`message chat-message chat-message-${message.role}`}
            key={index}
          >
            <strong>{message.role === "user" ? "You" : "Victor"}</strong>
            <div className="chat-markdown">
              <ReactMarkdown skipHtml>{message.content}</ReactMarkdown>
            </div>
          </div>
        ))}
        {proposal && (
          <div className="message">
            <strong>{proposal.spec.name}</strong>
            <p>{proposal.spec.description}</p>
            <p>
              One image → PNG
              {proposal.spec.operation === "resize"
                ? ` · ${proposal.spec.width} × ${proposal.spec.height} px`
                : proposal.spec.operation === "rotate"
                  ? ` · ${proposal.spec.angle}° clockwise`
                  : ""}
            </p>
            <button
              className="primary"
              style={{ marginTop: 20 }}
              disabled={busy}
              onClick={build}
            >
              Confirm &amp; Build
            </button>
          </div>
        )}
        {buildStatus && (
          <div className="message" role="status">
            {buildStatus}
            {busy ? "…" : ""}
          </div>
        )}
        {busy && !buildStatus && (
          <div className="message" role="status">
            Victor is thinking…
          </div>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
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
          maxLength={8000}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (!e.repeat) e.currentTarget.form?.requestSubmit();
            }
          }}
          disabled={busy}
        />
        <div>
          <button className="primary" disabled={!prompt.trim() || busy}>
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
