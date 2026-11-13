"use client";

import { useChat } from "@/hooks/useChat";

/**
 * Starts a fresh conversation.
 *
 * The conversation outlives the page now, so without this there was no way to
 * end one: it followed the user between tabs for the whole browser session and
 * only a reload cleared it.
 *
 * Always rendered, and disabled rather than hidden when the conversation is
 * already empty. Hiding it made it unfindable precisely when someone went
 * looking for it, since an empty conversation is the state you are in when you
 * are hunting for the way to get one.
 *
 * This sits alongside Stop rather than replacing it, and both are available
 * while a question is in flight — they do different jobs. Stop abandons the
 * answer and keeps the thread; this ends the thread. Note that neither reaches
 * the backend: the job that was submitted still runs there to completion.
 *
 * No confirmation step. Clearing is the ordinary way to start a new question
 * rather than a destructive action, and a dialog on every "new chat" would be
 * in the way far more often than it saved anyone.
 */
export function ClearConversationButton() {
  const { messages, isThinking, reset } = useChat();
  const nothingToClear = messages.length === 0 && !isThinking;

  return (
    <button
      type="button"
      onClick={reset}
      disabled={nothingToClear}
      title={
        nothingToClear
          ? "This conversation is already empty"
          : "Clear this conversation and start a new one"
      }
      className="shrink-0 whitespace-nowrap rounded border px-2 py-1 text-xs text-eikon-muted transition-colors hover:bg-eikon-panel hover:text-eikon-midnight disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-eikon-muted"
    >
      New chat
    </button>
  );
}
