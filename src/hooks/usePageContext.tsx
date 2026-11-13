"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { PageSnapshot } from "@/lib/pageContext";

interface PageContextValue {
  /** What the visible tab is currently showing, or null if it has nothing. */
  snapshot: PageSnapshot | null;
  /** Read the latest snapshot without subscribing — for use inside callbacks. */
  readSnapshot: () => PageSnapshot | null;
  publish: (snapshot: PageSnapshot | null) => void;
}

const PageContext = createContext<PageContextValue | null>(null);

/**
 * Holds what the tab behind the chat panel is showing.
 *
 * It lives above the route for the same reason the conversation does: the
 * panel and the tab are separate components, and this is how one reaches the
 * other without the tabs knowing the chat exists at all. A tab publishes; it
 * does not import anything from the chat.
 *
 * Exactly one tab publishes at a time. Each clears on unmount, so the snapshot
 * always belongs to the tab currently on screen and the chat can never answer
 * from a previous tab's results — which matters because four of the six tabs
 * lose their results on navigation anyway, and a stale snapshot would claim
 * otherwise.
 */
export function PageContextProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<PageSnapshot | null>(null);

  // The chat reads this when a message is sent, inside a callback that must
  // not re-create itself every time a tab's results change.
  const ref = useRef<PageSnapshot | null>(null);
  ref.current = snapshot;

  const value = useMemo<PageContextValue>(
    () => ({
      snapshot,
      readSnapshot: () => ref.current,
      publish: setSnapshot,
    }),
    [snapshot],
  );

  return <PageContext.Provider value={value}>{children}</PageContext.Provider>;
}

export function usePageContext(): PageContextValue {
  const ctx = useContext(PageContext);
  if (!ctx) throw new Error("usePageContext must be used within <PageContextProvider>");
  return ctx;
}

/**
 * Publish this tab's current contents to the chat, and withdraw them when the
 * tab goes away.
 *
 * Pass null while there is nothing worth sending — before a run has produced
 * results, say — and the chat is simply told nothing about the page.
 *
 * The snapshot must be memoised by the caller (useMemo over the state it is
 * built from). It is an object literal rebuilt on every render otherwise, and
 * the effect would publish on every render for ever.
 */
export function usePublishPageContext(snapshot: PageSnapshot | null) {
  const { publish } = usePageContext();

  useEffect(() => {
    publish(snapshot);
    return () => publish(null);
  }, [snapshot, publish]);
}
