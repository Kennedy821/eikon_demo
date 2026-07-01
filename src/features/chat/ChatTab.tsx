"use client";

import { useState, useRef, useEffect } from "react";
import { useChat } from "@/hooks/useChat";
import { synthesizeSpeech, type VoiceName } from "@/lib/api";
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

type TtsState = "idle" | "loading" | "playing";

export function ChatTab() {
  const { messages, steps, isThinking, error, send, cancel } = useChat();
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const [ttsIndex, setTtsIndex] = useState<number | null>(null);
  const [ttsState, setTtsState] = useState<TtsState>("idle");
  const [voice, setVoice] = useState<VoiceName>("Heart");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  function stopAudio() {
    audioRef.current?.pause();
    if (audioRef.current?.src) URL.revokeObjectURL(audioRef.current.src);
    audioRef.current = null;
    setTtsIndex(null);
    setTtsState("idle");
  }

  async function speak(index: number, text: string) {
    if (ttsIndex === index) { stopAudio(); return; }
    stopAudio();
    setTtsIndex(index);
    setTtsState("loading");
    try {
      const blobUrl = await synthesizeSpeech(text, voice);
      const audio = new Audio(blobUrl);
      audioRef.current = audio;
      audio.onended = stopAudio;
      audio.onerror = stopAudio;
      setTtsState("playing");
      audio.play();
    } catch {
      setTtsState("idle");
      setTtsIndex(null);
    }
  }

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
              <Message
                key={i}
                role={m.role}
                content={m.content}
                images={m.images}
                responseTimeMs={m.responseTimeMs}
                ttsState={ttsIndex === i ? ttsState : "idle"}
                onSpeak={m.role === "assistant" && m.content ? () => speak(i, m.content) : undefined}
              />
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
      <div className="mx-auto mt-4 w-full max-w-5xl space-y-2">
        <div className="flex items-center gap-2 text-xs text-eikon-muted">
          <span>Voice</span>
          {(["Heart", "Fable", "Peach"] as VoiceName[]).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setVoice(v)}
              className={`rounded-full border px-2.5 py-0.5 transition-colors ${
                voice === v
                  ? "border-eikon-navy bg-eikon-navy text-white"
                  : "border-transparent bg-eikon-panel text-eikon-muted hover:text-eikon-midnight"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(input);
        }}
        className="flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Message EIKON…"
          disabled={isThinking}
          className="flex-1 rounded-lg border px-4 py-3 disabled:opacity-50"
        />
        {isThinking ? (
          <button
            type="button"
            onClick={cancel}
            className="rounded-lg border border-red-300 bg-red-50 px-6 py-3 font-medium text-red-700 hover:bg-red-100"
          >
            Stop
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim()}
            className="rounded-lg bg-eikon-orange px-6 py-3 font-medium text-white disabled:opacity-50"
          >
            Send
          </button>
        )}
      </form>
      </div>
    </div>
  );
}

function formatDuration(ms: number): string {
  const totalSecs = Math.round(ms / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
}

function Message({
  role,
  content,
  images,
  ttsState = "idle",
  onSpeak,
  responseTimeMs,
}: {
  role: "user" | "assistant";
  content: string;
  images?: string[];
  ttsState?: TtsState;
  onSpeak?: () => void;
  responseTimeMs?: number;
}) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={isUser ? "max-w-[75%]" : "w-full max-w-3xl"}>
        {!isUser && (
          <div className="mb-1 flex items-baseline gap-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-eikon-muted">
              EIKON
            </span>
            {responseTimeMs !== undefined && (
              <span className="text-xs text-eikon-muted">
                Reasoning time: {formatDuration(responseTimeMs)}
              </span>
            )}
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
        {onSpeak && (
          <button
            onClick={onSpeak}
            title={ttsState === "playing" ? "Stop" : "Listen"}
            className="mt-1.5 flex items-center gap-1.5 rounded px-2 py-1 text-xs text-eikon-muted transition-colors hover:bg-eikon-panel hover:text-eikon-midnight"
          >
            {ttsState === "loading" && <Spinner />}
            {ttsState === "playing" && <StopIcon />}
            {ttsState === "idle" && <SpeakerIcon />}
            <span>{ttsState === "loading" ? "Synthesising…" : ttsState === "playing" ? "Stop" : "Listen"}</span>
          </button>
        )}
      </div>
    </div>
  );
}

function SpeakerIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" width="13" height="13" aria-hidden>
      <path d="M9 2.5a.5.5 0 00-.8-.4L4.5 5H2a1 1 0 00-1 1v4a1 1 0 001 1h2.5l3.7 2.9a.5.5 0 00.8-.4V2.5z"/>
      <path d="M11.3 5.7a1 1 0 011.4 1.4 3 3 0 010 1.8 1 1 0 01-1.4-1.4.5.5 0 000-.4 1 1 0 010-1.4z" opacity=".6"/>
      <path d="M13.1 3.9a1 1 0 011.4 1.4 6 6 0 010 5.4 1 1 0 01-1.4-1.4 4 4 0 000-2.6 1 1 0 010-2.8z" opacity=".3"/>
    </svg>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" width="13" height="13" aria-hidden>
      <rect x="3" y="3" width="10" height="10" rx="1.5"/>
    </svg>
  );
}

function Spinner() {
  return (
    <span
      className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-eikon-muted border-t-eikon-midnight"
      aria-hidden
    />
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
