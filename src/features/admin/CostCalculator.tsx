"use client";

import { useMemo, useRef, useState } from "react";
import { area as turfArea } from "@turf/turf";
import {
  parseGeoJsonFile,
  combineAoiFeatures,
  bufferAoiFeatures,
  bufferLabel,
  countAoiTiles,
  BUFFER_OPTIONS_M,
  GeoJsonAoiError,
  type AoiFeature,
} from "@/lib/geojsonAoi";
import {
  estimateCost,
  labelForObject,
  DEFAULT_BYTES_PER_ROW,
  DEFAULT_FIXED_BYTES,
  DEFAULT_RATE_PER_KB,
  OBJECT_OPTIONS,
  TILE_AREA_KM2,
  TILES_PER_POINT,
} from "@/lib/remoteInspection";

const SOURCES = ["Area", "Locations", "GeoJSON upload"] as const;
type Source = (typeof SOURCES)[number];

function money(v: number): string {
  // Sub-penny estimates are normal here, so show enough digits to be useful.
  if (v > 0 && v < 0.01) return `£${v.toFixed(4)}`;
  return `£${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function CostCalculator() {
  const [source, setSource] = useState<Source>("Area");
  const [areaKm2, setAreaKm2] = useState("10");
  const [locations, setLocations] = useState("100");
  const [bufferM, setBufferM] = useState(0);
  const [objects, setObjects] = useState<string[]>(["solar_panels"]);

  const [bytesPerRow, setBytesPerRow] = useState(String(DEFAULT_BYTES_PER_ROW));
  const [fixedBytes, setFixedBytes] = useState(String(DEFAULT_FIXED_BYTES));
  const [ratePerKb, setRatePerKb] = useState(String(DEFAULT_RATE_PER_KB));

  const [uploadFiles, setUploadFiles] = useState<{ name: string; text: string }[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function onFilesChosen(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploadFiles(
      await Promise.all(
        Array.from(files).map(async (f) => ({ name: f.name, text: await f.text() })),
      ),
    );
  }

  const parsed = useMemo(() => {
    if (uploadFiles.length === 0) return null;
    try {
      const combined = combineAoiFeatures(uploadFiles.map((f) => parseGeoJsonFile(f.text, f.name)));
      return { features: combined.features, error: null as string | null };
    } catch (err) {
      return {
        features: [] as AoiFeature[],
        error: err instanceof GeoJsonAoiError || err instanceof Error ? err.message : "Bad file.",
      };
    }
  }, [uploadFiles]);

  const buffered = useMemo(
    () => bufferAoiFeatures(parsed?.features ?? [], bufferM),
    [parsed, bufferM],
  );

  // Tiles the run will cover, by whichever basis is selected.
  const { tiles, basis } = useMemo(() => {
    if (source === "Area") {
      const km2 = parseFloat(areaKm2);
      if (!Number.isFinite(km2) || km2 <= 0) return { tiles: 0, basis: "" };
      const t = Math.ceil(km2 / TILE_AREA_KM2);
      return { tiles: t, basis: `${km2.toLocaleString()} km² ÷ ${TILE_AREA_KM2} km² per tile` };
    }
    if (source === "Locations") {
      const n = parseInt(locations, 10);
      if (!Number.isFinite(n) || n <= 0) return { tiles: 0, basis: "" };
      const per = TILES_PER_POINT[bufferM] ?? 1;
      return {
        tiles: n * per,
        basis: `${n.toLocaleString()} location${n === 1 ? "" : "s"} × ${per} tile${per === 1 ? "" : "s"} at ${bufferLabel(bufferM).toLowerCase()} buffer`,
      };
    }
    if (buffered.length === 0) return { tiles: 0, basis: "" };
    const t = countAoiTiles(buffered);
    const km2 = buffered.reduce((sum, f) => sum + turfArea(f) / 1e6, 0);
    return {
      tiles: Number.isFinite(t) ? t : 0,
      basis: `${buffered.length.toLocaleString()} uploaded location${buffered.length === 1 ? "" : "s"} · ${km2.toFixed(1)} km²`,
    };
  }, [source, areaKm2, locations, bufferM, buffered]);

  const estimate = useMemo(
    () =>
      estimateCost({
        tiles,
        objects: objects.length,
        bytesPerRow: parseFloat(bytesPerRow) || 0,
        fixedBytes: parseFloat(fixedBytes) || 0,
        ratePerKb: parseFloat(ratePerKb) || 0,
      }),
    [tiles, objects.length, bytesPerRow, fixedBytes, ratePerKb],
  );

  function toggleObject(name: string) {
    setObjects((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
      {/* ---- inputs ---- */}
      <div className="space-y-4">
        <div className="space-y-3 rounded-lg border p-4">
          <h2 className="text-sm font-semibold text-eikon-midnight">Scope</h2>

          <label className="block text-sm">
            <span className="mb-1 block text-eikon-muted">Based on</span>
            <select
              value={source}
              onChange={(e) => setSource(e.target.value as Source)}
              className="w-full rounded border px-2 py-1.5"
            >
              {SOURCES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>

          {source === "Area" && (
            <label className="block text-sm">
              <span className="mb-1 block text-eikon-muted">Area (km²)</span>
              <input
                value={areaKm2}
                onChange={(e) => setAreaKm2(e.target.value)}
                inputMode="decimal"
                className="w-full rounded border px-2 py-1.5"
              />
            </label>
          )}

          {source === "Locations" && (
            <label className="block text-sm">
              <span className="mb-1 block text-eikon-muted">Number of locations</span>
              <input
                value={locations}
                onChange={(e) => setLocations(e.target.value)}
                inputMode="numeric"
                className="w-full rounded border px-2 py-1.5"
              />
            </label>
          )}

          {source === "GeoJSON upload" && (
            <div className="space-y-2">
              <label className="block text-sm">
                <span className="mb-1 block text-eikon-muted">GeoJSON file(s)</span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".geojson,.json,application/geo+json,application/json"
                  multiple
                  onChange={(e) => onFilesChosen(e.target.files)}
                  className="w-full rounded border px-2 py-1.5 text-sm file:mr-3 file:rounded file:border-0 file:bg-eikon-panel file:px-3 file:py-1 file:text-sm file:text-eikon-midnight"
                />
              </label>
              {parsed?.error && (
                <p className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">{parsed.error}</p>
              )}
            </div>
          )}

          {source !== "Area" && (
            <label className="block text-sm">
              <span className="mb-1 block text-eikon-muted">Buffer</span>
              <select
                value={bufferM}
                onChange={(e) => setBufferM(Number(e.target.value))}
                className="w-full rounded border px-2 py-1.5"
              >
                {BUFFER_OPTIONS_M.map((m) => (
                  <option key={m} value={m}>
                    {bufferLabel(m)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div className="space-y-2 rounded-lg border p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-eikon-midnight">Objects</h2>
            <div className="flex gap-2 text-xs">
              <button
                type="button"
                onClick={() => setObjects([...OBJECT_OPTIONS])}
                className="text-eikon-accent underline"
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setObjects([])}
                className="text-eikon-muted underline"
              >
                None
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            {OBJECT_OPTIONS.map((name) => (
              <label key={name} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={objects.includes(name)}
                  onChange={() => toggleObject(name)}
                />
                <span className="truncate">{labelForObject(name)}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="space-y-3 rounded-lg border p-4">
          <h2 className="text-sm font-semibold text-eikon-midnight">Rate</h2>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="mb-1 block text-eikon-muted">£ per KB</span>
              <input
                value={ratePerKb}
                onChange={(e) => setRatePerKb(e.target.value)}
                inputMode="decimal"
                className="w-full rounded border px-2 py-1.5"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-eikon-muted">Bytes per row</span>
              <input
                value={bytesPerRow}
                onChange={(e) => setBytesPerRow(e.target.value)}
                inputMode="numeric"
                className="w-full rounded border px-2 py-1.5"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-eikon-muted">Fixed bytes</span>
              <input
                value={fixedBytes}
                onChange={(e) => setFixedBytes(e.target.value)}
                inputMode="numeric"
                className="w-full rounded border px-2 py-1.5"
              />
            </label>
          </div>
        </div>
      </div>

      {/* ---- estimate ---- */}
      <div className="space-y-4">
        <div className="space-y-3 rounded-lg border p-4">
          <h2 className="text-sm font-semibold text-eikon-midnight">Estimate</h2>
          <p className="text-3xl font-bold text-eikon-accent">{money(estimate.cost)}</p>
          {basis && <p className="text-xs text-eikon-muted">{basis}</p>}

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t pt-3 text-sm">
            <Stat label="Tiles" value={estimate.tiles.toLocaleString()} />
            <Stat label="Objects" value={estimate.objects.toLocaleString()} />
            <Stat label="Result rows" value={estimate.rows.toLocaleString()} />
            <Stat
              label="Payload"
              value={
                estimate.kb >= 1024
                  ? `${(estimate.kb / 1024).toFixed(2)} MB`
                  : `${estimate.kb.toFixed(2)} KB`
              }
            />
          </dl>
        </div>

        {estimate.rows > 0 && (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-eikon-panel text-left text-eikon-midnight">
                <tr>
                  <th className="whitespace-nowrap px-3 py-2">Per</th>
                  <th className="whitespace-nowrap px-3 py-2">Rows</th>
                  <th className="whitespace-nowrap px-3 py-2">Payload (KB)</th>
                  <th className="whitespace-nowrap px-3 py-2">Cost</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { label: "Tile (all objects)", tiles: 1, objects: estimate.objects },
                  { label: "Object (all tiles)", tiles: estimate.tiles, objects: 1 },
                  { label: "Whole run", tiles: estimate.tiles, objects: estimate.objects },
                ].map((row) => {
                  const e = estimateCost({
                    tiles: row.tiles,
                    objects: row.objects,
                    bytesPerRow: parseFloat(bytesPerRow) || 0,
                    fixedBytes: parseFloat(fixedBytes) || 0,
                    ratePerKb: parseFloat(ratePerKb) || 0,
                  });
                  return (
                    <tr key={row.label} className="border-t">
                      <td className="whitespace-nowrap px-3 py-2">{row.label}</td>
                      <td className="whitespace-nowrap px-3 py-2">{e.rows.toLocaleString()}</td>
                      <td className="whitespace-nowrap px-3 py-2">{e.kb.toFixed(2)}</td>
                      <td className="whitespace-nowrap px-3 py-2">{money(e.cost)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-eikon-muted">{label}</dt>
      <dd className="font-semibold text-eikon-midnight">{value}</dd>
    </div>
  );
}
