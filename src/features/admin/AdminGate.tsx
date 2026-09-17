"use client";

import type { ReactNode } from "react";
import { useIsAdmin } from "@/hooks/useIsAdmin";

/**
 * Hides admin-only pages from non-admin accounts. The nav already omits the
 * tab; this also covers someone navigating straight to the URL.
 */
export function AdminGate({ children }: { children: ReactNode }) {
  const isAdmin = useIsAdmin();
  if (!isAdmin) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-sm text-eikon-muted">
        This page is not available for your account.
      </div>
    );
  }
  return <>{children}</>;
}
