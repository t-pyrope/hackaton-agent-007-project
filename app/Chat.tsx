import { Dispatch, SetStateAction, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Icon } from "@/components/Icon";
import { Tool } from "@/app/types";
import Image from "next/image";
import type { TaskPlan } from "@/lib/task-contract";
import { RUN_LIMITS, type BudgetSnapshot } from "@/lib/run-budget";
import { RunBudgetCard } from "@/components/RunBudgetCard";

type Message = { role: "user" | "assistant"; content: string };

export const Chat = ({
  setTools,
}: {
  tools: Tool[];
  setTools: Dispatch<SetStateAction<Tool[]>>;
}) => {
  const [attachment, setAttachment] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [plan, setPlan] = useState<TaskPlan | null>(null);
  const [progress, setProgress] = useState<string[]>([]);
  const [budget, setBudget] = useState<BudgetSnapshot | null>(null);
  const [budgetLimits, setBudgetLimits] = useState<BudgetSnapshot>(RUN_LIMITS);
  const [result, setResult] = useState<{
    url: string;
    filename: string;
    reused: number;
    created: number;
  } | null>(null);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  function attach(file: File | null) {
    setAttachment(file);
    setPreview(file ? URL.createObjectURL(file) : "");
  }
  useEffect(
    () => () => {
      if (result) URL.revokeObjectURL(result.url);
    },
    [result],
  );
  const [chat, setChat] = useState(true);
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const textarea = useRef<HTMLTextAreaElement>(null);

  async function runPlan() {
    if (!plan || !attachment || inFlight.current || completed) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const form = new FormData();
      form.set("image", attachment);
      form.set("token", plan.token);
      form.set("confirmed", "true");
      const response = await fetch("/api/tasks/run", {
        method: "POST",
        body: form,
      });
      if (!response.ok)
        throw new Error((await response.json()).error || "Task failed.");
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Missing task response.");
      const decoder = new TextDecoder();
      let pending = "";
      let finished = false;
      while (true) {
        const { done, value } = await reader.read();
        pending += decoder.decode(value, { stream: !done });
        let end: number;
        while ((end = pending.indexOf("\n")) >= 0) {
          const line = pending.slice(0, end);
          pending = pending.slice(end + 1);
          if (!line) continue;
          const event = JSON.parse(line);
          if (event.budget) setBudget(event.budget);
          if (event.limits) setBudgetLimits(event.limits);
          if (event.error) throw new Error(event.error);
          if (event.tests)
            setProgress((current) => [
              ...current,
              ...event.tests.results.map(
                (test: { name: string; passed: boolean; error?: string }) =>
                  `Step ${event.step}: ${test.passed ? "PASS" : "FAIL"} · ${test.name}${test.error ? " · " + test.error : ""}`,
              ),
            ]);
          if (event.status)
            setProgress((current) => [
              ...current,
              `Step ${event.step}: ${event.status}${event.attempt ? ` (attempt ${event.attempt + 1})` : ""}`,
            ]);
          if (event.tool)
            setTools((current) =>
              current.some((t) => t.id === event.tool.id)
                ? current
                : [...current, event.tool],
            );
          if (event.result) {
            const bytes = Uint8Array.from(atob(event.result.base64), (c) =>
              c.charCodeAt(0),
            );
            setResult({
              ...event.result,
              url: URL.createObjectURL(
                new Blob([bytes], { type: event.result.mime }),
              ),
            });
            setCompleted(true);
            finished = true;
          }
        }
        if (done) break;
      }
      if (!finished)
        throw new Error(
          "Connection ended before a result was received. No successful execution was confirmed.",
        );
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Task failed.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function send() {
    if (!prompt.trim() || inFlight.current || completed) return;
    const draft = prompt;
    const history: Message[] = [
      ...messages,
      { role: "user", content: draft.trim() },
    ];
    inFlight.current = true;
    setBusy(true);
    setError("");
    setPlan(null);
    setBudget(null);
    setBudgetLimits(RUN_LIMITS);
    setProgress([]);
    setMessages(history);
    setPrompt("");

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, imageTask: true }),
        signal: AbortSignal.timeout(240_000),
      });
      const data = await response.json();
      if (data.budget) setBudget(data.budget);
      if (data.limits) setBudgetLimits(data.limits);
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
      setPlan(data.plan || null);
      if (data.discovery)
        setProgress([
          `Registry search v${data.discovery.version}: ${data.discovery.created ? "agent created and tested" : "reused"} · ${data.discovery.matchedIds.length} matches`,
          ...data.discovery.tests.attempts.map(
            (a: { attempt: number; passed: boolean; error?: string }) =>
              `Discovery attempt ${a.attempt}: ${a.passed ? "PASS" : "FAIL"}${a.error ? " · " + a.error : ""}`,
          ),
        ]);
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

  function startNewChat() {
    if (inFlight.current) return;
    setMessages([]);
    setPlan(null);
    attach(null);
    setResult(null);
    setBudget(null);
    setBudgetLimits(RUN_LIMITS);
    setProgress([]);
    setPrompt("");
    setError("");
    setCompleted(false);
  }

  return chat ? (
    <aside className="agent-panel">
      <div className="agent-heading">
        <span className="agent-icon">
          <Image src="/victor.png" width={34} height={34} alt="Victor" />
        </span>
        <h2>Victor</h2>
        <span className="online-dot" />
        <button
          type="button"
          className="icon-button"
          style={{ width: "auto", fontSize: 12 }}
          disabled={busy}
          onClick={startNewChat}
        >
          New chat
        </button>
        <button
          className="icon-button"
          aria-label="Collapse agent chat"
          onClick={() => setChat(false)}
          style={{ border: "1px solid #d5d5d5", borderRadius: "2rem" }}
        >
          →
        </button>
      </div>
      <RunBudgetCard
        used={budget}
        limits={budgetLimits}
        status={
          busy
            ? "Running"
            : error
              ? "Stopped"
              : completed
                ? "Completed"
                : budget
                  ? "Ready"
                  : "Per task"
        }
      />
      <div className="agent-conversation" aria-live="polite">
        <h3>What would you like to do?</h3>
        <div className="message">
          Upload an image and describe the result. Victor uses existing tools
          and builds missing ones.
        </div>
        <div className="suggestions">
          <button
            disabled={busy || completed}
            onClick={() => {
              setPrompt("Remove the background from my image");
              textarea.current?.focus();
            }}
          >
            Remove background <span>↗</span>
          </button>
          <button
            disabled={busy || completed}
            onClick={() => {
              setPrompt("Make my image black & white");
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
        {plan && (
          <div className="message">
            <strong>Plan</strong>
            <ol>
              {plan.steps.map((step, index) => (
                <li key={index} style={{ marginBottom: 12 }}>
                  <strong>
                    {step.toolId ? "Existing tool" : "New tool needed"}
                  </strong>
                  <p>{step.capability}</p>
                  {step.parameters.length > 0 && (
                    <small>
                      {step.parameters
                        .map((p) => `${p.id}: ${p.value}`)
                        .join(" · ")}
                    </small>
                  )}
                </li>
              ))}
            </ol>
            <button
              type="button"
              className="primary"
              disabled={busy || completed || !attachment}
              onClick={runPlan}
            >
              {plan.steps.every((s) => s.toolId) ? "Run" : "Build & Run"}
            </button>
            {!attachment && <p>Attach an image to run this plan.</p>}
          </div>
        )}
        {progress.length > 0 && (
          <div className="message" role="status">
            {progress.map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </div>
        )}
        {result && (
          <div className="message">
            <strong>Result</strong>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={result.url}
              alt="Completed image result"
              style={{
                width: "100%",
                maxHeight: 240,
                objectFit: "contain",
                marginTop: 12,
              }}
            />
            <p>
              {result.reused} reused · {result.created} created
            </p>
            <a className="primary" href={result.url} download={result.filename}>
              Download
            </a>
          </div>
        )}
        {busy && progress.length === 0 && (
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
        {preview && (
          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              marginBottom: 12,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={preview}
              alt="Attached image"
              style={{ width: 64, height: 64, objectFit: "contain" }}
            />
            <span style={{ overflowWrap: "anywhere", fontSize: 12 }}>
              {attachment?.name}
            </span>
            <button
              type="button"
              disabled={busy || completed}
              onClick={() => attach(null)}
              aria-label="Remove attached image"
            >
              ×
            </button>
          </div>
        )}
        <textarea
          ref={textarea}
          aria-label="Describe the result you want"
          placeholder="Describe the result you want…"
          maxLength={8000}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              if (!e.repeat) e.currentTarget.form?.requestSubmit();
            }
          }}
          disabled={busy || completed}
        />
        <div>
          <label style={{ fontSize: 12, cursor: "pointer" }}>
            Upload image
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/avif"
              disabled={busy || completed}
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                if (file.size > 10 * 1024 * 1024) {
                  setError("Image must be 10 MB or smaller.");
                  return;
                }
                attach(file);
                setError("");
              }}
            />
          </label>
          {completed ? (
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={startNewChat}
            >
              New chat
            </button>
          ) : (
            <button className="primary" disabled={!prompt.trim() || busy}>
              Send <Icon name="arrow" size={18} />
            </button>
          )}
        </div>
      </form>
    </aside>
  ) : (
    <button className="reopen-agent" onClick={() => setChat(true)}>
      <Icon name="spark" /> Agent ←
    </button>
  );
};
