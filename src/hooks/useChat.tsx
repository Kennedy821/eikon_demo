"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { submitChat, getChatStatus, getChatTraces } from "@/lib/api";
import { POLL } from "@/lib/config";
import {
  extractChatResponse,
  stripBase64FromText,
  traceStep,
  isHiddenTrace,
  type TraceStep,
} from "@/lib/chatFormat";
import { useAuth } from "./useAuth";
import type { ChatMessage } from "@/lib/types";

const POLL_TIMEOUT_MS = 40 * 60 * 1000; // 40 min, matches the Python max_wait.

interface ChatContextValue {
  messages: ChatMessage[];
  steps: TraceStep[];
  isThinking: boolean;
  error: string | null;
  send: (message: string) => Promise<void>;
  cancel: () => void;
  /** Clear the conversation and start a fresh one. */
  reset: () => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

/**
 * Holds the Eikon AI conversation for the whole app.
 *
 * This is a provider rather than a plain hook because the tabs are routes: a
 * Next.js client-side navigation unmounts the page, so state owned by ChatTab
 * died the moment the user looked at anything else. A search survives the same
 * navigation because nothing it needs is owned by the page — the job id is in
 * sessionStorage and the results are in the react-query cache, both of which
 * live in <Providers> above the route. Mounting the conversation there puts the
 * chat on the same footing.
 *
 * It also fixes a quieter loss: send() polls in a plain async loop rather than
 * through react-query, so navigating away mid-answer left the loop running
 * with nowhere to put the result. Above the route the loop outlives the page
 * and the reply lands whether or not the user is watching — matching the
 * search pollers' refetchIntervalInBackground.
 *
 * Scope is the browser session, not the account, so the conversation is
 * dropped on logout; see the apiKey effect below.
 */
export function ChatProvider({ children }: { children: ReactNode }) {
  const { apiKey } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [steps, setSteps] = useState<TraceStep[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const modelCotHistory = useRef<string[]>([]);
  const conversationHistory = useRef<string[]>([]);

  // Cancellation: cancelRef breaks the poll loop; wakeRef unblocks the current sleep.
  const cancelRef = useRef(false);
  const wakeRef = useRef<(() => void) | null>(null);

  const cancel = useCallback(() => {
    cancelRef.current = true;
    wakeRef.current?.();
  }, []);

  const reset = useCallback(() => {
    cancel();
    modelCotHistory.current = [];
    conversationHistory.current = [];
    setMessages([]);
    setSteps([]);
    setIsThinking(false);
    setError(null);
  }, [cancel]);

  // The conversation now outlives the page, so it would also outlive a logout
  // and be waiting for whoever signs in next on this browser. Drop it when the
  // key changes. The first transition is null -> key on hydration, when there
  // is nothing to drop.
  const lastApiKey = useRef(apiKey);
  useEffect(() => {
    if (lastApiKey.current !== apiKey) {
      lastApiKey.current = apiKey;
      reset();
    }
  }, [apiKey, reset]);

  const send = useCallback(
    async (message: string) => {
      if (!apiKey || !message.trim() || isThinking) return;
      cancelRef.current = false;
      wakeRef.current = null;
      setError(null);
      setSteps([]);
      setMessages((m) => [...m, { role: "user", content: message }]);
      setIsThinking(true);
      const startMs = Date.now();

      try {
        const { jobId } = await submitChat({
          message,
          modelCotHistory: modelCotHistory.current,
          conversationHistory: conversationHistory.current,
          apiKey,
        });

        const deadline = Date.now() + POLL_TIMEOUT_MS;
        let sinceIndex = 0;

        while (Date.now() < deadline) {
          if (cancelRef.current) break;

          // Abortable sleep: resolves early if cancel() fires wakeRef.
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, POLL.searchStatus);
            wakeRef.current = () => { clearTimeout(timer); resolve(); };
          });

          if (cancelRef.current) break;

          try {
            const t = await getChatTraces(apiKey, sinceIndex);
            if (t.traces.length > 0) {
              sinceIndex = t.latest_index + 1;
              setSteps((prev) => {
                const next = [...prev];
                for (const tr of t.traces) {
                  if (isHiddenTrace(tr)) continue;
                  const step = traceStep(tr);
                  if (!step.text) continue;
                  const last = next[next.length - 1];
                  if (last && last.label === step.label && last.text === step.text) continue;
                  next.push(step);
                }
                return next;
              });
            }
          } catch {
            /* ignore trace failures */
          }

          if (cancelRef.current) break;

          const status = await getChatStatus(jobId);
          if (status.status === "completed") {
            const raw = status.result?.model_response ?? "";
            const cot = status.result?.in_conversation_information ?? "";
            const clean = extractChatResponse(raw);

            modelCotHistory.current.push(cot);
            conversationHistory.current.push(`USER: ${message}`);
            conversationHistory.current.push(`ASSISTANT: ${stripBase64FromText(clean)}`);

            setMessages((m) => [
              ...m,
              {
                role: "assistant",
                content: clean,
                images: status.result?.map_bytes ?? [],
                responseTimeMs: Date.now() - startMs,
              },
            ]);
            setIsThinking(false);
            setSteps([]);
            return;
          }
          if (status.status === "failed") {
            throw new Error(status.error ?? "Chat processing failed");
          }
        }

        // Cancelled — clean exit, no error shown.
        if (cancelRef.current) {
          setIsThinking(false);
          setSteps([]);
          return;
        }

        throw new Error("Chat request timed out.");
      } catch (err) {
        if (cancelRef.current) {
          setIsThinking(false);
          setSteps([]);
          return;
        }
        setError(err instanceof Error ? err.message : "Chat error");
        setIsThinking(false);
      }
    },
    [apiKey, isThinking],
  );

  const value = useMemo<ChatContextValue>(
    () => ({ messages, steps, isThinking, error, send, cancel, reset }),
    [messages, steps, isThinking, error, send, cancel, reset],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat must be used within <ChatProvider>");
  return ctx;
}
