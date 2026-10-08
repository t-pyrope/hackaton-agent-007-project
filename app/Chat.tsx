import { Dispatch, SetStateAction, useRef, useState } from "react";
import { Icon } from "@/app/components/Icon";
import { Tool } from "@/app/types";

type Message = { role: "user" | "assistant"; content: string };

export const Chat = (
  {
    // Reserved for future tool integration.
  }: {
    tools: Tool[];
    setTools: Dispatch<SetStateAction<Tool[]>>;
  },
) => {
  const [chat, setChat] = useState(true);
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const textarea = useRef<HTMLTextAreaElement>(null);

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
              setPrompt("Remove Background");
              textarea.current?.focus();
            }}
          >
            Remove background <span>↗</span>
          </button>
          <button
            disabled={busy}
            onClick={() => {
              setPrompt("Black & White");
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
            <p>{message.content}</p>
          </div>
        ))}
        {busy && (
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
          disabled={busy}
        />
        <div>
          <span>A little imagination goes a long way.</span>
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
