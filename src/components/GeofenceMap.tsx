"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, Polygon, Polyline, Circle, Rectangle, Marker, Tooltip, useMapEvents, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

type Point = [number, number]; // [longitude, latitude]
type Row = Record<string, any>;
export type Geometry = {
  shape: "polygon" | "circle" | "rect";
  polygon: number[][];
  meta: Row | null;
};
type Tool = "polygon" | "circle" | "rect";
type Props = {
  zones: Row[];
  branchName: (id: string) => string;
  selectedId: string | null; // null = drawing a new zone
  onSelect: (zone: Row) => void;
  onSave: (g: Geometry) => void;
  saving?: boolean;
};

const ll = ([lng, lat]: Point): [number, number] => [lat, lng];
const CIRCLE_STEPS = 64;

/** Approximate a circle by a polygon so server-side geofence checks keep working unchanged. */
function circleToPolygon(center: Point, radius: number): number[][] {
  const [lng, lat] = center;
  const dLat = radius / 111320;
  const dLng = radius / (111320 * Math.cos((lat * Math.PI) / 180));
  const pts: number[][] = [];
  for (let i = 0; i < CIRCLE_STEPS; i++) {
    const a = (2 * Math.PI * i) / CIRCLE_STEPS;
    pts.push([Number((lng + dLng * Math.cos(a)).toFixed(7)), Number((lat + dLat * Math.sin(a)).toFixed(7))]);
  }
  return pts;
}
const rectToPolygon = (a: Point, b: Point): number[][] => [
  [a[0], a[1]],
  [b[0], a[1]],
  [b[0], b[1]],
  [a[0], b[1]],
];
const edgeEast = (center: Point, radius: number): Point => [
  center[0] + radius / (111320 * Math.cos((center[1] * Math.PI) / 180)),
  center[1],
];
const distM = (a: Point, b: Point) => L.latLng(ll(a)).distanceTo(L.latLng(ll(b)));

