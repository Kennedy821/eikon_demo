"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { getHistory, type PreviousSearch } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

/**
 * Replaces render_history_tab. The Streamlit "current session" history relied
 * on st.session_state across reruns; here previous searches are fetched from
 * the API on demand (the durable source). Capped at 5 server-side; we ask for 3.
 */
export function HistoryTab() {
  const { apiKey } = useAuth();
  const load = useMutation({
    mutationFn: () => getHistory(apiKey as string, 3),
  });

  const searches = load.data?.searches ?? [];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-eikon-navy">Search History</h1>

      <button
        onClick={() => load.mutate()}
        disabled={load.isPending}
        className="rounded bg-eikon-orange px-4 py-2 text-white disabled:opacity-50"
      >
        {load.isPending ? "Fetching…" : "Load previous searches"}
      </button>

      {load.error && (
        <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          {load.error instanceof Error ? load.error.message : "Failed to load history"}
        </p>
      )}

      {load.isSuccess && searches.length === 0 && (
        <p className="text-sm text-eikon-muted">No previous searches found for this account.</p>
      )}

      {searches.map((s, i) => (
        <SearchBlock key={i} index={i} search={s} />
      ))}
    </div>
  );
}

function SearchBlock({ index, search }: { index: number; search: PreviousSearch }) {
  const [open, setOpen] = useState(index === 0);
  return (
    <div className="rounded-lg border">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-2 text-left font-medium text-eikon-navy"
      >
        <span>
          Search {index + 1} — {search.rows.length} result(s)
        </span>
        <span>{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="overflow-x-auto border-t">
          <table className="w-full text-sm">
            <thead className="bg-eikon-panel text-left text-eikon-navy">
              <tr>
                {search.columns.map((c) => (
                  <th key={c} className="px-3 py-2">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {search.rows.map((row, r) => (
                <tr key={r} className="border-t">
                  {search.columns.map((c) => (
                    <td key={c} className="px-3 py-2">
                      {String(row[c] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
