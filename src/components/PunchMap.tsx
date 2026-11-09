"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Filter, LocateFixed, RefreshCw } from "lucide-react";
import { KIND_COLOR, KIND_LABEL, fmtTime } from "./punchMapShared";

const PunchMapView = dynamic(() => import("./PunchMapView"), {
  ssr: false,
  loading: () => <div className="loading">Loading map…</div>,
});

type Row = Record<string, any>;
type Props = {
  api: (path: string, payload?: Row) => Promise<Row>;
  staff: Row[];
  zones: Row[];
  refreshKey?: number;
};

const todayQatar = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Qatar" });
const shift = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);

export default function PunchMap({ api, staff, zones, refreshKey }: Props) {
  const people = useMemo(() => staff.filter((s) => !["admin", "display"].includes(String(s.role))), [staff]);
  const [from, setFrom] = useState(todayQatar());
  const [to, setTo] = useState(todayQatar());
  const [types, setTypes] = useState<string[]>(["in", "out", "fail"]);
  const [emps, setEmps] = useState<string[]>([]);
  const [find, setFind] = useState("");
  const [showPick, setShowPick] = useState(false);
  const [showZones, setShowZones] = useState(true);
  const [connect, setConnect] = useState(false);
  const [showNames, setShowNames] = useState(false);
  const [points, setPoints] = useState<Row[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [focusEmp, setFocusEmp] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  const [fitKey, setFitKey] = useState("0");
  const [rows, setRows] = useState(200);

  const load = useCallback(
    async (f = from, t = to) => {
      if (!types.length) return toast.error("Choose at least one type");
      if (t < f) return toast.error("End date must be on or after the start date");
      setLoading(true);
      try {
        const r = await api("punch-map", { from: f, to: t, types, employees: emps });
        setPoints((r.points as Row[]) || []);
        setTruncated(r.truncated === true);
        setFocusEmp(null);
        setFocusId(null);
        setRows(200);
        setFitKey(String(Date.now()));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [api, from, to, types, emps],
  );
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // New activity elsewhere: refresh when viewing only today.
  useEffect(() => {
    if (refreshKey && from === todayQatar() && to === from) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const quick = (f: string, t: string) => {
    setFrom(f);
    setTo(t);
    void load(f, t);
  };

  const counts = useMemo(() => {
    const c = { in: 0, out: 0, fail: 0 } as Record<string, number>;
    for (const p of points) c[p.kind]++;
    return c;
  }, [points]);

  const perPerson = useMemo(() => {
    const m = new Map<string, { id: string; name: string; in: number; out: number; fail: number }>();
    for (const p of points) {
      const e = m.get(p.employee_id) || { id: p.employee_id, name: String(p.name), in: 0, out: 0, fail: 0 };
      (e as Row)[p.kind]++;
      m.set(p.employee_id, e);
    }
    return Array.from(m.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [points]);

  const listed = useMemo(() => {
    const l = focusEmp ? points.filter((p) => p.employee_id === focusEmp) : points;
    return [...l].reverse();
  }, [points, focusEmp]);

  const visibleEmp = people.filter((p) => !find || (String(p.name) + " " + String(p.public_id || "")).toLowerCase().includes(find.toLowerCase()));
  const toggleType = (k: string) => setTypes((t) => (t.includes(k) ? t.filter((x) => x !== k) : [...t, k]));
  const toggleEmp = (id: string) => setEmps((e) => (e.includes(id) ? e.filter((x) => x !== id) : [...e, id]));
  const showOnMap = (id: string) => {
    setFocusId(id);
    setFocusTick((n) => n + 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="pmPage">
      <section className="efCard">
        <h3>
          <Filter size={18} /> Show on map
        </h3>
        <div className="dcActions pmQuick">
          <button type="button" className="secondary small" onClick={() => quick(todayQatar(), todayQatar())}>
            Today
          </button>
          <button type="button" className="secondary small" onClick={() => quick(shift(todayQatar(), -1), shift(todayQatar(), -1))}>
            Yesterday
          </button>
          <button type="button" className="secondary small" onClick={() => quick(shift(todayQatar(), -6), todayQatar())}>
            Last 7 days
          </button>
          <button type="button" className="secondary small" onClick={() => quick(shift(todayQatar(), -29), todayQatar())}>
            Last 30 days
          </button>
        </div>
        <div className="whForm">
          <label className="efLabel">
            From
            <span className="efInput">
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </span>
          </label>
          <label className="efLabel">
            To
            <span className="efInput">
              <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
            </span>
          </label>
        </div>
        <div className="whScope">
          <b>Show</b>
          <div className="dcChips">
            {(["in", "out", "fail"] as const).map((k) => (
              <button key={k} type="button" className={"dcChip" + (types.includes(k) ? " on" : "")} onClick={() => toggleType(k)}>
                <span className="pmDot" style={{ background: KIND_COLOR[k] }} /> {KIND_LABEL[k]}
              </button>
            ))}
          </div>
        </div>
        <div className="whScope">
          <b>Employees</b>
          <div className="dcChips">
            <button type="button" className={"dcChip" + (!emps.length ? " on" : "")} onClick={() => setEmps([])}>
              All employees
            </button>
            <button type="button" className={"dcChip" + (emps.length ? " on" : "")} onClick={() => setShowPick((v) => !v)}>
              {emps.length ? `${emps.length} selected` : "Choose employees…"}
            </button>
          </div>
        </div>
        {showPick && (
          <div className="dcPick">
            <div className="dcPickBar">
              <span className="efInput">
                <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Search employees" />
              </span>
              <button type="button" className="secondary small" onClick={() => setEmps(Array.from(new Set([...emps, ...visibleEmp.map((p) => String(p.id))])))}>
                Select all{find ? " (filtered)" : ""}
              </button>
              <button type="button" className="secondary small" onClick={() => setEmps([])}>
                Clear
              </button>
            </div>
            <div className="dcPickList">
              {visibleEmp.map((p) => (
                <label key={p.id}>
                  <input type="checkbox" checked={emps.includes(String(p.id))} onChange={() => toggleEmp(String(p.id))} />
                  {p.name} <small className="muted">{p.public_id}</small>
                </label>
              ))}
            </div>
          </div>
        )}
        <div className="dcChips pmOpts">
          <label>
            <input type="checkbox" checked={showZones} onChange={(e) => setShowZones(e.target.checked)} /> Show geofence zones
          </label>
          <label>
            <input type="checkbox" checked={connect} onChange={(e) => setConnect(e.target.checked)} /> Connect each employee’s day in time order
          </label>
          <label>
            <input type="checkbox" checked={showNames} onChange={(e) => setShowNames(e.target.checked)} /> Show names on the map
          </label>
        </div>
        <div className="dcSave whSave">
          <button type="button" className="primary" disabled={loading} onClick={() => void load()}>
            <RefreshCw size={15} /> {loading ? "Loading…" : "Show on map"}
          </button>
        </div>
      </section>

      <section className="efCard">
        <h3>
          <LocateFixed size={18} /> Locations
        </h3>
        <div className="pmLegend">
          {(["in", "out", "fail"] as const).map((k) => (
            <span key={k}>
              <i className="pmDot" style={{ background: KIND_COLOR[k] }} /> {KIND_LABEL[k]}: <b>{counts[k]}</b>
            </span>
          ))}
          <span>
            Employees: <b>{perPerson.length}</b>
          </span>
        </div>
        {truncated && <p className="whWarn">Too many records — showing the first 4,000 of each type. Choose fewer days or employees.</p>}
        <PunchMapView
          points={points}
          zones={zones}
          showZones={showZones}
          connect={connect}
          showNames={showNames}
          focusEmp={focusEmp}
          focusId={focusId}
          focusTick={focusTick}
          fitKey={fitKey}
        />
        {!loading && !points.length && <p className="muted">No locations recorded for these filters. Manual entries have no location.</p>}
      </section>

      {perPerson.length > 0 && (
        <section className="efCard">
          <h3>Employees on the map</h3>
          <p className="muted pmHint">Click an employee to highlight only their points.</p>
          <div className="dcChips">
            {perPerson.map((p) => (
              <button key={p.id} type="button" className={"dcChip" + (focusEmp === p.id ? " on" : "")} onClick={() => setFocusEmp(focusEmp === p.id ? null : p.id)}>
                {p.name} · <span style={{ color: KIND_COLOR.in }}>{p.in}</span>/<span style={{ color: KIND_COLOR.out }}>{p.out}</span>/<span style={{ color: KIND_COLOR.fail }}>{p.fail}</span>
              </button>
            ))}
          </div>
          <small className="muted">Numbers: check-ins / check-outs / failed attempts.</small>
        </section>
      )}

      {listed.length > 0 && (
        <section className="efCard">
          <h3>Details</h3>
          <div className="dataScroll">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Employee</th>
                  <th>Type</th>
                  <th>Details</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {listed.slice(0, rows).map((p) => (
                  <tr key={p.id}>
                    <td>{fmtTime(p.time)}</td>
                    <td>{p.name}</td>
                    <td>
                      <span className="pmDot" style={{ background: KIND_COLOR[p.kind] }} /> {KIND_LABEL[p.kind]}
                    </td>
                    <td>
                      {p.kind === "fail"
                        ? String(p.reason || "") + (p.distance_m != null ? ` · ${Math.round(p.distance_m)} m away` : "")
                        : p.outside === true
                          ? "Outside the active zones"
                          : p.outside === false
                            ? "Inside a zone"
                            : "—"}
                    </td>
                    <td>
                      <button type="button" className="secondary small" onClick={() => showOnMap(p.id)}>
                        Show
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {listed.length > rows && (
            <button type="button" className="secondary small" onClick={() => setRows((n) => n + 200)}>
              Show more ({listed.length - rows} left)
            </button>
          )}
        </section>
      )}
    </div>
  );
}
