"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useMutation } from "@tanstack/react-query";
import { getSimilarity } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import type { MapPoint, RGBA } from "@/components/map/PointsMap";

const PointsMap = dynamic(() => import("@/components/map/PointsMap"), {
  ssr: false,
  loading: () => <div className="h-[420px] w-full animate-pulse bg-eikon-panel" />,
});

const RESOLUTIONS = ["low", "medium", "high"];
const SIM_TYPES = ["visual", "descriptive", "combined"] as const;
type SimType = (typeof SIM_TYPES)[number];

const TYPE_DESCRIPTIONS: Record<SimType, string> = {
  visual:
    "Higher scores indicate more visually similar locations based on aerial imagery analysis.",
  descriptive:
    "Higher scores indicate more semantically similar locations based on scene description analysis.",
  combined:
    "Higher scores indicate overall similarity combining both visual and descriptive features.",
};

/**
 * Replaces render_similarity_tab. Like the Streamlit app, the user picks ONE
 * similarity type and only that one is computed — the backend processes these
 * heavy jobs one at a time, so computing all three at once is unreliable.
 */
export function SimilarityTab() {
  const { apiKey } = useAuth();
  const [simType, setSimType] = useState<SimType>("visual");
  // App defaults: Regent's Park and Wimbledon Tennis Club.
  const [a, setA] = useState({ lat: "51.5313", lon: "-0.1570" });
  const [b, setB] = useState({ lat: "51.4337", lon: "-0.2144" });
  const [resolution, setResolution] = useState("medium");

  const sim = useMutation({
    mutationFn: () =>
      getSimilarity({
        location1: [parseFloat(a.lat), parseFloat(a.lon)],
        location2: [parseFloat(b.lat), parseFloat(b.lon)],
        resolution,
        apiKey: apiKey as string,
        type: simType,
      }),
  });

  const score = sim.data?.[simType];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-eikon-navy">Location Similarity</h1>
        <p className="text-sm text-eikon-muted">Compare the similarity between two locations.</p>
      </div>

      {/* Similarity type selector above the columns, mirroring the original. */}
      <label className="block max-w-xs text-sm">
        <span className="mb-1 block text-eikon-muted">Similarity type</span>
        <select
          value={simType}
          onChange={(e) => setSimType(e.target.value as SimType)}
          className="w-full rounded border px-2 py-1.5 capitalize"
        >
          {SIM_TYPES.map((t) => (
            <option key={t} value={t} className="capitalize">
              {t}
            </option>
          ))}
        </select>
      </label>

      {/* Three columns: Location 1 | Location 2 | Settings — matches st.columns([1,1,1]). */}
      <div className="grid gap-4 rounded-lg border p-4 md:grid-cols-3">
        <LocationInputs label="Location 1 (e.g. Regent's Park)" value={a} onChange={setA} />
        <LocationInputs label="Location 2 (e.g. Wimbledon)" value={b} onChange={setB} />
        <div className="space-y-2">
          <h2 className="font-semibold text-eikon-navy">Settings</h2>
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
          <button
            onClick={() => sim.mutate()}
            disabled={sim.isPending}
            className="w-full rounded bg-eikon-orange px-4 py-2 text-white disabled:opacity-50"
          >
            {sim.isPending ? "Calculating…" : "Compare locations"}
          </button>
        </div>
      </div>

      {sim.error && (
        <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          {sim.error instanceof Error ? sim.error.message : "Similarity failed"}
        </p>
      )}

      {score !== undefined && (
        <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
          <SimilarityMap a={a} b={b} />
          <ScoreCard type={simType} score={score} resolution={resolution} />
        </div>
      )}
    </div>
  );
}

function SimilarityMap({
  a,
  b,
}: {
  a: { lat: string; lon: string };
  b: { lat: string; lon: string };
}) {
  const points: MapPoint[] = [
    { lat: parseFloat(a.lat), lon: parseFloat(a.lon), color: [255, 0, 0, 200] as RGBA, name: "Location 1" },
    { lat: parseFloat(b.lat), lon: parseFloat(b.lon), color: [0, 0, 255, 200] as RGBA, name: "Location 2" },
  ].filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));

  return <PointsMap points={points} zoom={11} />;
}

function ScoreCard({
  type,
  score,
  resolution,
}: {
  type: SimType;
  score: number;
  resolution: string;
}) {
  const { color, label } =
    score >= 0.7
      ? { color: "text-green-600", label: "High Similarity" }
      : score >= 0.4
        ? { color: "text-orange-500", label: "Moderate Similarity" }
        : { color: "text-red-600", label: "Low Similarity" };

  return (
    <div className="max-w-md space-y-3 rounded-lg border bg-eikon-panel p-5">
      <div className="text-xs uppercase tracking-wide text-eikon-muted">
        {type} similarity
      </div>
      <div className={`text-4xl font-bold ${color}`}>{(score * 100).toFixed(1)}%</div>
      <div className={`text-sm font-medium ${color}`}>{label}</div>
      <div className="h-2 w-full overflow-hidden rounded bg-white">
        <div
          className="h-full bg-eikon-orange"
          style={{ width: `${Math.min(Math.max(score, 0), 1) * 100}%` }}
        />
      </div>
      <div className="text-xs text-eikon-muted">Resolution: {resolution.toUpperCase()}</div>
      <p className="text-xs text-eikon-muted">{TYPE_DESCRIPTIONS[type]}</p>
    </div>
  );
}

function LocationInputs({
  label,
  value,
  onChange,
}: {
  label: string;
  value: { lat: string; lon: string };
  onChange: (v: { lat: string; lon: string }) => void;
}) {
  return (
    <div className="space-y-2">
      <h2 className="font-semibold text-eikon-navy">{label}</h2>
      <div className="flex gap-2">
        <input
          value={value.lat}
          onChange={(e) => onChange({ ...value, lat: e.target.value })}
          placeholder="lat"
          className="w-32 rounded border px-2 py-1 text-sm"
        />
        <input
          value={value.lon}
          onChange={(e) => onChange({ ...value, lon: e.target.value })}
          placeholder="lon"
          className="w-32 rounded border px-2 py-1 text-sm"
        />
      </div>
    </div>
  );
}
