"use client";

import { useQuery } from "@tanstack/react-query";
import { useAuth } from "./useAuth";

/**
 * Whether the signed-in account may see admin-only tabs. Resolved server-side
 * so the allow-list stays out of the bundle. Defaults to false while loading,
 * so an admin tab never flashes for a non-admin.
 */
export function useIsAdmin(): boolean {
  const { userEmail, authenticated } = useAuth();

  const { data } = useQuery({
    queryKey: ["is-admin", userEmail],
    queryFn: async () => {
      const res = await fetch("/api/eikon/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: userEmail }),
      });
      if (!res.ok) return { isAdmin: false };
      return (await res.json()) as { isAdmin: boolean };
    },
    enabled: authenticated && !!userEmail,
    staleTime: 5 * 60_000,
  });

  return data?.isAdmin ?? false;
}