function MapClick({ onClick, skipUntil }: { onClick: (p: Point) => void; skipUntil: React.MutableRefObject<number> }) {
  useMapEvents({
    click: (e) => {
      if (Date.now() < skipUntil.current) return;
      onClick([e.latlng.lng, e.latlng.lat]);
    },
  });
  return null;
}
function Fly({ target }: { target: { to: [number, number]; zoom: number; n: number } | null }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo(target.to, target.zoom);
  }, [map, target]);
  return null;
}
function FitBounds({ bounds, version }: { bounds: L.LatLngBounds | null; version: string }) {
  const map = useMap();
  useEffect(() => {
    if (bounds && bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 18 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, version]);
  return null;
}

function handleIcon(label: string, kind: "pt" | "edge" = "pt") {
  return L.divIcon({
    className: "fence-marker-wrap",
    iconSize: [40, 40],
    iconAnchor: [20, 20],
    html: `<div class="fence-marker${kind === "edge" ? " edge" : ""}">${label}</div>`,
  });
}
function Handle({
  position,
  label,
  kind,
  onMove,
  skipUntil,
  onContext,
}: {
  position: Point;
  label: string;
  kind?: "pt" | "edge";
  onMove: (p: Point) => void;
  skipUntil: React.MutableRefObject<number>;
  onContext?: () => void;
}) {
  const map = useMap();
  const icon = useMemo(() => handleIcon(label, kind), [label, kind]);
  return (
    <Marker
      position={ll(position)}
      icon={icon}
      draggable
      autoPan
      eventHandlers={{
        dragstart: () => {
          skipUntil.current = Date.now() + 800;
          map.dragging.disable();
        },
        drag: (e) => {
          const p = (e.target as L.Marker).getLatLng();
          onMove([p.lng, p.lat]);
        },
        dragend: (e) => {
          const p = (e.target as L.Marker).getLatLng();
          onMove([p.lng, p.lat]);
          skipUntil.current = Date.now() + 900;
          map.dragging.enable();
        },
        click: (e) => {
          L.DomEvent.stopPropagation(e.originalEvent);
          skipUntil.current = Date.now() + 500;
        },
        contextmenu: (e) => {
          L.DomEvent.stopPropagation(e.originalEvent);
          onContext?.();
          skipUntil.current = Date.now() + 500;
        },
      }}
    />
  );
}

function zoneToDraft(z: Row | null) {
  const shape = (z?.shape as Tool) || "polygon";
  const meta = (z?.meta as Row | null) || null;
  const poly = ((z?.polygon as number[][]) || []).map((p) => [Number(p[0]), Number(p[1])] as Point);
  if (shape === "circle" && meta?.center && meta?.radius)
    return { tool: "circle" as Tool, points: [] as Point[], circle: { c: [Number(meta.center[0]), Number(meta.center[1])] as Point, r: Number(meta.radius) }, rect: null };
  if (shape === "rect" && meta?.a && meta?.b)
    return {
      tool: "rect" as Tool,
      points: [] as Point[],
      circle: null,
      rect: { a: [Number(meta.a[0]), Number(meta.a[1])] as Point, b: [Number(meta.b[0]), Number(meta.b[1])] as Point },
    };
  return { tool: "polygon" as Tool, points: poly, circle: null, rect: null };
}

export default function GeofenceMap({ zones, branchName, selectedId, onSelect, onSave, saving }: Props) {
  const selected = useMemo(() => zones.find((z) => String(z.id) === selectedId) || null, [zones, selectedId]);
  const [tool, setTool] = useState<Tool>("polygon");
  const [points, setPoints] = useState<Point[]>([]);
  const [circle, setCircle] = useState<{ c: Point; r: number } | null>(null);
  const [rect, setRect] = useState<{ a: Point; b: Point } | null>(null);
  const [rectStart, setRectStart] = useState<Point | null>(null);
  const [armed, setArmed] = useState(false); // true after choosing a shape tool to draw a NEW zone
  const [mode, setMode] = useState<"draw" | "edit">("draw");
  const [fly, setFly] = useState<{ to: [number, number]; zoom: number; n: number } | null>(null);
  const [error, setError] = useState("");
  const skipUntil = useRef(0);

  // Load the selected zone (or an empty drawing) into the editor.
  const zoneKey = selected ? String(selected.id) + JSON.stringify(selected.polygon) + String(selected.shape) + JSON.stringify(selected.meta) : "new";
  useEffect(() => {
    const d = zoneToDraft(selected);
    setTool(d.tool);
    setPoints(d.points);
    setCircle(d.circle);
    setRect(d.rect);
    setRectStart(null);
    setArmed(false);
    setMode(selected ? "edit" : "draw");
    setError("");
    if (selected && selected.polygon?.length) {
      const b = L.latLngBounds((selected.polygon as number[][]).map((p) => ll([Number(p[0]), Number(p[1])])));
      if (b.isValid()) setFly({ to: [b.getCenter().lat, b.getCenter().lng], zoom: 17, n: Date.now() });
    }
  }, [zoneKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasDraft = tool === "polygon" ? points.length > 0 : tool === "circle" ? !!circle : !!rect || !!rectStart;
  const ready = tool === "polygon" ? points.length >= 3 : tool === "circle" ? !!circle && circle.r >= 5 : !!rect;

  const switchTool = (t: Tool) => {
    setArmed(true);
    if (t === tool) return;
    setTool(t);
    setPoints([]);
    setCircle(null);
    setRect(null);
    setRectStart(null);
    setMode("draw");
    setError("");
  };

  const drawing = armed || !!selected;
  const onMapClick = (p: Point) => {
    if (!drawing) return;
    if (tool === "polygon") {
      if (mode === "draw") setPoints((o) => [...o, p]);
    } else if (tool === "circle") {
      if (!circle) setCircle({ c: p, r: 100 });
    } else if (tool === "rect") {
      if (rect) return;
      if (!rectStart) setRectStart(p);
      else {
        setRect({ a: rectStart, b: p });
        setRectStart(null);
        setMode("edit");
      }
    }
  };

  const clear = () => {
    setPoints([]);
    setCircle(null);
    setRect(null);
    setRectStart(null);
    setMode("draw");
  };
  const undo = () => {
    if (tool === "polygon") setPoints((p) => p.slice(0, -1));
    else clear();
  };
  const locate = () => {
    if (!navigator.geolocation) return setError("Geolocation is not available in this browser");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setFly({ to: [p.coords.latitude, p.coords.longitude], zoom: 18, n: Date.now() });
        setError("");
      },
      () => setError("Allow location access to center the map"),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  const save = () => {
    if (!ready) return;
    if (tool === "polygon") onSave({ shape: "polygon", polygon: points, meta: null });
    else if (tool === "circle" && circle)
      onSave({ shape: "circle", polygon: circleToPolygon(circle.c, circle.r), meta: { center: circle.c, radius: Math.round(circle.r * 10) / 10 } });
    else if (tool === "rect" && rect) onSave({ shape: "rect", polygon: rectToPolygon(rect.a, rect.b), meta: { a: rect.a, b: rect.b } });
  };

  // Fit all zones once they are loaded.
  const allBounds = useMemo(() => {
    const pts: [number, number][] = [];
    for (const z of zones) for (const p of (z.polygon as number[][]) || []) pts.push(ll([Number(p[0]), Number(p[1])]));
    return pts.length ? L.latLngBounds(pts) : null;
  }, [zones]);
  const fitKey = zones.map((z) => z.id).join(",");

  const others = zones.filter((z) => String(z.id) !== selectedId);
  const hint = !drawing
    ? "Click a saved zone to edit it, or choose Polygon / Circle / Rectangle to draw a new one."
    : tool === "polygon"
      ? mode === "draw"
        ? "Tap the map to add boundary points."
        : "Drag the numbered handles to move points. Right-click a handle to remove it."
      : tool === "circle"
        ? circle
          ? "Drag the centre to move the circle, drag the outer handle (or type the radius) to resize it."
          : "Tap the map where the circle should be centred."
        : rect
          ? "Drag the two corner handles to resize the rectangle."
          : rectStart
            ? "Now tap the opposite corner."
            : "Tap the first corner of the rectangle.";

  return (
    <div className="fence-editor">
      <div className="fence-toolbar" role="group" aria-label="Shape tools">
        <button type="button" className={drawing && tool === "polygon" ? "primary" : "secondary"} onClick={() => switchTool("polygon")}>
          ⬠ Polygon
        </button>
        <button type="button" className={drawing && tool === "circle" ? "primary" : "secondary"} onClick={() => switchTool("circle")}>
          ◯ Circle
        </button>
        <button type="button" className={drawing && tool === "rect" ? "primary" : "secondary"} onClick={() => switchTool("rect")}>
          ▭ Rectangle
        </button>
        {drawing && tool === "polygon" && (
          <>
            <button type="button" className={mode === "draw" ? "primary" : "secondary"} onClick={() => setMode("draw")}>
              + Draw points
            </button>
            <button type="button" className={mode === "edit" ? "primary" : "secondary"} onClick={() => setMode("edit")} disabled={!points.length}>
              ↔ Move points
            </button>
          </>
        )}
        <button type="button" className="secondary" onClick={locate}>
          ⌖ My location
        </button>
        <button
          type="button"
          className="secondary"
          disabled={!allBounds}
          onClick={() => allBounds && setFly({ to: [allBounds.getCenter().lat, allBounds.getCenter().lng], zoom: 12, n: Date.now() })}
        >
          ⤢ All zones
        </button>
        <button type="button" className="secondary" disabled={!hasDraft} onClick={undo}>
          ↶ Undo
        </button>
        <button type="button" className="danger" disabled={!hasDraft} onClick={clear}>
          Clear
        </button>
      </div>
      <div className="fence-hint" role="status">
        {hint}
      </div>
      <MapContainer center={[25.2854, 51.531]} zoom={12} className="map fence-map" style={{ height: 520, width: "100%" }} scrollWheelZoom={false}>
        <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <Fly target={fly} />
        <FitBounds bounds={allBounds} version={fitKey} />
        <MapClick onClick={onMapClick} skipUntil={skipUntil} />

        {/* every saved zone (the one being edited is drawn as the editable draft instead) */}
        {others.map((z) => {
          const active = z.active !== false;
          const poly = ((z.polygon as number[][]) || []).map((p) => ll([Number(p[0]), Number(p[1])]));
          return (
            <Polygon
              key={String(z.id)}
              positions={poly}
              pathOptions={
                active
                  ? { color: "#059669", weight: 2.5, fillColor: "#10b981", fillOpacity: 0.16 }
                  : { color: "#64748b", weight: 2, dashArray: "6,6", fillColor: "#94a3b8", fillOpacity: 0.1 }
              }
              eventHandlers={{
                click: (e) => {
                  // While drawing, clicks pass through so points can be placed inside other zones.
                  if (armed || (selected && tool === "polygon" && mode === "draw")) return;
                  L.DomEvent.stopPropagation(e.originalEvent);
                  skipUntil.current = Date.now() + 400;
                  onSelect(z);
                },
              }}
            >
              <Tooltip sticky>
                <b>{z.name}</b>
                <br />
                {branchName(String(z.branch_id)) || "No branch"} · {active ? "Active" : "Disabled"}
                <br />
                <small>Click to edit</small>
              </Tooltip>
            </Polygon>
          );
        })}

        {/* the zone being drawn / edited */}
        {tool === "polygon" && points.length >= 3 && <Polygon positions={points.map(ll)} pathOptions={{ color: "#2563eb", weight: 3, fillColor: "#3b82f6", fillOpacity: 0.2 }} />}
        {tool === "polygon" && points.length === 2 && <Polyline positions={points.map(ll)} pathOptions={{ color: "#2563eb", weight: 3, dashArray: "6,6" }} />}
        {tool === "polygon" &&
          points.map((p, i) => (
            <Handle
              key={i}
              position={p}
              label={String(i + 1)}
              onMove={(np) => setPoints((o) => o.map((x, j) => (j === i ? np : x)))}
              onContext={() => setPoints((o) => o.filter((_, j) => j !== i))}
              skipUntil={skipUntil}
            />
          ))}

        {tool === "circle" && circle && (
          <>
            <Circle center={ll(circle.c)} radius={circle.r} pathOptions={{ color: "#2563eb", weight: 3, fillColor: "#3b82f6", fillOpacity: 0.2 }} />
            <Handle position={circle.c} label="●" onMove={(np) => setCircle((o) => (o ? { ...o, c: np } : o))} skipUntil={skipUntil} />
            <Handle
              position={edgeEast(circle.c, circle.r)}
              label="↔"
              kind="edge"
              onMove={(np) => setCircle((o) => (o ? { ...o, r: Math.max(5, Math.min(20000, distM(o.c, np))) } : o))}
              skipUntil={skipUntil}
            />
          </>
        )}

        {tool === "rect" && rectStart && <Handle position={rectStart} label="A" onMove={setRectStart as (p: Point) => void} skipUntil={skipUntil} />}
        {tool === "rect" && rect && (
          <>
            <Rectangle bounds={[ll(rect.a), ll(rect.b)]} pathOptions={{ color: "#2563eb", weight: 3, fillColor: "#3b82f6", fillOpacity: 0.2 }} />
            <Handle position={rect.a} label="A" onMove={(np) => setRect((o) => (o ? { ...o, a: np } : o))} skipUntil={skipUntil} />
            <Handle position={rect.b} label="B" onMove={(np) => setRect((o) => (o ? { ...o, b: np } : o))} skipUntil={skipUntil} />
          </>
        )}
      </MapContainer>

      <div className="fence-bottom">
        <span>
          {tool === "polygon" && `${points.length} points · ${points.length < 3 ? "At least 3 required" : "Boundary ready"}`}
          {tool === "circle" &&
            (circle ? (
              <>
                Radius{" "}
                <input
                  className="fenceRadius"
                  type="number"
                  min={5}
                  max={20000}
                  step={5}
                  value={Math.round(circle.r)}
                  onChange={(e) => setCircle((o) => (o ? { ...o, r: Math.max(5, Math.min(20000, Number(e.target.value) || 5)) } : o))}
                />{" "}
                m
              </>
            ) : (
              "Tap the map to place the centre"
            ))}
          {tool === "rect" && (rect ? `Rectangle ready · about ${Math.round(distM([rect.a[0], rect.a[1]], [rect.b[0], rect.a[1]]))} × ${Math.round(distM([rect.a[0], rect.a[1]], [rect.a[0], rect.b[1]]))} m` : "Tap two opposite corners")}
        </span>
        <button type="button" className="primary" disabled={!ready || saving} onClick={save}>
          {selectedId ? "Save changes" : "Save zone"}
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
