"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { WEEK_ORDER, WEEKDAY_NAMES } from "../lib/offdays";

type Row = Record<string, any>;
type Props = {
  api: (path: string, payload?: Row) => Promise<Row>;
  staff: Row[];
  onChanged: () => void;
};

const monthOf = (d: Date) =>
  d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
const shiftMonth = (m: string, delta: number) => {
  const [y, mo] = m.split("-").map(Number);
  return monthOf(new Date(y, mo - 1 + delta, 1));
};
const daysIn = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(y, mo, 0).getDate();
};

export default function DayControl({ api, staff, onChanged }: Props) {
  const people = useMemo(
    () =>
      staff.filter((s) => !["admin", "display"].includes(String(s.role))),
    [staff],
  );
  const [find, setFind] = useState("");
  const [empId, setEmpId] = useState("");
  const [month, setMonth] = useState(monthOf(new Date()));
  const [info, setInfo] = useState<Row | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [offEdit, setOffEdit] = useState<number[]>([]);
  const [eff, setEff] = useState("");

  const visible = people.filter(
    (p) =>
      !find ||
      (String(p.name) + " " + String(p.public_id || ""))
        .toLowerCase()
        .includes(find.toLowerCase()),
  );

  const load = useCallback(async () => {
    if (!empId) return;
    try {
      const r = await api("day-control", { action: "load", employeeId: empId, month });
      setInfo(r);
      setSel(new Set());
      const cur = (r.history as Row[])
        .filter((h) => String(h.effective_from) <= String(r.today))
        .pop();
      setOffEdit(((cur?.days as number[]) || []).map(Number));
      setEff((e) => e || String(r.today));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }, [api, empId, month]);
  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => {
    if (!info) return [];
    const history = (info.history as Row[]).map((h) => ({
      from: String(h.effective_from),
      days: (h.days as number[]).map(Number),
    }));
    const n = daysIn(month);
    return Array.from({ length: n }, (_, i) => {
      const date = month + "-" + String(i + 1).padStart(2, "0");
      const wd = new Date(date + "T00:00:00Z").getUTCDay();
      let scheduled: number[] = [];
      for (const h of history) if (h.from <= date) scheduled = h.days;
      const ov = (info.overrides as Row[]).find((o) => String(o.day) === date)?.kind;
      const leave = (info.leaves as Row[]).find(
        (l) => String(l.start_date) <= date && date <= String(l.end_date),
      );
      const s = (info.days as Row[]).find((d) => String(d.day) === date);
      const off = ov === "off" || (ov !== "work" && scheduled.includes(wd));
      const future = date > String(info.today);
      let label = "—";
      let tone = "none";
      if (leave) {
        label = String(leave.leave_type || "Leave");
        tone = /sick/i.test(label) ? "sick" : "leave";
      } else if (s && Number(s.n) > Number(s.absent || 0)) {
        label = "Worked";
        tone = "worked";
      } else if (s && Number(s.absent) > 0) {
        label = "Absent (session limit)";
        tone = "absent";
      } else if (off) {
        label = ov === "off" ? "Off Day (set manually)" : "Off Day";
        tone = "off";
      } else if (!future) {
        label = ov === "work" ? "Absent (working day)" : "Absent";
        tone = "absent";
      }
      return { date, wd, label, tone, sessions: s ? Number(s.n) : 0, manual: ov || "", multiLeave: !!leave && String(leave.start_date) !== String(leave.end_date) };
    });
  }, [info, month]);

  const apply = async (status: string) => {
    if (!sel.size) return toast.error("Select at least one day");
    setBusy(true);
    try {
      await api("day-control", {
        action: "set-days",
        employeeId: empId,
        dates: Array.from(sel),
        status,
      });
      toast.success("Days updated");
      await load();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const saveOff = async () => {
    setBusy(true);
    try {
      await api("day-control", {
        action: "set-offdays",
        employeeId: empId,
        days: offEdit,
        effectiveFrom: eff,
      });
      toast.success("Weekly off days saved from " + eff);
      await load();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const toggle = (d: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(d)) n.delete(d);
      else n.add(d);
      return n;
    });
  const absentDates = rows.filter((r) => r.tone === "absent").map((r) => r.date);
  const hist: Row[] = info?.history || [];

  return (
    <div className="dcPage">
      <section className="efCard">
        <h3>
          <CalendarDays size={16} /> Day Control
        </h3>
        <p className="muted">
          Change weekly off days, turn an absent day into an Off Day, Leave or
          Sick Leave, or correct previous days. Changes to weekly off days made
          from the employee page only apply from today; use this page to
          change earlier dates.
        </p>
        <div className="efTwo">
          <label className="efLabel">
            Find employee
            <span className="efInput">
              <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Name or ID" />
            </span>
          </label>
          <label className="efLabel">
            Employee
            <span className="efInput">
              <select
                value={empId}
                onChange={(e) => {
                  setEmpId(e.target.value);
                  setInfo(null);
                  setEff("");
                }}
              >
                <option value="">Select employee…</option>
                {visible.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} {p.public_id ? "· " + p.public_id : ""}
                  </option>
                ))}
              </select>
            </span>
          </label>
        </div>
      </section>

      {empId && info && (
        <>
          <section className="efCard">
            <h3>Weekly off days — {info.employee.name}</h3>
            <div className="dcChips">
              {WEEK_ORDER.map((d) => (
                <button
                  key={d}
                  type="button"
                  className={"dcChip" + (offEdit.includes(d) ? " on" : "")}
                  onClick={() =>
                    setOffEdit((o) =>
                      o.includes(d) ? o.filter((x) => x !== d) : [...o, d],
                    )
                  }
                >
                  {WEEKDAY_NAMES[d]}
                </button>
              ))}
            </div>
            <div className="dcSave">
              <label className="efLabel">
                Apply from
                <span className="efInput">
                  <input
                    type="date"
                    value={eff}
                    max={String(info.today)}
                    onChange={(e) => setEff(e.target.value)}
                  />
                </span>
              </label>
              <button type="button" className="primary" disabled={busy || !eff} onClick={saveOff}>
                Save weekly off days
              </button>
            </div>
            <small className="muted">
              Days before the chosen date keep their old schedule. A past date
              re-applies the new schedule from that date onward.
            </small>
            {hist.length > 0 && (
              <ul className="dcHist">
                {hist.map((h) => (
                  <li key={String(h.effective_from)}>
                    <b>From {String(h.effective_from)}</b>:{" "}
                    {(h.days as number[]).length
                      ? WEEK_ORDER.filter((d) => (h.days as number[]).includes(d))
                          .map((d) => WEEKDAY_NAMES[d])
                          .join(", ")
                      : "no off days"}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="efCard">
            <div className="dcMonth">
              <button type="button" className="secondary small" onClick={() => setMonth((m) => shiftMonth(m, -1))}>
                <ChevronLeft size={14} />
              </button>
              <b>{month}</b>
              <button type="button" className="secondary small" onClick={() => setMonth((m) => shiftMonth(m, 1))}>
                <ChevronRight size={14} />
              </button>
            </div>
            <div className="dcActions">
              <span>{sel.size} selected</span>
              <button type="button" className="secondary small" onClick={() => setSel(new Set(absentDates))}>
                Select all absent
              </button>
              <button type="button" className="secondary small" onClick={() => setSel(new Set())}>
                Clear selection
              </button>
              <button type="button" className="primary small" disabled={busy} onClick={() => apply("off")}>Off Day</button>
              <button type="button" className="primary small" disabled={busy} onClick={() => apply("leave")}>Leave</button>
              <button type="button" className="primary small" disabled={busy} onClick={() => apply("sick")}>Sick Leave</button>
              <button type="button" className="secondary small" disabled={busy} onClick={() => apply("work")}>Working Day</button>
              <button type="button" className="danger small" disabled={busy} onClick={() => apply("clear")}>Reset</button>
            </div>
            <div className="dataScroll">
              <table>
                <thead>
                  <tr>
                    <th></th>
                    <th>Date</th>
                    <th>Day</th>
                    <th>Sessions</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.date} className={sel.has(r.date) ? "dcSel" : ""}>
                      <td>
                        <input
                          type="checkbox"
                          checked={sel.has(r.date)}
                          onChange={() => toggle(r.date)}
                          aria-label={"Select " + r.date}
                        />
                      </td>
                      <td>{r.date}</td>
                      <td>{WEEKDAY_NAMES[r.wd]}</td>
                      <td>{r.sessions || "—"}</td>
                      <td>
                        <span className={"dcTag " + r.tone}>{r.label}</span>
                        {r.multiLeave && <small className="muted"> (multi-day leave)</small>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
