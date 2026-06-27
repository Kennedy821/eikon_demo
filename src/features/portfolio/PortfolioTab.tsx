"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { runPortfolio, type PortfolioPair } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { PortfolioResults } from "./PortfolioResults";

const RESOLUTIONS = ["low", "medium", "high"];
const SIM_TYPES = ["combined", "visual", "descriptive"];

// Example data from render_portfolio_tab: Wembley vs London landmarks.
const EXAMPLE: PortfolioPair[] = [
  { orig: "wembley", dest: "olympic_park", origLat: 51.556, origLon: -0.2795, destLat: 51.543, destLon: -0.0134 },
  { orig: "wembley", dest: "o2_arena", origLat: 51.556, origLon: -0.2795, destLat: 51.503, destLon: 0.0032 },
  { orig: "wembley", dest: "hyde_park", origLat: 51.556, origLon: -0.2795, destLat: 51.5073, destLon: -0.1657 },
  { orig: "wembley", dest: "regents_park", origLat: 51.556, origLon: -0.2795, destLat: 51.5313, destLon: -0.157 },
  { orig: "wembley", dest: "heathrow", origLat: 51.556, origLon: -0.2795, destLat: 51.47, destLon: -0.4543 },
];

const BLANK_PAIR: PortfolioPair = {
  orig: "",
  dest: "",
  origLat: 51.556,
  origLon: -0.2795,
  destLat: 51.5074,
  destLon: -0.1278,
};

const CSV_COLUMNS = [
  "orig",
  "dest",
  "orig_latitude",
  "orig_longitude",
  "dest_latitude",
  "dest_longitude",
] as const;

/** Parse a CSV with the required portfolio columns into pairs. */
function parseCsv(text: string): PortfolioPair[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) throw new Error("CSV has no data rows");
  const header = lines[0].split(",").map((h) => h.trim());
  const missing = CSV_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length) throw new Error(`Missing required columns: ${missing.join(", ")}`);
  const idx = (c: string) => header.indexOf(c);
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    return {
      orig: cells[idx("orig")]?.trim() ?? "",
      dest: cells[idx("dest")]?.trim() ?? "",
      origLat: parseFloat(cells[idx("orig_latitude")]),
      origLon: parseFloat(cells[idx("orig_longitude")]),
      destLat: parseFloat(cells[idx("dest_latitude")]),
      destLon: parseFloat(cells[idx("dest_longitude")]),
    };
  });
}

export function PortfolioTab() {
  const { apiKey } = useAuth();
  const [resolution, setResolution] = useState("medium");
  const [similarityType, setSimilarityType] = useState("combined");
  const [pairs, setPairs] = useState<PortfolioPair[]>(EXAMPLE);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [resultView, setResultView] = useState<"Map" | "Chart" | "Table">("Map");

  const run = useMutation({
    mutationFn: () =>
      runPortfolio({ pairs, resolution, similarityType, apiKey: apiKey as string }),
  });

  function updatePair(i: number, patch: Partial<PortfolioPair>) {
    setPairs((p) => p.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  }

  async function onCsv(e: React.ChangeEvent<HTMLInputElement>) {
    setCsvError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setPairs(parseCsv(await file.text()));
    } catch (err) {
      setCsvError(err instanceof Error ? err.message : "Could not parse CSV");
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-eikon-navy">Portfolio Comparison</h1>
        <p className="text-sm text-eikon-muted">
          Compare multiple location pairs in batch. Upload a CSV, enter pairs manually,
          or use the example data.
        </p>
      </div>

      {/* Two-column layout mirrors st.columns([1, 2]): config left, data + results right. */}
      <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
        {/* ---- Left: configuration ---- */}
        <div className="space-y-3 rounded-lg border p-4">
          <h2 className="text-sm font-semibold text-eikon-navy">Configuration</h2>

          <label className="block text-sm">
            <span className="mb-1 block text-eikon-muted">Resolution</span>
            <select
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
              className="w-full rounded border px-2 py-1.5"
            >
              {RESOLUTIONS.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-eikon-muted">Similarity type</span>
            <select
              value={similarityType}
              onChange={(e) => setSimilarityType(e.target.value)}
              className="w-full rounded border px-2 py-1.5"
            >
              {SIM_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>

          <div className="space-y-2 border-t pt-3">
            <span className="block text-sm font-medium text-eikon-navy">Input data</span>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => setPairs(EXAMPLE)}
                className="rounded border px-3 py-1.5 text-sm text-eikon-navy"
              >
                Load example data
              </button>
              <label className="cursor-pointer rounded border px-3 py-1.5 text-center text-sm text-eikon-navy">
                Upload CSV
                <input type="file" accept=".csv" onChange={onCsv} className="hidden" />
              </label>
              <button
                onClick={() => setPairs((p) => [...p, { ...BLANK_PAIR }])}
                className="rounded border px-3 py-1.5 text-sm text-eikon-navy"
              >
                Add pair
              </button>
            </div>
            {csvError && <p className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">{csvError}</p>}
          </div>

          <button
            onClick={() => run.mutate()}
            disabled={run.isPending || pairs.length === 0}
            className="w-full rounded bg-eikon-orange px-4 py-2 text-white disabled:opacity-50"
          >
            {run.isPending ? "Comparing…" : "Run comparison"}
          </button>
        </div>

        {/* ---- Right: input table + results ---- */}
        <div className="min-w-0 space-y-4">
          <div>
            <h2 className="mb-2 text-sm font-semibold text-eikon-navy">
              Location pairs ({pairs.length})
            </h2>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-eikon-panel text-left text-eikon-navy">
                  <tr>
                    <th className="px-2 py-2">Orig ID</th>
                    <th className="px-2 py-2">Orig lat</th>
                    <th className="px-2 py-2">Orig lon</th>
                    <th className="px-2 py-2">Dest ID</th>
                    <th className="px-2 py-2">Dest lat</th>
                    <th className="px-2 py-2">Dest lon</th>
                    <th className="px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {pairs.map((p, i) => (
                    <tr key={i} className="border-t">
                      <Cell value={p.orig} onChange={(v) => updatePair(i, { orig: v })} />
                      <NumCell value={p.origLat} onChange={(v) => updatePair(i, { origLat: v })} />
                      <NumCell value={p.origLon} onChange={(v) => updatePair(i, { origLon: v })} />
                      <Cell value={p.dest} onChange={(v) => updatePair(i, { dest: v })} />
                      <NumCell value={p.destLat} onChange={(v) => updatePair(i, { destLat: v })} />
                      <NumCell value={p.destLon} onChange={(v) => updatePair(i, { destLon: v })} />
                      <td className="px-2 py-1">
                        <button
                          onClick={() => setPairs((rows) => rows.filter((_, j) => j !== i))}
                          className="text-red-600"
                          title="Remove"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {run.error && (
            <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
              {run.error instanceof Error ? run.error.message : "Comparison failed"}
            </p>
          )}

          {run.data ? (
            <PortfolioResults
              results={run.data.results}
              pairs={pairs}
              view={resultView}
              onView={setResultView}
            />
          ) : (
            <div className="flex min-h-[160px] items-center justify-center rounded-lg border border-dashed text-sm text-eikon-muted">
              Run the comparison to see similarity results.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Cell({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <td className="px-2 py-1">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-24 rounded border px-2 py-1"
      />
    </td>
  );
}

function NumCell({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <td className="px-2 py-1">
      <input
        type="number"
        step="any"
        value={Number.isFinite(value) ? value : ""}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-28 rounded border px-2 py-1"
      />
    </td>
  );
}
