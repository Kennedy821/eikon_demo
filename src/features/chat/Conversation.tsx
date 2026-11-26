"use client";

import { useState, useRef, useEffect } from "react";
import { useChat } from "@/hooks/useChat";
import { synthesizeSpeech, type VoiceName } from "@/lib/api";
import type { TraceStep } from "@/lib/chatFormat";
import { COVERED_COUNTRIES } from "@/lib/countries";

/**
 * The Eikon AI conversation — the transcript and the composer, with no page
 * chrome around them.
 *
 * It is shared rather than duplicated because the chat appears in two places:
 * the Eikon AI tab and the side panel docked to the analysis tabs. Both read
 * the same ChatProvider, so they are two views of one conversation, not two
 * conversations — a question asked from the panel is there on the tab.
 *
 * `compact` is for the panel, which is roughly a quarter of the width the tab
 * gets. It is set where the narrow column would otherwise break something
 * rather than everywhere a pixel could be saved; the tab's max-widths simply
 * stop binding at that width and need no variant.
 */
const SUGGESTIONS = [
  "Find solar farms near substations in the South East",
  "Compare Wembley Stadium and the O2 Arena",
  "What objects are at 51.5074, -0.1278?",
];

type TtsState = "idle" | "loading" | "playing";

export function Conversation({ compact = false }: { compact?: boolean }) {
  const { messages, steps, isThinking, error, send, cancel } = useChat();
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
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

  // Audio is tied to this view, so a panel that closes (unmounts) must not
  // leave a voice playing over the page.
  useEffect(() => stopAudio, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, steps]);

  /**
   * Grow the composer to fit what has been typed, up to a ceiling.
   *
   * A textarea does not size itself, so the height is set from scrollHeight on
   * every change — reset to auto first, or it can only ever grow, never shrink
   * back when text is deleted. Past the ceiling it scrolls instead, so a long
   * paste cannot push the transcript off the screen.
   */
  function autoGrow() {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, compact ? 160 : 200)}px`;
  }

  function submit(text: string) {
    if (!text.trim() || isThinking) return;
    send(text);
    setInput("");
    // Drop the inline height so the box falls back to its single-row size;
    // clearing the value alone would leave it standing at its grown height.
    if (inputRef.current) inputRef.current.style.height = "";
  }

  function onComposerKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends, Shift+Enter makes a new line — the convention for a chat
    // box, and the behaviour the single-line input had. `isComposing` guards
    // against sending on the Enter that commits an IME candidate, which is how
    // Chinese is typed and so reachable from the Hong Kong side of the app.
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    submit(input);
  }

  return (
    <>
      {/* Transcript. min-h-0 lets this shrink inside the flex column instead
          of pushing the composer off the bottom. */}
      <div
        className={`min-h-0 flex-1 overflow-y-auto bg-white ${
          compact ? "" : "rounded-lg border"
        }`}
      >
        {messages.length === 0 ? (
          <EmptyState onPick={submit} compact={compact} />
        ) : (
          <div
            className={`mx-auto w-full space-y-6 ${compact ? "p-4" : "max-w-5xl p-6"}`}
          >
            {messages.map((m, i) => (
              <Message
                key={i}
                role={m.role}
                content={m.content}
                images={m.images}
                responseTimeMs={m.responseTimeMs}
                compact={compact}
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
      <div
        className={`w-full shrink-0 space-y-2 ${
          compact ? "border-t bg-white p-4" : "mx-auto mt-4 max-w-5xl"
        }`}
      >
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
          // items-end so the button stays level with the last line as the box
          // grows upward, rather than being stretched or floated mid-height.
          className="flex items-end gap-2"
        >
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              autoGrow();
            }}
            onKeyDown={onComposerKeyDown}
            placeholder="Message EIKON…"
            disabled={isThinking}
            // resize-none because the height is driven by the content; leaving
            // the drag handle would let it be set to something autoGrow then
            // overrides on the next keystroke.
            className={`min-w-0 flex-1 resize-none rounded-lg border leading-6 disabled:opacity-50 ${
              compact ? "px-3 py-2 text-sm" : "px-4 py-3"
            }`}
          />
          {isThinking ? (
            <button
              type="button"
              onClick={cancel}
              className={`shrink-0 rounded-lg border border-red-300 bg-red-50 font-medium text-red-700 hover:bg-red-100 ${
                compact ? "px-3 py-2 text-sm" : "px-6 py-3"
              }`}
            >
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className={`shrink-0 rounded-lg bg-eikon-accent font-medium text-white disabled:opacity-50 ${
                compact ? "px-3 py-2 text-sm" : "px-6 py-3"
              }`}
            >
              Send
            </button>
          )}
        </form>
      </div>
    </>
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
  compact = false,
}: {
  role: "user" | "assistant";
  content: string;
  images?: string[];
  ttsState?: TtsState;
  onSpeak?: () => void;
  responseTimeMs?: number;
  compact?: boolean;
}) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={isUser ? "max-w-[85%]" : "w-full max-w-3xl"}>
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
        {images && images.length > 0 && <ImageGrid images={images} compact={compact} />}
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

/**
 * Renders 1 image large, or multiple in a responsive grid.
 *
 * The grid stays one column in the panel. Its breakpoints are viewport-based,
 * so on a wide screen a narrow panel would otherwise be given three columns
 * and tile the images at a few dozen pixels each.
 */
function ImageGrid({ images, compact = false }: { images: string[]; compact?: boolean }) {
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
    <div className={`mt-2 grid gap-3 ${compact ? "grid-cols-1" : "grid-cols-2 lg:grid-cols-3"}`}>
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

/**
 * How long each country is readable before the next one takes over.
 *
 * 2s rather than 3s because the list is now every country EIKON covers, and a
 * full pass has to stay within the time a reader might plausibly spend on this
 * screen. It is still comfortably above the ~1.2s a short word needs to be
 * read, so no name goes by unread.
 */
const COUNTRY_ROTATE_MS = 2_000;
/** How long the incoming name takes to arrive. */
const COUNTRY_FADE_MS = 300;

/**
 * Which covered country to highlight, cycling over time.
 *
 * The line used to claim the UK alone, which stopped being true when Hong Kong
 * and then Spain were added, and then the rest. Naming them one at a time
 * keeps the sentence the length of one country name however many there are.
 *
 * Under prefers-reduced-motion nothing cycles. Showing every name at once was
 * the answer while there were three of them; at thirty it is a wall of pills
 * where a sentence should be, so that branch gives the count instead. The
 * names themselves are on every country dropdown in the app.
 */
function useCoveredCountry(): { index: number; cycling: boolean } {
  const [index, setIndex] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduceMotion(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (reduceMotion) return;
    const timer = setInterval(
      () => setIndex((i) => (i + 1) % COVERED_COUNTRIES.length),
      COUNTRY_ROTATE_MS,
    );
    return () => clearInterval(timer);
  }, [reduceMotion]);

  return { index, cycling: !reduceMotion };
}

/** Teal label. eikon-accent rather than eikon-teal: white on #0D9488 is
 *  3.75:1, short of the 4.5:1 this 14px line needs, where #0E7490 is 5.4:1. */
const COUNTRY_PILL =
  "rounded-md bg-eikon-accent px-2 py-0.5 font-medium text-white";

/**
 * The covered country, as a badge that swaps without disturbing the sentence.
 *
 * Every name is rendered into the same grid cell, so the badge is always as
 * wide as the longest of them and nothing but the text changes. Sizing to the
 * current name instead would re-wrap and re-centre the whole paragraph on
 * every swap, which reads as the entire sentence refreshing rather than one
 * word in it. The teal sits on the wrapper, not on each name, so there is one
 * steady rectangle rather than two stacking up through the swap.
 *
 * Only the arriving name carries a transition. The one being replaced loses it
 * in the same render that hides it, so it goes at once and can never be caught
 * on screen beside its replacement. An earlier version faded the old name out
 * on a timer set to land just before the new one appeared, which held only
 * while the timers were punctual — in a background tab they coalesce, the two
 * fades ran together, and the words smeared over each other. Nothing here
 * depends on when a timer fires relative to another.
 */
function CountryBadge() {
  const { index, cycling } = useCoveredCountry();

  if (!cycling) {
    return <span className={`align-middle ${COUNTRY_PILL}`}>{COVERED_COUNTRIES.length} countries</span>;
  }

  return (
    <span className={`inline-grid justify-items-center align-middle ${COUNTRY_PILL}`}>
      {COVERED_COUNTRIES.map((name, i) => (
        <span
          key={name}
          // The inactive names stay in the layout to hold the width, so they
          // are hidden from assistive tech rather than read out as a list.
          aria-hidden={i !== index}
          style={i === index ? { transitionDuration: `${COUNTRY_FADE_MS}ms` } : undefined}
          className={`col-start-1 row-start-1 ${
            i === index ? "opacity-100 transition-opacity" : "opacity-0"
          }`}
        >
          {name}
        </span>
      ))}
    </span>
  );
}

function EmptyState({ onPick, compact = false }: { onPick: (s: string) => void; compact?: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-6 text-center">
      <div>
        <h2 className="text-xl font-semibold text-eikon-midnight">Ask EIKON</h2>
        <p className="mt-1 text-sm leading-7 text-eikon-muted">
          Locations, imagery, comparisons and object detection across{" "}
          <CountryBadge />
        </p>
      </div>
      <div
        className={`flex w-full max-w-2xl flex-col gap-2 ${
          compact ? "" : "sm:flex-row sm:flex-wrap sm:justify-center"
        }`}
      >
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
