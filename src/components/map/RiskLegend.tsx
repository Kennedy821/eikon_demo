"use client";

import type { RGBA } from "@/lib/geo/risk";
import type { Basemap } from "@/components/map/basemaps";

/**
 * Legend for a risk choropleth: the natural-breaks class ramp, a switch for
 * the choropleth layer itself, an optional route key, and the basemap picker.
 * Shared by the drone corridor and risk assessment tabs.
 */
export default function RiskLegend({
  binEdges,
  classColors,
  maxScore,
  showRouteKeys = false,
  basemap,
  onBasemap,
  showChoropleth,
  onToggleChoropleth,
}: {
  binEdges: number[];
  classColors: RGBA[];
  maxScore: number;
  showRouteKeys?: boolean;
  basemap: Basemap;
  onBasemap: (b: Basemap) => void;
  showChoropleth: boolean;
  onToggleChoropleth: () => void;
}) {
  const rgb = (c: RGBA) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
  return (
    <div className="space-y-4">
      <div className="rounded-lg border p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-bold text-eikon-midnight">Risk Score</span>
          <button
            onClick={onToggleChoropleth}
            aria-pressed={showChoropleth}
            title="Toggle the risk colour-grade layer"
            className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
              showChoropleth
                ? "border-eikon-navy bg-eikon-navy text-white"
                : "border-gray-300 text-eikon-muted"
            }`}
          >
            {showChoropleth ? "On" : "Off"}
          </button>
        </div>
        <div className={showChoropleth ? "" : "opacity-40"}>
          {classColors.map((c, i) => {
            const lower = i === 0 ? 0 : binEdges[i - 1];
            const upper = binEdges[i];
            return (
              <div key={i} className="mb-1 flex items-center gap-2">
                <span
                  className="inline-block h-3.5 w-4 rounded"
                  style={{ background: rgb(c), opacity: 0.85 }}
                />
                <span className="text-xs text-eikon-muted">
                  {lower.toFixed(3)} – {upper.toFixed(3)}
                </span>
              </div>
            );
          })}
          {classColors.length === 0 && (
            <div className="text-xs text-eikon-muted">0.000 – {maxScore.toFixed(3)}</div>
          )}
        </div>
        {showRouteKeys && (
          <div className="mt-2 border-t pt-2">
            <div className="mb-1 text-xs font-semibold text-eikon-midnight">Routes</div>
            <div className="mb-1 flex items-center gap-2">
              <span
                className="inline-block h-1 w-4 rounded-full"
                style={{ background: "rgb(13,148,136)" }}
              />
              <span className="text-xs text-eikon-muted">Recommended</span>
            </div>
            <div className="flex items-center gap-2">
              <span
                className="inline-block h-1 w-4 rounded-full"
                style={{ background: "rgb(30,45,107)" }}
              />
              <span className="text-xs text-eikon-muted">Alternative</span>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-lg border p-3">
        <div className="mb-2 text-xs font-bold text-eikon-midnight">Basemap</div>
        <div className="flex flex-col gap-1">
          {(["Dark", "Light", "Satellite"] as Basemap[]).map((b) => (
            <button
              key={b}
              onClick={() => onBasemap(b)}
              className={`rounded px-2 py-1 text-sm ${
                basemap === b ? "bg-eikon-navy text-white" : "border text-eikon-midnight"
              }`}
            >
              {b}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
