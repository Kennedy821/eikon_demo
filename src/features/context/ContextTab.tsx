"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useMutation } from "@tanstack/react-query";
import { getContext } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import type { MapPoint } from "@/components/map/PointsMap";

const PointsMap = dynamic(() => import("@/components/map/PointsMap"), {
  ssr: false,
  loading: () => <div className="h-[400px] w-full animate-pulse bg-eikon-panel" />,
});

const RESOLUTIONS = ["low", "medium", "high"];

/**
 * Location Context — replaces render_context_tab. Two-column layout
 * (st.columns([1, 2])): inputs left, results right. Results show the location
 * on a map (zoom 14) plus the AI description, matching the original; the
 * satellite image is included as an extra since the backend returns it.
 */
export function ContextTab() {
  const { apiKey } = useAuth();
  const [lat, setLat] = useState("51.5074");
  const [lon, setLon] = useState("-0.1278");
  const [resolution, setResolution] = useState("high");

  const ctx = useMutation({
    mutationFn: () =>
      getContext({
        lat: parseFloat(lat),
        lon: parseFloat(lon),
        resolution,
        apiKey: apiKey as string,
      }),
  });

  const latN = parseFloat(lat);
  const lonN = parseFloat(lon);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-eikon-navy">Location Context</h1>
        <p className="text-sm text-eikon-muted">
          Get detailed descriptions of any location using AI-powered geospatial analysis.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
        {/* ---- Left: location input ---- */}
        <div className="space-y-3 rounded-lg border p-4">
          <h2 className="text-sm font-semibold text-eikon-navy">Location input</h2>
          <label className="block text-sm">
            <span className="mb-1 block text-eikon-muted">Latitude</span>
            <input
              value={lat}
              onChange={(e) => setLat(e.target.value)}
              className="w-full rounded border px-2 py-1.5"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-eikon-muted">Longitude</span>
            <input
              value={lon}
              onChange={(e) => setLon(e.target.value)}
              className="w-full rounded border px-2 py-1.5"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-eikon-muted">Analysis resolution</span>
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
            onClick={() => ctx.mutate()}
            disabled={ctx.isPending}
            className="w-full rounded bg-eikon-orange px-4 py-2 text-white disabled:opacity-50"
          >
            {ctx.isPending ? "Analysing…" : "Analyze location"}
          </button>
        </div>

        {/* ---- Right: analysis results ---- */}
        <div className="min-w-0">
          {ctx.error && (
            <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
              {ctx.error instanceof Error ? ctx.error.message : "Context failed"}
            </p>
          )}

          {ctx.data ? (
            <div className="space-y-4">
              {Number.isFinite(latN) && Number.isFinite(lonN) && (
                <PointsMap
                  points={[
                    { lat: latN, lon: lonN, color: [255, 0, 0, 200], radius: 100 } as MapPoint,
                  ]}
                  zoom={14}
                  height={360}
                />
              )}

              <div className="space-y-1 text-sm">
                <p>
                  <span className="font-semibold text-eikon-navy">Coordinates:</span>{" "}
                  {latN.toFixed(6)}, {lonN.toFixed(6)}
                </p>
                <p>
                  <span className="font-semibold text-eikon-navy">Resolution:</span>{" "}
                  {resolution.toUpperCase()}
                </p>
              </div>

              <div>
                <h3 className="mb-1 font-semibold text-eikon-navy">Location Description</h3>
                <p className="whitespace-pre-wrap rounded bg-eikon-panel p-3 text-sm">
                  {ctx.data.description ?? "No description available."}
                </p>
              </div>

              {ctx.data.image && (
                <div>
                  <h3 className="mb-1 font-semibold text-eikon-navy">Location Image</h3>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`data:image/png;base64,${ctx.data.image}`}
                    alt="Aerial view"
                    className="w-full max-w-lg rounded-lg border"
                  />
                </div>
              )}
            </div>
          ) : (
            !ctx.error && (
              <div className="flex min-h-[300px] items-center justify-center rounded-lg border border-dashed text-sm text-eikon-muted">
                Enter coordinates and click Analyze Location to get a description.
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
