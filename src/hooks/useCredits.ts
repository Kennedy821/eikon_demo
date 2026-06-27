"use client";

import { useQuery } from "@tanstack/react-query";
import { getCredits } from "@/lib/api";
import { STALE } from "@/lib/config";
import { useAuth } from "./useAuth";

/**
 * Credit balance — replaces get_user_credit_balance + its manual 60s
 * session_state cache with a TanStack Query staleTime.
 */
export function useCredits() {
  const { apiKey } = useAuth();
  return useQuery({
    queryKey: ["credits", apiKey],
    queryFn: () => getCredits(apiKey as string),
    enabled: !!apiKey,
    staleTime: STALE.credits,
  });
}

/** Compact display — mirrors format_credit_balance(). */
export function formatCredits(balance: number | null | undefined): string {
  if (balance === null || balance === undefined) return "—";
  const abs = Math.abs(balance);
  if (abs < 10) return balance.toFixed(2);
  if (abs < 1000) return balance.toFixed(0);
  if (abs < 1_000_000) {
    const v = balance / 1000;
    return v === Math.trunc(v) ? `${Math.trunc(v)}K` : `${v.toFixed(1)}K`;
  }
  const v = balance / 1_000_000;
  return v === Math.trunc(v) ? `${Math.trunc(v)}M` : `${v.toFixed(1)}M`;
}
