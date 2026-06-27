"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";

/** Landing route: send to /chat (default tab in the Streamlit app) or /login. */
export default function Home() {
  const router = useRouter();
  const { authenticated } = useAuth();

  useEffect(() => {
    router.replace(authenticated ? "/chat" : "/login");
  }, [authenticated, router]);

  return (
    <main className="flex min-h-screen items-center justify-center">
      <p className="text-eikon-muted">Loading EIKON…</p>
    </main>
  );
}
