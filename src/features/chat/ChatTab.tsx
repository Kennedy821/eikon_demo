"use client";

import { useState, useRef, useEffect } from "react";
import { useChat } from "@/hooks/useChat";
import type { TraceStep } from "@/lib/chatFormat";

/**
 * Eikon AI chat — replaces render_ai_chat_tab.
 *
 * Layout notes: the conversation uses the full content width (no narrow
 * centered column). Text stays at a readable measure, but assistant responses
 * can break out wider to render multiple images in a responsive grid — so a
 * data-rich answer (e.g. several satellite tiles) tiles cleanly instead of
 * stacking in a thin column.
 */
const SUGGESTIONS = [
  "Find solar farms near substations in the South East",
  "Compare Wembley Stadium and the O2 Arena",
  "What objects are at 51.5074, -0.1278?",
];

export function ChatTab() {
  const { messages, steps, isThinking, error, send } = useChat();
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, steps]);

  function submit(text: string) {
    if (!text.trim() || isThinking) return;
    send(text);
    setInput("");
  }

  return (
    <div className="flex h-[calc(100vh-150px)] flex-col">
      <div className="mb-3 flex items-baseline justify-between">
        <h1 className="text-2xl font-bold text-eikon-midnight">Eikon AI</h1>
        <span className="text-xs text-eikon-muted">Geospatial intelligence assistant</span>
      </div>

      {/* Conversation */}
      <div className="flex-1 overflow-y-auto rounded-lg border bg-white">
        {messages.length === 0 ? (
          <EmptyState onPick={submit} />
        ) : (
          <div className="mx-auto w-full max-w-5xl space-y-6 p-6">
            {messages.map((m, i) => (
              <Message key={i} role={m.role} content={m.content} images={m.images} />
            ))}

            {isThinking && <Thinking steps={steps} />}
            {error && (
              <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
            )}
            <div ref={endRef} />
          </div>
        )}
      </div>

      {/* Composer */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(input);
        }}
        className="mx-auto mt-4 flex w-full max-w-5xl gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Message EIKON…"
          disabled={isThinking}
          className="flex-1 rounded-lg border px-4 py-3 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={isThinking || !input.trim()}
          className="rounded-lg bg-eikon-orange px-6 py-3 font-medium text-white disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}

function Message({
  role,
  content,
  images,
}: {
  role: "user" | "assistant";
  content: string;
  images?: string[];
}) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={isUser ? "max-w-[75%]" : "w-full max-w-3xl"}>
        {!isUser && (
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-eikon-muted">
            EIKON
          </div>
        )}
        {content && (
          <div
            className={`whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
              isUser ? "bg-eikon-navy text-white" : "bg-eikon-panel text-gray-900"
            }`}
          >
            {content}
          </div>
        )}
        {images && images.length > 0 && <ImageGrid images={images} />}
      </div>
    </div>
  );
}

/** Renders 1 image large, or multiple in a responsive grid. */
function ImageGrid({ images }: { images: string[] }) {
  if (images.length === 1) {
    return (
      <a href={src(images[0])} target="_blank" rel="noreferrer" className="mt-2 block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src(images[0])}
          alt="EIKON result"
          className="max-h-[480px] rounded-lg border object-contain"
        />
      </a>
    );
  }
  return (
    <div className="mt-2 grid grid-cols-2 gap-3 lg:grid-cols-3">
      {images.map((img, j) => (
        <a key={j} href={src(img)} target="_blank" rel="noreferrer" className="block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src(img)}
            alt={`EIKON result ${j + 1}`}
            className="aspect-square w-full rounded-lg border object-cover transition hover:opacity-90"
          />
        </a>
      ))}
    </div>
  );
}

/**
 * Live activity timeline. Shows the last few steps; the most recent is the
 * "active" one (pulsing) and renders its summary text in full, while earlier
 * steps collapse to a dim, single-line label+summary — so it reads as a
 * progressing status, not a raw chain-of-thought dump.
 */
function Thinking({ steps }: { steps: TraceStep[] }) {
  const recent = steps.slice(-4);
  const activeIndex = recent.length - 1;

  return (
    <div className="max-w-3xl rounded-2xl border border-eikon-panel bg-eikon-panel/60 p-4">
      <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-eikon-midnight">
        <span className="h-2 w-2 animate-pulse rounded-full bg-eikon-navy" />
        {recent.length > 0 ? recent[activeIndex].label : "Thinking…"}
      </div>

      <ol className="space-y-2">
        {recent.map((s, i) => {
          const active = i === activeIndex;
          return (
            <li key={`${s.label}-${i}`} className="flex gap-2 text-sm">
              <span
                className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
                  active ? "animate-pulse bg-eikon-navy" : "bg-eikon-muted/40"
                }`}
              />
              <div className={active ? "text-gray-900" : "text-eikon-muted"}>
                <span className="font-medium">{s.label}</span>
                {s.text && (
                  <span className={active ? "" : "line-clamp-1"}>
                    {" — "}
                    {s.text}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (s: string) => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-6 text-center">
      <div>
        <h2 className="text-xl font-semibold text-eikon-midnight">Ask EIKON</h2>
        <p className="mt-1 text-sm text-eikon-muted">
          Locations, imagery, comparisons and object detection across the UK.
        </p>
      </div>
      <div className="flex w-full max-w-2xl flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-center">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            onClick={() => onPick(s)}
            className="rounded-full border px-4 py-2 text-sm text-eikon-midnight hover:bg-eikon-panel"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function src(b64: string): string {
  return `data:image/png;base64,${b64}`;
}
