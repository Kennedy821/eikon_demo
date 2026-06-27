"use client";

import dynamic from "next/dynamic";
import { useMemo } from "react";
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { MapLine, MapPoint } from "@/components/map/PointsMap";
import type { PortfolioPair, PortfolioResult } from "@/lib/api";

const PointsMap = dynamic(() => import("@/components/map/PointsMap"), {
  ssr: false,
  loading: () => <div className="h-[420px] w-full animate-pulse bg-eikon-panel" />,
});

type View = "Map" | "Chart" | "Table";

/** Result row merged with its input coordinates (mirrors the Streamlit merge). */
type MergedRow = PortfolioResult &
  Partial<Pick<PortfolioPair, "origLat" | "origLon" | "destLat" | "destLon">>;

export function PortfolioResults({
  results,
  pairs,
  view,
  onView,
}: {
  results: PortfolioResult[];
  pairs: PortfolioPair[];
  view: View;
  onView: (v: View) => void;
}) {
  const merged: MergedRow[] = useMemo(() => {
    const byKey = new Map(pairs.map((p) => [`${p.orig}|${p.dest}`, p]));
    return results.map((r) => ({ ...byKey.get(`${r.orig}|${r.dest}`), ...r }));
  }, [results, pairs]);

  const sims = merged.map((r) => r.similarity).filter((s): s is number => s !== null);
  const avg = sims.length ? sims.reduce((a, b) => a + b, 0) / sims.length : 0;
  const max = sims.length ? Math.max(...sims) : 0;
  const min = sims.length ? Math.min(...sims) : 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Total Pairs" value={String(results.length)} />
        <Metric label="Avg Similarity" value={pct(avg)} />
        <Metric label="Max Similarity" value={pct(max)} />
        <Metric label="Min Similarity" value={pct(min)} />
      </div>

      <div className="flex gap-2 border-b">
        {(["Map", "Chart", "Table"] as View[]).map((v) => (
          <button
            key={v}
            onClick={() => onView(v)}
            className={`border-b-2 px-3 py-2 text-sm font-medium ${
              view === v
                ? "border-eikon-navy text-eikon-navy"
                : "border-transparent text-eikon-muted hover:text-eikon-navy"
            }`}
          >
            {v}
          </button>
        ))}
      </div>

      {view === "Map" && <PortfolioMap rows={merged} />}
      {view === "Chart" && <PortfolioChart rows={merged} />}
      {view === "Table" && <PortfolioTable rows={merged} />}
    </div>
  );
}

function PortfolioMap({ rows }: { rows: MergedRow[] }) {
  const points: MapPoint[] = [];
  const lines: MapLine[] = [];
  const seen = new Set<string>();

  for (const r of rows) {
    if (r.origLat == null || r.origLon == null || r.destLat == null || r.destLon == null) continue;
    const oKey = `${r.origLat},${r.origLon}`;
    const dKey = `${r.destLat},${r.destLon}`;
    if (!seen.has(oKey)) {
      seen.add(oKey);
      points.push({ lat: r.origLat, lon: r.origLon, color: [255, 100, 100, 200], name: r.orig, type: "Origin", radius: 400 });
    }
    if (!seen.has(dKey)) {
      seen.add(dKey);
      points.push({ lat: r.destLat, lon: r.destLon, color: [100, 100, 255, 200], name: r.dest, type: "Destination", radius: 400 });
    }
    const sim = r.similarity ?? 0;
    lines.push({
      start: [r.origLon, r.origLat],
      end: [r.destLon, r.destLat],
      color: [Math.round(255 * (1 - sim)), Math.round(255 * sim), 100, 150],
      name: `${r.orig} → ${r.dest}`,
      type: `Similarity: ${pct(sim)}`,
    });
  }

  return (
    <div className="space-y-2">
      <PointsMap points={points} lines={lines} zoom={10} />
      <p className="text-xs text-eikon-muted">
        Red points = Origins, Blue points = Destinations. Line colour indicates similarity
        (green = high, red = low).
      </p>
    </div>
  );
}

function PortfolioChart({ rows }: { rows: MergedRow[] }) {
  const data = rows
    .map((r) => ({ pair: `${r.orig} → ${r.dest}`, similarity: r.similarity ?? 0 }))
    .sort((a, b) => a.similarity - b.similarity);

  return (
    <ResponsiveContainer width="100%" height={Math.max(400, data.length * 40)}>
      <BarChart data={data} layout="vertical" margin={{ left: 80 }}>
        <XAxis type="number" domain={[0, 1]} tickFormatter={(v) => pct(v)} />
        <YAxis type="category" dataKey="pair" width={140} tick={{ fontSize: 12 }} />
        <Tooltip formatter={(v: number) => pct(v)} />
        <Bar dataKey="similarity">
          {data.map((d, i) => (
            <Cell
              key={i}
              fill={`rgb(${Math.round(255 * (1 - d.similarity))}, ${Math.round(155 + 100 * d.similarity)}, 80)`}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function PortfolioTable({ rows }: { rows: MergedRow[] }) {
  function download(kind: "csv" | "json") {
    let content: string;
    let mime: string;
    let name: string;
    if (kind === "csv") {
      const cols = ["orig", "dest", "orig_latitude", "orig_longitude", "dest_latitude", "dest_longitude", "similarity"];
      const header = cols.join(",");
      const lines = rows.map((r) =>
        [r.orig, r.dest, r.origLat, r.origLon, r.destLat, r.destLon, r.similarity].join(","),
      );
      content = [header, ...lines].join("\n");
      mime = "text/csv";
      name = "portfolio_comparison_results.csv";
    } else {
      content = JSON.stringify(rows, null, 2);
      mime = "application/json";
      name = "portfolio_comparison_results.json";
    }
    const url = URL.createObjectURL(new Blob([content], { type: mime }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-eikon-panel text-left text-eikon-navy">
            <tr>
              <th className="px-3 py-2">orig</th>
              <th className="px-3 py-2">dest</th>
              <th className="px-3 py-2">similarity</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t">
                <td className="px-3 py-2">{r.orig}</td>
                <td className="px-3 py-2">{r.dest}</td>
                <td className="px-3 py-2">{r.similarity !== null ? pct(r.similarity) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex gap-2">
        <button onClick={() => download("csv")} className="rounded border px-4 py-2 text-sm text-eikon-navy">
          Download CSV
        </button>
        <button onClick={() => download("json")} className="rounded border px-4 py-2 text-sm text-eikon-navy">
          Download JSON
        </button>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-eikon-panel p-3 text-center">
      <div className="text-xs uppercase tracking-wide text-eikon-muted">{label}</div>
      <div className="mt-1 text-2xl font-bold text-eikon-navy">{value}</div>
    </div>
  );
}

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}
