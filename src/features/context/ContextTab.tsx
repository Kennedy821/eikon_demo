"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useMutation } from "@tanstack/react-query";
import { cellToLatLng, getResolution, isValidCell } from "h3-js";
import { getContext } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import type { MapPoint } from "@/components/map/PointsMap";

const PointsMap = dynamic(() => import("@/components/map/PointsMap"), {
  ssr: false,
  loading: () => <div className="h-[400px] w-full animate-pulse bg-eikon-panel" />,
});

const RESOLUTIONS = ["low", "medium", "high"];
// An H3 cell fixes the analysis resolution: res 7 = low, 8 = medium, 9 = high.
const H3_RES_TO_ANALYSIS: Record<number, string> = { 7: "low", 8: "medium", 9: "high" };
const INPUT_MODES = ["Coordinates", "H3 hex"] as const;
type InputMode = (typeof INPUT_MODES)[number];

/**
 * Location Context — replaces render_context_tab. Two-column layout
 * (st.columns([1, 2])): inputs left, results right. Results show the location
 * on a map (zoom 14) plus the AI description, matching the original; the
 * satellite image is included as an extra since the backend returns it.
 */
export function ContextTab() {
  const { apiKey } = useAuth();
  const [inputMode, setInputMode] = useState<InputMode>("Coordinates");
  const [lat, setLat] = useState("51.5074");
  const [lon, setLon] = useState("-0.1278");
  const [hexId, setHexId] = useState("");
  const [resolution, setResolution] = useState("high");

  // Resolve the chosen input to a lat/lon pair. An H3 cell is converted to
  // its centre client-side; the backend call is identical either way.
  const isHexMode = inputMode === "H3 hex";
  const hexTrimmed = hexId.trim();
  const hexValid = isHexMode && hexTrimmed.length > 0 && isValidCell(hexTrimmed);
  const hexRes = hexValid ? getResolution(hexTrimmed) : null;
  // Resolution is derived from the cell in hex mode; only res 7–9 are analysable.
  const hexResolution = hexRes !== null ? (H3_RES_TO_ANALYSIS[hexRes] ?? null) : null;
  let latN = NaN;
  let lonN = NaN;
  if (isHexMode) {
    if (hexValid && hexResolution) [latN, lonN] = cellToLatLng(hexTrimmed);
  } else {
    latN = parseFloat(lat);
    lonN = parseFloat(lon);
  }
  const hasLocation = Number.isFinite(latN) && Number.isFinite(lonN);
  const effectiveResolution = isHexMode ? (hexResolution ?? resolution) : resolution;

  // The analysed location travels with the request (mutation variables) so the
  // results panel always describes the request that produced it.
  const ctx = useMutation({
    mutationFn: (loc: { lat: number; lon: number; hex: string | null; resolution: string }) =>
      getContext({
        lat: loc.lat,
        lon: loc.lon,
        resolution: loc.resolution,
        apiKey: apiKey as string,
      }),
  });
  const analysed = ctx.variables ?? null;

  // Any change to the inputs discards the previous result — a result is only
  // ever shown for the inputs currently on screen.
  const { reset: resetCtx } = ctx;
  useEffect(() => {
    resetCtx();
  }, [inputMode, lat, lon, hexId, resolution, resetCtx]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!hasLocation || ctx.isPending) return;
    ctx.mutate({
      lat: latN,
      lon: lonN,
      hex: isHexMode ? hexTrimmed : null,
      resolution: effectiveResolution,
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-eikon-midnight">Location Context</h1>
        <p className="text-sm text-eikon-muted">
          Understand the profile of a location fast
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
        {/* ---- Left: location input ---- */}
        <form onSubmit={onSubmit} className="space-y-3 rounded-lg border p-4">
          <h2 className="text-sm font-semibold text-eikon-midnight">Location input</h2>
          <label className="block text-sm">
            <span className="mb-1 block text-eikon-muted">Input type</span>
            <select
              value={inputMode}
              onChange={(e) => setInputMode(e.target.value as InputMode)}
              className="w-full rounded border px-2 py-1.5"
            >
              {INPUT_MODES.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
          {isHexMode ? (
            <label className="block text-sm">
              <span className="mb-1 block text-eikon-muted">H3 hex code</span>
              <input
                value={hexId}
                onChange={(e) => setHexId(e.target.value)}
                placeholder="e.g. 89194ad328fffff"
                spellCheck={false}
                className="w-full rounded border px-2 py-1.5 font-mono"
              />
              {hexTrimmed.length > 0 && (
                <span
                  className={`mt-1 block text-xs ${
                    hexValid && hexResolution ? "text-green-700" : "text-red-700"
                  }`}
                >
                  {!hexValid
                    ? "Not a valid H3 cell index."
                    : !hexResolution
                      ? `Resolution ${hexRes} cell is not supported (7, 8 or 9).`
                      : `${latN.toFixed(6)}, ${lonN.toFixed(6)}`}
                </span>
              )}
            </label>
          ) : (
            <>
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
            </>
          )}
          <label className="block text-sm">
            <span className="mb-1 block text-eikon-muted">Analysis resolution</span>
            <select
              value={effectiveResolution}
              onChange={(e) => setResolution(e.target.value)}
              disabled={isHexMode}
              className="w-full rounded border px-2 py-1.5 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-eikon-muted"
            >
              {RESOLUTIONS.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
            {isHexMode && (
              <span className="mt-1 block text-xs text-eikon-muted">Set automatically</span>
            )}
          </label>
          <button
            type="submit"
            disabled={ctx.isPending || !hasLocation}
            className="w-full rounded bg-eikon-orange px-4 py-2 text-white disabled:opacity-50"
          >
            {ctx.isPending ? "Analysing…" : "Analyze location"}
          </button>
        </form>

        {/* ---- Right: analysis results ---- */}
        <div className="min-w-0">
          {ctx.error && (
            <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
              {ctx.error instanceof Error ? ctx.error.message : "Context failed"}
            </p>
          )}

          {ctx.data && analysed ? (
            <div className="space-y-4">
              <PointsMap
                points={[
                  {
                    lat: analysed.lat,
                    lon: analysed.lon,
                    color: [255, 0, 0, 200],
                    radius: 100,
                  } as MapPoint,
                ]}
                zoom={14}
                height={360}
                basemapToggle
              />

              <div className="space-y-1 text-sm">
                {analysed.hex && (
                  <p>
                    <span className="font-semibold text-eikon-midnight">H3 cell:</span>{" "}
                    <span className="font-mono">{analysed.hex}</span>
                  </p>
                )}
                <p>
                  <span className="font-semibold text-eikon-midnight">Coordinates:</span>{" "}
                  {analysed.lat.toFixed(6)}, {analysed.lon.toFixed(6)}
                </p>
                <p>
                  <span className="font-semibold text-eikon-midnight">Resolution:</span>{" "}
                  {analysed.resolution.toUpperCase()}
                </p>
              </div>

              <div>
                <h3 className="mb-1 font-semibold text-eikon-midnight">Location Description</h3>
                <p className="whitespace-pre-wrap rounded bg-eikon-panel p-3 text-sm">
                  {ctx.data.description ?? "No description available."}
                </p>
              </div>

              {ctx.data.image && (
                <div>
                  <h3 className="mb-1 font-semibold text-eikon-midnight">Location Image</h3>
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
                {ctx.isPending ? "Analysing…" : ""}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
