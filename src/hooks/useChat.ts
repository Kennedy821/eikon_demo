"use client";

import { useCallback, useRef, useState } from "react";
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

export function useChat() {
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

  return { messages, steps, isThinking, error, send, cancel };
}
