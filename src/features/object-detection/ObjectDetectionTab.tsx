"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useMutation } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { detectObjects, type DetectionResponse } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import {
  DETECTABLE_OBJECTS,
  normalizeObjects,
  parsePercent,
  type ObjectRecord,
} from "@/lib/objectDetection";
import type { MapPoint } from "@/components/map/PointsMap";

const PointsMap = dynamic(() => import("@/components/map/PointsMap"), {
  ssr: false,
  loading: () => <div className="h-[400px] w-full animate-pulse bg-eikon-panel" />,
});

const RESOLUTIONS = ["low", "medium", "high"];
type InputMethod = "Coordinates" | "H3 Location ID";
type ResultView = "Chart" | "Image" | "Table";

const EXAMPLE_LOCATIONS = [
  { name: "Wembley Stadium", lat: 51.556, lon: -0.2795, expected: "Stadium, Parking, Roads" },
  { name: "Heathrow Airport", lat: 51.47, lon: -0.4543, expected: "Runways, Terminals, Aircraft" },
  { name: "Hyde Park", lat: 51.5073, lon: -0.1657, expected: "Trees, Water, Fields" },
  { name: "Canary Wharf", lat: 51.5054, lon: -0.0235, expected: "Buildings, Roads, Water" },
];

export function ObjectDetectionTab() {
  const { apiKey } = useAuth();
  const [inputMethod, setInputMethod] = useState<InputMethod>("Coordinates");
  const [lat, setLat] = useState("51.433700"); // Wimbledon Tennis Club
  const [lon, setLon] = useState("-0.214400");
  const [locationId, setLocationId] = useState("");
  const [resolution, setResolution] = useState("medium");
  const [includeImage, setIncludeImage] = useState(true);
  const [view, setView] = useState<ResultView>("Chart");
  const [showClasses, setShowClasses] = useState(false);

  const det = useMutation({
    mutationFn: () =>
      detectObjects({
        ...(inputMethod === "Coordinates"
          ? { lat: parseFloat(lat), lon: parseFloat(lon) }
          : { locationId }),
        resolution,
        apiKey: apiKey as string,
        withImage: includeImage,
      }),
  });

  const valid =
    inputMethod === "Coordinates"
      ? Number.isFinite(parseFloat(lat)) && Number.isFinite(parseFloat(lon))
      : locationId.trim().length > 0;

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_2fr]">
      {/* ---- Input column ---- */}
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-eikon-midnight">Object Detection</h1>
          <p className="text-sm text-eikon-muted">
            Detect objects in aerial imagery using YOLO-based computer vision.
          </p>
        </div>

        <div className="flex gap-4 text-sm">
          {(["Coordinates", "H3 Location ID"] as InputMethod[]).map((m) => (
            <label key={m} className="flex items-center gap-1">
              <input
                type="radio"
                checked={inputMethod === m}
                onChange={() => setInputMethod(m)}
              />
              {m}
            </label>
          ))}
        </div>

        {inputMethod === "Coordinates" ? (
          <div className="space-y-2">
            <LabeledInput label="Latitude" value={lat} onChange={setLat} />
            <LabeledInput label="Longitude" value={lon} onChange={setLon} />
          </div>
        ) : (
          <LabeledInput
            label="H3 Location ID"
            value={locationId}
            onChange={setLocationId}
            placeholder="e.g., 87195da49ffffff"
          />
        )}

        <label className="block text-sm">
          <span className="mr-2 text-eikon-muted">Resolution</span>
          <select
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
            className="rounded border px-2 py-1"
          >
            {RESOLUTIONS.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeImage}
            onChange={(e) => setIncludeImage(e.target.checked)}
          />
          Include annotated image with bounding boxes
        </label>

        <button
          onClick={() => det.mutate()}
          disabled={det.isPending || !valid}
          className="w-full rounded bg-eikon-orange px-4 py-2 text-white disabled:opacity-50"
        >
          {det.isPending ? "Detecting…" : "Detect Objects"}
        </button>

        <div className="rounded border">
          <button
            onClick={() => setShowClasses((s) => !s)}
            className="w-full px-3 py-2 text-left text-sm font-medium text-eikon-midnight"
          >
            {showClasses ? "▾" : "▸"} View Detectable Object Classes
          </button>
          {showClasses && (
            <div className="grid grid-cols-2 gap-x-4 border-t p-3 text-xs">
              {DETECTABLE_OBJECTS.map((o) => (
                <span key={o}>• {o.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}</span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ---- Results column ---- */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-eikon-midnight">Detection Results</h2>

        {det.error && (
          <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
            {det.error instanceof Error ? det.error.message : "Detection failed"}
          </p>
        )}

        {!det.data && !det.error && <ExampleLocations />}

        {det.data && (
          <DetectionResults data={det.data} view={view} onView={setView} />
        )}
      </div>
    </div>
  );
}

function DetectionResults({
  data,
  view,
  onView,
}: {
  data: DetectionResponse;
  view: ResultView;
  onView: (v: ResultView) => void;
}) {
  const records = normalizeObjects(data.objects);

  if (records.length === 0) {
    return <p className="text-sm text-eikon-muted">No objects detected at this location.</p>;
  }

  const totalObjects = records.reduce((s, r) => s + r.count, 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Metric label="Total Objects" value={String(Math.round(totalObjects))} />
        <Metric label="Object Classes" value={String(records.length)} />
        <Metric label="Resolution" value={data.resolution.toUpperCase()} />
      </div>

      <div className="flex gap-2 border-b">
        {(["Chart", "Image", "Table"] as ResultView[]).map((v) => (
          <button
            key={v}
            onClick={() => onView(v)}
            className={`border-b-2 px-3 py-2 text-sm font-medium ${
              view === v
                ? "border-eikon-navy text-eikon-navy font-bold"
                : "border-transparent text-eikon-muted hover:text-eikon-navy"
            }`}
          >
            {v}
          </button>
        ))}
      </div>

      {view === "Chart" && <DetectionChart records={records} />}
      {view === "Image" && <DetectionImage data={data} />}
      {view === "Table" && <DetectionTable records={records} />}
    </div>
  );
}

const PIE_COLORS = ["#0D9488", "#EA580C", "#1E2D6B", "#2c7be5", "#28a745", "#ffc107", "#6f42c1", "#20c997"];

function DetectionChart({ records }: { records: ObjectRecord[] }) {
  const barData = [...records].sort((a, b) => a.count - b.count);
  const pieData = records
    .map((r) => ({ name: r.object, value: parsePercent(r.areaCoverage) }))
    .filter((d): d is { name: string; value: number } => d.value !== null && d.value > 0);

  return (
    <div className="space-y-6">
      <ResponsiveContainer width="100%" height={Math.max(400, barData.length * 35)}>
        <BarChart data={barData} layout="vertical" margin={{ left: 60 }}>
          <XAxis type="number" />
          <YAxis type="category" dataKey="object" width={120} tick={{ fontSize: 12 }} />
          <Tooltip />
          <Bar dataKey="count" fill="#1E3A5F" />
        </BarChart>
      </ResponsiveContainer>

      {pieData.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-eikon-midnight">
            Area Coverage Distribution
          </h3>
          <ResponsiveContainer width="100%" height={320}>
            <PieChart>
              <Tooltip />
              <Pie data={pieData} dataKey="value" nameKey="name" label>
                {pieData.map((_, i) => (
                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function DetectionImage({ data }: { data: DetectionResponse }) {
  if (data.annotatedImage) {
    return (
      <div>
        <h3 className="mb-2 text-sm font-semibold text-eikon-midnight">Annotated Location Image</h3>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`data:image/png;base64,${data.annotatedImage}`}
          alt="Detected objects with bounding boxes"
          className="rounded border"
          width={512}
          height={512}
        />
      </div>
    );
  }

  if (data.lat !== undefined && data.lon !== undefined) {
    const points: MapPoint[] = [{ lat: data.lat, lon: data.lon, color: [255, 100, 100, 200], radius: 200 }];
    return (
      <div className="space-y-2">
        <p className="text-sm text-eikon-muted">
          No annotated image available. Use the H3 Location ID input with &quot;Include annotated
          image&quot; for bounding boxes.
        </p>
        <PointsMap points={points} zoom={14} height={400} />
      </div>
    );
  }

  return <p className="text-sm text-eikon-muted">No annotated image available.</p>;
}

function DetectionTable({ records }: { records: ObjectRecord[] }) {
  const hasCoverage = records.some((r) => r.areaCoverage !== undefined);

  function download(kind: "csv" | "json") {
    let content: string;
    let mime: string;
    let name: string;
    if (kind === "csv") {
      const cols = ["Object", "Count", ...(hasCoverage ? ["Area Coverage"] : [])];
      const lines = records.map((r) =>
        [r.object, r.count, ...(hasCoverage ? [r.areaCoverage ?? ""] : [])].join(","),
      );
      content = [cols.join(","), ...lines].join("\n");
      mime = "text/csv";
      name = "object_detection_results.csv";
    } else {
      content = JSON.stringify(records, null, 2);
      mime = "application/json";
      name = "object_detection_results.json";
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
          <thead className="bg-eikon-panel text-left text-eikon-midnight">
            <tr>
              <th className="px-3 py-2">Object</th>
              <th className="px-3 py-2">Count</th>
              {hasCoverage && <th className="px-3 py-2">Area Coverage</th>}
            </tr>
          </thead>
          <tbody>
            {records.map((r, i) => (
              <tr key={i} className="border-t">
                <td className="px-3 py-2">{r.object}</td>
                <td className="px-3 py-2">{r.count}</td>
                {hasCoverage && <td className="px-3 py-2">{r.areaCoverage ?? ""}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex gap-2">
        <button onClick={() => download("csv")} className="rounded border px-4 py-2 text-sm text-eikon-midnight">
          Download CSV
        </button>
        <button onClick={() => download("json")} className="rounded border px-4 py-2 text-sm text-eikon-midnight">
          Download JSON
        </button>
      </div>
    </div>
  );
}

function ExampleLocations() {
  return (
    <div className="space-y-2">
      <p className="text-sm text-eikon-muted">
        Enter coordinates or a location ID and click &quot;Detect Objects&quot;.
      </p>
      <h3 className="text-sm font-semibold text-eikon-midnight">Example Locations</h3>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-eikon-panel text-left text-eikon-midnight">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Latitude</th>
              <th className="px-3 py-2">Longitude</th>
              <th className="px-3 py-2">Expected Objects</th>
            </tr>
          </thead>
          <tbody>
            {EXAMPLE_LOCATIONS.map((e) => (
              <tr key={e.name} className="border-t">
                <td className="px-3 py-2">{e.name}</td>
                <td className="px-3 py-2">{e.lat}</td>
                <td className="px-3 py-2">{e.lon}</td>
                <td className="px-3 py-2">{e.expected}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-eikon-panel p-3 text-center">
      <div className="text-xs uppercase tracking-wide text-eikon-muted">{label}</div>
      <div className="mt-1 text-2xl font-bold text-eikon-midnight">{value}</div>
    </div>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="mr-2 text-eikon-muted">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded border px-2 py-1"
      />
    </label>
  );
}
