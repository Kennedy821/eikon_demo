"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useState, type ReactNode } from "react";
import { AuthProvider } from "@/hooks/useAuth";
import { ChatProvider } from "@/hooks/useChat";
import { PageContextProvider } from "@/hooks/usePageContext";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Sensible defaults that replace Streamlit's manual caching.
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        {/* Both above the route: the conversation survives a tab change the
            way an in-flight search does, and the chat can read what the tab
            behind it is showing. Page context wraps the chat because the chat
            reads it, never the other way round. */}
        <PageContextProvider>
          <ChatProvider>{children}</ChatProvider>
        </PageContextProvider>
      </AuthProvider>
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}
