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

/**
 * Chat lifecycle — ports send_chat_message():
 *   submit -> poll status until completed, polling reasoning traces alongside.
 * Maintains model_cot_history and conversation_history exactly as the app did,
 * but with React state instead of st.session_state + reruns.
 */
export function useChat() {
  const { apiKey } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // Activity timeline: each trace as { label, text }, with consecutive exact
  // duplicates suppressed. Drives the live "thinking" view.
  const [steps, setSteps] = useState<TraceStep[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Histories kept across turns (last-10 windows are applied server-side).
  const modelCotHistory = useRef<string[]>([]);
  const conversationHistory = useRef<string[]>([]);

  const send = useCallback(
    async (message: string) => {
      if (!apiKey || !message.trim() || isThinking) return;
      setError(null);
      setSteps([]);
      setMessages((m) => [...m, { role: "user", content: message }]);
      setIsThinking(true);

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
          await new Promise((r) => setTimeout(r, POLL.searchStatus));

          // Reasoning traces (best-effort, like the Python loop). Append each
          // new trace as a { label, summary } step, skipping empties and exact
          // consecutive duplicates so the timeline stays clean.
          try {
            const t = await getChatTraces(apiKey, sinceIndex);
            if (t.traces.length > 0) {
              sinceIndex = t.latest_index + 1;
              setSteps((prev) => {
                const next = [...prev];
                for (const tr of t.traces) {
                  if (isHiddenTrace(tr)) continue; // never surface "Reflecting"
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
        throw new Error("Chat request timed out.");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Chat error");
        setIsThinking(false);
      }
    },
    [apiKey, isThinking],
  );

  return { messages, steps, isThinking, error, send };
}
