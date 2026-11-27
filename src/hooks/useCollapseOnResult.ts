"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Open state for a section that should get out of the way once there is
 * something to look at.
 *
 * The drawing maps live in the left-hand panel, and the result of every one of
 * these tabs is itself a map. Leaving both open puts two maps side by side,
 * which is a poor way to read either, so the input map folds away the moment
 * results arrive — and unfolds again when they are cleared, since the usual
 * reason to reset is to redraw.
 *
 * Only the transitions move it. A user who opens the map back up while results
 * are on screen is left alone, because `hasResult` has not changed.
 */
export function useCollapseOnResult(hasResult: boolean) {
  const [open, setOpen] = useState(!hasResult);
  const previous = useRef(hasResult);

  useEffect(() => {
    if (hasResult !== previous.current) {
      setOpen(!hasResult);
      previous.current = hasResult;
    }
  }, [hasResult]);

  return [open, setOpen] as const;
}
