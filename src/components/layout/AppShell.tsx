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
      {/* Header — midnight blue so the dark-background logo blends naturally */}
      <header className="flex items-center justify-between bg-black px-6 py-3 shadow-sm">
        <div className="flex items-center gap-3">
          <Image
            src="/eikon_logo.png"
            alt="EIKON logo"
            width={40}
            height={40}
            className="rounded-full"
          />
          <span className="text-2xl font-bold tracking-tight text-white">EIKON</span>
        </div>
        <div className="flex items-center gap-4 text-sm text-white/80">
          <span
            className="rounded-full bg-white/20 px-3 py-1 font-medium text-white"
            title="API credit balance (GBP)"
          >
            £{formatCredits(credits?.balance)}
          </span>
          <span>{userEmail}</span>
          <button
            onClick={logout}
            className="rounded border border-white/40 px-3 py-1 text-white hover:bg-white/10"
          >
            Sign out
          </button>
        </div>
      </header>

      {/* Tab navigation */}
      <nav className="flex gap-6 border-b px-6">
        {TABS.map((t) => {
          const active = pathname === t.href;
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`border-b-2 py-3 text-sm font-medium transition-colors ${
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

      <main className="p-6">{children}</main>
    </div>
  );
}
