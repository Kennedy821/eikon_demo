"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useChat } from "@/hooks/useChat";
import { usePageContext } from "@/hooks/usePageContext";
import { describeSnapshot } from "@/lib/pageContext";
import { Conversation } from "./Conversation";
import { ClearConversationButton } from "./ClearConversationButton";

/**
 * Eikon AI docked to the right-hand edge of the analysis tabs.
 *
 * These are the tabs where a question is about what is already on screen —
 * the cells a search returned, the area being assessed — so the chat comes to
 * the work instead of the work being left behind on another tab. The Eikon AI
 * tab is deliberately absent: it is this same conversation at full width, and
 * a panel over it would be a second copy of what is already there.
 */
const DOCKED_ROUTES: readonly string[] = [
  "/search",
  "/context",
  "/similarity",
  "/risk-assessment",
  "/drone-corridor",
  "/remote-assessment",
];

/**
 * AppShell is rendered per page, so moving between two docked tabs unmounts
 * the dock and would close an open panel every time. The open flag is stored
 * for the session, the same way the active search job is, so the panel stays
 * as it was left while the user moves around.
 */
const OPEN_KEY = "eikon_chat_dock_open";

function readOpen(): boolean {
  try {
    return sessionStorage.getItem(OPEN_KEY) === "true";
  } catch {
    return false;
  }
}

export function ChatDock() {
  const pathname = usePathname();
  const { isThinking } = useChat();
  const { snapshot } = usePageContext();
  // Starts closed and adopts the stored value after mount: reading storage
  // during render would disagree with the server-rendered markup.
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(readOpen());
  }, []);

  function toggle(next: boolean) {
    setOpen(next);
    try {
      sessionStorage.setItem(OPEN_KEY, String(next));
    } catch {
      /* storage unavailable — the panel still opens, just not for the next tab */
    }
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") toggle(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!DOCKED_ROUTES.includes(pathname)) return null;

  return (
    <>
      {/* Handle. Hidden while the panel is open so it cannot sit on top of it. */}
      <button
        type="button"
        onClick={() => toggle(true)}
        aria-label="Ask EIKON"
        className={`fixed right-0 top-1/2 z-50 -translate-y-1/2 rounded-l-lg bg-eikon-navy py-4 pl-2 pr-1.5 text-white shadow-lg transition hover:bg-eikon-midnight ${
          open ? "pointer-events-none opacity-0" : "opacity-100"
        }`}
      >
        <span className="flex flex-col items-center gap-2">
          <ChatIcon />
          <span className="text-xs font-semibold tracking-wide [writing-mode:vertical-rl]">
            Ask EIKON
          </span>
          {/* Only cue while a question is in flight, so a closed panel still
              shows that EIKON is working on something. */}
          {isThinking && <span className="h-2 w-2 animate-pulse rounded-full bg-white" />}
        </span>
      </button>

      {/* Panel. Always mounted so it can slide rather than appear, and so the
          transcript's scroll position survives a close. No backdrop: the point
          is to ask about the map underneath, which has to stay usable. */}
      <aside
        aria-hidden={!open}
        aria-label="Eikon AI"
        className={`fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l bg-white shadow-2xl transition-transform duration-200 ease-out sm:w-[420px] ${
          open ? "translate-x-0" : "pointer-events-none translate-x-full"
        }`}
      >
        <div className="flex shrink-0 items-center justify-between border-b px-4 py-3">
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="shrink-0 text-sm font-bold text-eikon-midnight">Eikon AI</span>
            {/* What the tab behind is handing to the model. Shown because the
                attachment is otherwise invisible: without it a user cannot
                tell whether an answer drew on their results or was guessed,
                and cannot tell that re-running a search changed what EIKON
                can see. */}
            {snapshot && (
              <span
                className="truncate rounded-full bg-eikon-panel px-2 py-0.5 text-xs text-eikon-midnight"
                title="These results are sent with your next message"
              >
                Reading {describeSnapshot(snapshot)}
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <ClearConversationButton />
            <button
              type="button"
              onClick={() => toggle(false)}
              aria-label="Close Eikon AI"
              className="rounded p-1 text-eikon-muted transition-colors hover:bg-eikon-panel hover:text-eikon-midnight"
            >
              <CloseIcon />
            </button>
          </div>
        </div>

        <Conversation compact />
      </aside>
    </>
  );
}

function ChatIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" width="16" height="16" aria-hidden>
      <path d="M8 1.5c-3.6 0-6.5 2.4-6.5 5.3 0 1.7 1 3.2 2.5 4.2v2.5l2.4-1.4c.5.1 1 .2 1.6.2 3.6 0 6.5-2.4 6.5-5.5S11.6 1.5 8 1.5z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" width="16" height="16" aria-hidden>
      <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
    </svg>
  );
}
