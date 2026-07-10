"use client";

import Link from "next/link";
import Image from "next/image";
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

  useEffect(() => {
    if (!authenticated) router.replace("/login");
  }, [authenticated, router]);

  if (!authenticated) return null;

  return (
    <div className="min-h-screen">
      {/* Header — black so the dark-background logo blends naturally */}
      <header className="flex items-center justify-between gap-2 bg-black px-4 py-3 shadow-sm sm:px-6">
        <div className="flex items-center gap-2 sm:gap-3">
          <Image
            src="/eikon_logo.png"
            alt="EIKON logo"
            width={40}
            height={40}
            className="h-8 w-8 rounded-full sm:h-10 sm:w-10"
          />
          <span className="text-xl font-bold tracking-tight text-white sm:text-2xl">EIKON</span>
        </div>
        <div className="flex items-center gap-2 text-sm text-white/80 sm:gap-4">
          <span
            className="whitespace-nowrap rounded-full bg-white/20 px-3 py-1 font-medium text-white"
            title="API credit balance (GBP)"
          >
            £{formatCredits(credits?.balance)}
          </span>
          {/* Email is the widest element — drop it on phones to save space. */}
          <span className="hidden truncate md:inline">{userEmail}</span>
          <button
            onClick={logout}
            className="whitespace-nowrap rounded border border-white/40 px-3 py-1 text-white hover:bg-white/10"
          >
            Sign out
          </button>
        </div>
      </header>

      {/* Tab navigation — horizontal-scroll strip on mobile so all tabs stay
          reachable via swipe; a right-edge fade hints there's more to scroll. */}
      <div className="relative border-b">
        <nav className="scrollbar-hide flex gap-6 overflow-x-auto whitespace-nowrap px-4 sm:px-6">
          {TABS.map((t) => {
            const active = pathname === t.href;
            return (
              <Link
                key={t.href}
                href={t.href}
                className={`shrink-0 border-b-2 py-3 text-sm font-medium transition-colors ${
                  active
                    ? "border-eikon-navy text-eikon-navy font-bold"
                    : "border-transparent text-eikon-muted hover:text-eikon-navy"
                }`}
              >
                {t.label}
              </Link>
            );
          })}
        </nav>
        {/* Fade cue at the right edge (mobile only). */}
        <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-white to-transparent sm:hidden" />
      </div>

      <main className="p-4 sm:p-6">{children}</main>
    </div>
  );
}
