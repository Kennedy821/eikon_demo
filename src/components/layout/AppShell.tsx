"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useCredits, formatCredits } from "@/hooks/useCredits";

/** Top-level tabs — mirror active_main_tab options in eikon_demo_app_beta.py. */
const TABS = [
  { href: "/chat", label: "Eikon AI" },
  { href: "/search", label: "Search" },
  { href: "/context", label: "Context" },
  { href: "/similarity", label: "Similarity" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/object-detection", label: "Object Detection" },
  { href: "/drone-corridor", label: "Drone Corridor" },
  { href: "/memory", label: "Memory" },
  { href: "/history", label: "History" },
  { href: "/docs", label: "Docs" },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { authenticated, userEmail, logout } = useAuth();
  const { data: credits } = useCredits();

  // Route guard — replaces the `if not authenticated: render_login_page()` gate.
  useEffect(() => {
    if (!authenticated) router.replace("/login");
  }, [authenticated, router]);

  if (!authenticated) return null;

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <span className="text-2xl font-bold text-eikon-navy">EIKON</span>
        <div className="flex items-center gap-4 text-sm text-eikon-muted">
          <span
            className="rounded-full bg-eikon-panel px-3 py-1 font-medium text-eikon-navy"
            title="API credit balance (GBP)"
          >
            £{formatCredits(credits?.balance)}
          </span>
          <span>{userEmail}</span>
          <button
            onClick={logout}
            className="rounded border px-3 py-1 hover:bg-eikon-panel"
          >
            Sign out
          </button>
        </div>
      </header>

      <nav className="flex gap-6 border-b px-6">
        {TABS.map((t) => {
          const active = pathname === t.href;
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`border-b-2 py-3 text-sm font-medium ${
                active
                  ? "border-eikon-navy text-eikon-navy"
                  : "border-transparent text-eikon-muted hover:text-eikon-navy"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>

      <main className="p-6">{children}</main>
    </div>
  );
}
