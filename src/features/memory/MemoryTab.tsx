"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getMemory, reflectMemory, deleteSnippet } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

const TYPE_LABEL: Record<string, string> = {
  fact: "F",
  preference: "P",
  correction: "C",
  project_context: "PC",
};

/** Replaces render_memory_tab: view reflection + snippets, reflect, delete. */
export function MemoryTab() {
  const { apiKey } = useAuth();
  const qc = useQueryClient();

  const memory = useQuery({
    queryKey: ["memory", apiKey],
    queryFn: () => getMemory(apiKey as string),
    enabled: !!apiKey,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["memory", apiKey] });

  const reflect = useMutation({
    mutationFn: () => reflectMemory(apiKey as string),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (snippetId: string) => deleteSnippet(apiKey as string, snippetId),
    onSuccess: invalidate,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-eikon-navy">EIKON Memory</h1>
        <p className="text-sm text-eikon-muted">
          What EIKON remembers about you across conversations. You can delete any snippet.
        </p>
      </div>

      {memory.isLoading && <p className="text-sm text-eikon-muted">Loading memories…</p>}
      {memory.error && (
        <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          {memory.error instanceof Error ? memory.error.message : "Could not load memories"}
        </p>
      )}

      {memory.data && (
        <>
          {memory.data.reflection && (
            <section className="rounded-lg border p-4">
              <h2 className="font-semibold text-eikon-navy">User Profile</h2>
              <p className="text-xs text-eikon-muted">
                Last updated: {memory.data.reflection.created_at.slice(0, 10)} (v
                {memory.data.reflection.version})
              </p>
              <p className="mt-2 whitespace-pre-wrap text-sm">
                {memory.data.reflection.content}
              </p>
            </section>
          )}

          <div className="flex items-center gap-6">
            <button
              onClick={() => reflect.mutate()}
              disabled={reflect.isPending}
              className="rounded bg-eikon-orange px-4 py-2 text-white disabled:opacity-50"
            >
              {reflect.isPending ? "Generating…" : "Generate reflection"}
            </button>
            <div className="text-sm text-eikon-muted">
              <div>Total active snippets: {memory.data.snippets.length}</div>
              <div>Since last reflection: {memory.data.snippetCountSinceReflection}</div>
            </div>
          </div>

          <section>
            <h2 className="mb-2 font-semibold text-eikon-navy">
              Memory Snippets ({memory.data.snippets.length})
            </h2>
            {memory.data.snippets.length === 0 ? (
              <p className="text-sm text-eikon-muted">
                No memories yet. EIKON will start remembering things as you chat.
              </p>
            ) : (
              <ul className="space-y-2">
                {memory.data.snippets.map((s) => (
                  <li
                    key={s.id}
                    className="flex items-start justify-between gap-3 rounded border p-3"
                  >
                    <div className="text-sm">
                      <span className="mr-2 rounded bg-eikon-panel px-1.5 py-0.5 text-xs font-semibold text-eikon-navy">
                        {TYPE_LABEL[s.type] ?? "?"}
                      </span>
                      {s.content}
                      <div className="mt-1 text-xs text-eikon-muted">
                        {s.created_at.slice(0, 10)} | {s.type}
                      </div>
                    </div>
                    <button
                      onClick={() => remove.mutate(s.id)}
                      disabled={remove.isPending}
                      className="shrink-0 text-sm text-red-600 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
