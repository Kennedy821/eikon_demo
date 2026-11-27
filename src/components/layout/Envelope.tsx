"use client";

import type { ReactNode } from "react";

/**
 * A titled section that opens and closes.
 *
 * Distinct from a plain bordered panel on purpose: the left accent bar, the
 * tinted header strip and the chevron together say "this one opens", so an
 * envelope is never mistaken for a box you only read.
 *
 * Always controlled. A details element toggles itself natively, so the parent
 * is told through onOpenChange rather than being the only thing that can move
 * it — which is what lets a tab close the map on its own when results land
 * while leaving the user free to open it again.
 */

export type EnvelopeTone = "neutral" | "desired" | "undesired";

/**
 * Whole class names, because Tailwind emits only the classes it can read in
 * the source — one assembled at runtime resolves to nothing.
 */
const TONES: Record<EnvelopeTone, string> = {
  neutral: "border-l-eikon-accent",
  desired: "border-l-eikon-midnight",
  undesired: "border-l-[#FF8C00]",
};

export function Envelope({
  title,
  meta,
  tone = "neutral",
  open,
  onOpenChange,
  children,
}: {
  title: string;
  /** Right-aligned summary text — a count, a total, a state. */
  meta?: ReactNode;
  tone?: EnvelopeTone;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <details
      open={open}
      onToggle={(e) => onOpenChange(e.currentTarget.open)}
      className={`group overflow-hidden rounded-lg border border-l-4 ${TONES[tone]}`}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 bg-eikon-panel px-4 py-3 text-sm font-semibold text-eikon-midnight [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 items-center gap-2">
          {/* Rotates on open, so the strip reads as something to press. The
              transform is set outright rather than through rotate-90, whose
              CSS variables do not compose on an SVG element here. */}
          <svg
            viewBox="0 0 8 12"
            aria-hidden="true"
            className="h-3 w-3 shrink-0 text-eikon-muted transition-transform group-open:[transform:rotate(90deg)]"
          >
            <path
              d="M1 1l5 5-5 5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="truncate">{title}</span>
        </span>
        {meta !== undefined && (
          <span className="shrink-0 font-normal text-eikon-muted">{meta}</span>
        )}
      </summary>
      <div className="space-y-2 border-t px-4 pb-4 pt-3">{children}</div>
    </details>
  );
}
