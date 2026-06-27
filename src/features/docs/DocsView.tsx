"use client";

/**
 * Renders the SDK documentation markdown. Replaces render_docs_tab.
 * Formatting is intentionally minimal (raw markdown in a readable block) — a
 * proper markdown renderer can be added later without changing the data flow.
 */
export function DocsView({ content }: { content: string }) {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-eikon-navy">SDK Documentation</h1>
      <pre className="whitespace-pre-wrap rounded-lg border bg-eikon-panel p-4 text-sm leading-relaxed text-gray-800">
        {content}
      </pre>
    </div>
  );
}
