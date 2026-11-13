"use client";

import { Conversation } from "./Conversation";
import { ClearConversationButton } from "./ClearConversationButton";

/**
 * Eikon AI chat — replaces render_ai_chat_tab.
 *
 * The page chrome only. The transcript and composer live in <Conversation>,
 * shared with the side panel that docks to the analysis tabs so both are
 * views of one conversation rather than two implementations of it.
 *
 * Layout notes: the conversation uses the full content width (no narrow
 * centered column). Text stays at a readable measure, but assistant responses
 * can break out wider to render multiple images in a responsive grid — so a
 * data-rich answer (e.g. several satellite tiles) tiles cleanly instead of
 * stacking in a thin column.
 */
export function ChatTab() {
  return (
    <div className="flex h-[calc(100vh-150px)] flex-col">
      <div className="mb-3 flex items-baseline justify-between">
        <h1 className="text-2xl font-bold text-eikon-midnight">Eikon AI</h1>
        <ClearConversationButton />
      </div>

      <Conversation />
    </div>
  );
}
