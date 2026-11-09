"use client";
import { useEffect, useMemo, useRef } from "react";
import { MapContainer, TileLayer, CircleMarker, Polygon, Polyline, Popup, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { KIND_COLOR, KIND_LABEL, fmtTime } from "./punchMapShared";

type Row = Record<string, any>;
type Props = {
  points: Row[];
  zones: Row[];
  showZones: boolean;
  connect: boolean;
  showNames: boolean;
  focusEmp: string | null;
  focusId: string | null;
  focusTick: number;
  fitKey: string;
};

const qatarDay = (v: unknown) => new Date(String(v)).toLocaleDateString("en-CA", { timeZone: "Asia/Qatar" });

function Fit({ bounds, fitKey }: { bounds: L.LatLngBounds | null; fitKey: string }) {
  const map = useMap();
  useEffect(() => {
    if (bounds && bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 17 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, fitKey]);
  return null;
}
function Focus({ point, tick }: { point: Row | null; tick: number }) {
  const map = useMap();
  useEffect(() => {
    if (point) map.flyTo([point.lat, point.lon], Math.max(map.getZoom(), 17));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, tick]);
  return null;
}

export default function PunchMapView({ points, zones, showZones, connect, showNames, focusEmp, focusId, focusTick, fitKey }: Props) {
  const refs = useRef<Record<string, L.CircleMarker | null>>({});
  const focusPoint = useMemo(() => points.find((p) => p.id === focusId) || null, [points, focusId]);

  useEffect(() => {
    if (focusId) setTimeout(() => refs.current[focusId]?.openPopup(), 450);
  }, [focusId, focusTick]);

  const bounds = useMemo(() => {
    const pts: [number, number][] = points.map((p) => [p.lat, p.lon]);
    if (!pts.length && showZones) for (const z of zones) for (const q of (z.polygon as number[][]) || []) pts.push([Number(q[1]), Number(q[0])]);
    return pts.length ? L.latLngBounds(pts) : null;
  }, [points, zones, showZones]);

  // One line per employee per day, in time order.
  const routes = useMemo(() => {
    if (!connect) return [] as { key: string; pos: [number, number][] }[];
    const m = new Map<string, Row[]>();
    for (const p of points) {
      if (p.kind === "fail") continue;
      const k = p.employee_id + "|" + qatarDay(p.time);
      const l = m.get(k) || [];
      l.push(p);
      m.set(k, l);
    }
    return Array.from(m.entries())
      .filter(([, l]) => l.length > 1)
      .map(([k, l]) => ({ key: k, pos: l.map((p) => [p.lat, p.lon] as [number, number]) }));
  }, [points, connect]);

  const labelled = showNames && points.length <= 150;

  return (
    <MapContainer center={[25.2854, 51.531]} zoom={12} className="map punch-map" style={{ height: 560, width: "100%" }} scrollWheelZoom={false}>
      <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <Fit bounds={bounds} fitKey={fitKey} />
      <Focus point={focusPoint} tick={focusTick} />

      {showZones &&
        zones.map((z) => (
          <Polygon
            key={String(z.id)}
            positions={((z.polygon as number[][]) || []).map((q) => [Number(q[1]), Number(q[0])] as [number, number])}
            pathOptions={
              z.active !== false
                ? { color: "#059669", weight: 2, fillColor: "#10b981", fillOpacity: 0.1 }
                : { color: "#64748b", weight: 2, dashArray: "6,6", fillColor: "#94a3b8", fillOpacity: 0.06 }
            }
            interactive={false}
          />
        ))}

      {routes.map((r) => (
        <Polyline key={r.key} positions={r.pos} pathOptions={{ color: "#6366f1", weight: 2, opacity: 0.55, dashArray: "5,6" }} interactive={false} />
      ))}

      {points.map((p) => {
        const dim = !!focusEmp && p.employee_id !== focusEmp;
        const color = KIND_COLOR[p.kind];
        const isFocus = p.id === focusId;
        return (
          <CircleMarker
            key={p.id}
            ref={(r) => {
              refs.current[p.id] = r;
            }}
            center={[p.lat, p.lon]}
            radius={isFocus ? 11 : p.kind === "fail" ? 8 : 7}
            pathOptions={{
              color: "#ffffff",
              weight: 2,
              fillColor: color,
              fillOpacity: dim ? 0.18 : p.kind === "fail" ? 0.75 : 0.9,
              opacity: dim ? 0.3 : 1,
            }}
          >
            {labelled && !dim && (
              <Tooltip permanent direction="top" offset={[0, -6]} className="pmName">
                {String(p.name).split(" ")[0]}
              </Tooltip>
            )}
            {!labelled && (
              <Tooltip direction="top">
                {p.name} · {KIND_LABEL[p.kind]}
              </Tooltip>
            )}
            <Popup>
              <div className="pmPop">
                <b>{p.name}</b> <small>{p.public_id}</small>
                <div style={{ color }}>
                  <b>{KIND_LABEL[p.kind]}</b>
                  {p.kind === "fail" && p.action ? ` (${p.action})` : ""}
                </div>
                <div>{fmtTime(p.time)}</div>
                {p.kind === "fail" && p.reason ? <div>{String(p.reason)}</div> : null}
                {p.kind === "fail" && p.distance_m != null ? <div>{Math.round(p.distance_m)} m from the nearest zone</div> : null}
                {p.kind === "fail" && p.accuracy != null ? <div>GPS accuracy {Math.round(p.accuracy)} m</div> : null}
                {p.outside === true ? <div className="pmWarn">Outside the active zones</div> : null}
                {p.outside === false ? <div>Inside an active zone</div> : null}
                <small>
                  {p.lat.toFixed(5)}, {p.lon.toFixed(5)}
                </small>
              </div>
            </Popup>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}
