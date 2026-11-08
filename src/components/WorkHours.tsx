"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  CalendarRange,
  Clock3,
  Pencil,
  Plus,
  Power,
  Trash2,
  Users,
} from "lucide-react";

type Row = Record<string, any>;
type Props = {
  api: (path: string, payload?: Row) => Promise<Row>;
  staff: Row[];
  onChanged: () => void;
};

type Draft = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  hours: string;
  scope: "all" | "employees";
  employeeIds: string[];
  note: string;
};

const todayQatar = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Qatar" });

const emptyDraft = (today: string, name = ""): Draft => ({
  id: "",
  name,
  startDate: today,
  endDate: today,
  hours: "6",
  scope: "all",
  employeeIds: [],
  note: "",
});

const fmtHours = (h: number) =>
  Number.isInteger(h) ? String(h) : String(Number(h.toFixed(2)));

const daysBetween = (a: string, b: string) =>
  Math.round(
    (Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000,
  ) + 1;

export default function WorkHours({ api, staff, onChanged }: Props) {
  const people = useMemo(
    () => staff.filter((s) => !["admin", "display"].includes(String(s.role))),
    [staff],
  );
  const nameOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of people) m.set(String(p.id), String(p.name));
    return m;
  }, [people]);

  const [periods, setPeriods] = useState<Row[]>([]);
  const [today, setToday] = useState(todayQatar());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [find, setFind] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await api("work-hours");
      setPeriods((r.periods as Row[]) || []);
      if (r.today) setToday(String(r.today));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [api]);
  useEffect(() => {
    void load();
  }, [load]);

  const statusOf = (p: Row) => {
    if (!p.active) return { tone: "off", label: "Disabled" };
    if (today < String(p.start_date)) return { tone: "leave", label: "Upcoming" };
    if (today > String(p.end_date)) return { tone: "off", label: "Ended" };
    return { tone: "worked", label: "Active now" };
  };

  const visible = people.filter(
    (p) =>
      !find ||
      (String(p.name) + " " + String(p.public_id || ""))
        .toLowerCase()
        .includes(find.toLowerCase()),
  );

  const startNew = (name = "") => {
    setFind("");
    setDraft(emptyDraft(today, name));
  };
  const startEdit = (p: Row) => {
    setFind("");
    setDraft({
      id: String(p.id),
      name: String(p.name),
      startDate: String(p.start_date),
      endDate: String(p.end_date),
      hours: fmtHours(Number(p.hours)),
      scope: p.scope === "employees" ? "employees" : "all",
      employeeIds: ((p.employee_ids as string[]) || []).map(String),
      note: String(p.note || ""),
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const save = async () => {
    if (!draft) return;
    const hours = Number(draft.hours);
    if (draft.name.trim().length < 2) return toast.error("Enter a name for the period");
    if (!draft.startDate || !draft.endDate) return toast.error("Choose the start and end dates");
    if (draft.endDate < draft.startDate) return toast.error("End date must be on or after the start date");
    if (!Number.isFinite(hours) || hours < 0.5 || hours > 24)
      return toast.error("Daily hours must be between 0.5 and 24");
    if (draft.scope === "employees" && !draft.employeeIds.length)
      return toast.error("Select at least one employee");
    setBusy(true);
    try {
      const r = await api("work-hours", {
        action: "save",
        id: draft.id || undefined,
        name: draft.name.trim(),
        startDate: draft.startDate,
        endDate: draft.endDate,
        hours,
        scope: draft.scope,
        employeeIds: draft.scope === "employees" ? draft.employeeIds : [],
        note: draft.note.trim(),
      });
      toast.success(
        "Period saved" +
          (Number(r.sessions) > 0
            ? " — " + r.sessions + " existing record(s) updated"
            : ""),
      );
      setDraft(null);
      await load();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (p: Row) => {
    setBusy(true);
    try {
      await api("work-hours", { action: "toggle", id: p.id, name: p.name, active: !p.active });
      toast.success(p.active ? "Period disabled" : "Period enabled");
      await load();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (p: Row) => {
    if (
      !window.confirm(
        `Delete "${p.name}"?\n\nRecords inside these dates go back to each employee's normal required hours.`,
      )
    )
      return;
    setBusy(true);
    try {
      await api("work-hours", { action: "delete", id: p.id, name: p.name });
      toast.success("Period deleted");
      await load();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const togglePerson = (id: string) =>
    setDraft((d) =>
      d
        ? {
            ...d,
            employeeIds: d.employeeIds.includes(id)
              ? d.employeeIds.filter((x) => x !== id)
              : [...d.employeeIds, id],
          }
        : d,
    );

  const scopeText = (p: Row) => {
    if (p.scope !== "employees") return "All employees";
    const ids = ((p.employee_ids as string[]) || []).map(String);
    const names = ids.map((i) => nameOf.get(i)).filter(Boolean) as string[];
    if (!names.length) return ids.length + " employee(s)";
    return names.length <= 3
      ? names.join(", ")
      : names.slice(0, 3).join(", ") + " +" + (names.length - 3) + " more";
  };

  const overlaps = useMemo(() => {
    if (!draft || !draft.startDate || !draft.endDate) return [] as Row[];
    return periods.filter((p) => {
      if (!p.active || p.id === draft.id) return false;
      if (String(p.start_date) > draft.endDate || String(p.end_date) < draft.startDate) return false;
      if (p.scope !== "employees" || draft.scope !== "employees") return true;
      const mine = new Set(draft.employeeIds);
      return ((p.employee_ids as string[]) || []).some((i) => mine.has(String(i)));
    });
  }, [draft, periods]);

  return (
    <div className="whPage">
      <section className="efCard">
        <h3>
          <CalendarRange size={18} /> Special working hours
        </h3>
        <p className="muted whIntro">
          Set shorter (or longer) daily hours for a date range — for example
          Ramadan — for everyone or for selected employees. Inside the period
          the required hours are replaced, so a shorter day is not counted as
          early leave or absence. Days outside the period are not affected.
        </p>
        {!draft && (
          <div className="dcActions">
            <button type="button" className="primary" onClick={() => startNew()}>
              <Plus size={16} /> Add period
            </button>
            <button type="button" className="secondary" onClick={() => startNew("Ramadan")}>
              Ramadan hours
            </button>
          </div>
        )}
      </section>

      {draft && (
        <section className="efCard">
          <h3>
            <Clock3 size={18} /> {draft.id ? "Edit period" : "New period"}
          </h3>
          <div className="whForm">
            <label className="efLabel">
              Name
              <span className="efInput">
                <input
                  value={draft.name}
                  maxLength={60}
                  placeholder="e.g. Ramadan 2027"
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </span>
            </label>
            <label className="efLabel">
              From
              <span className="efInput">
                <input
                  type="date"
                  value={draft.startDate}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      startDate: e.target.value,
                      endDate: draft.endDate < e.target.value ? e.target.value : draft.endDate,
                    })
                  }
                />
              </span>
            </label>
            <label className="efLabel">
              To
              <span className="efInput">
                <input
                  type="date"
                  value={draft.endDate}
                  min={draft.startDate}
                  onChange={(e) => setDraft({ ...draft, endDate: e.target.value })}
                />
              </span>
            </label>
            <label className="efLabel">
              Required hours per day
              <span className="efInput">
                <input
                  type="number"
                  min="0.5"
                  max="24"
                  step="0.25"
                  value={draft.hours}
                  onChange={(e) => setDraft({ ...draft, hours: e.target.value })}
                />
              </span>
            </label>
          </div>

          <div className="whScope">
            <b>Applies to</b>
            <div className="dcChips">
              <button
                type="button"
                className={"dcChip" + (draft.scope === "all" ? " on" : "")}
                onClick={() => setDraft({ ...draft, scope: "all" })}
              >
                All employees
              </button>
              <button
                type="button"
                className={"dcChip" + (draft.scope === "employees" ? " on" : "")}
                onClick={() => setDraft({ ...draft, scope: "employees" })}
              >
                Selected employees
              </button>
            </div>
          </div>

          {draft.scope === "employees" && (
            <div className="dcPick">
              <div className="dcPickBar">
                <span className="efInput">
                  <input
                    value={find}
                    onChange={(e) => setFind(e.target.value)}
                    placeholder="Search employees"
                  />
                </span>
                <button
                  type="button"
                  className="secondary small"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      employeeIds: Array.from(
                        new Set([...draft.employeeIds, ...visible.map((p) => String(p.id))]),
                      ),
                    })
                  }
                >
                  Select all{find ? " (filtered)" : ""}
                </button>
                <button
                  type="button"
                  className="secondary small"
                  onClick={() => setDraft({ ...draft, employeeIds: [] })}
                >
                  Clear
                </button>
                <b>{draft.employeeIds.length} selected</b>
              </div>
              <div className="dcPickList">
                {visible.map((p) => (
                  <label key={p.id}>
                    <input
                      type="checkbox"
                      checked={draft.employeeIds.includes(String(p.id))}
                      onChange={() => togglePerson(String(p.id))}
                    />
                    {p.name} <small className="muted">{p.public_id}</small>
                  </label>
                ))}
                {!visible.length && <p className="muted">No employees found.</p>}
              </div>
            </div>
          )}

          <label className="efLabel">
            Note (optional)
            <span className="efInput">
              <input
                value={draft.note}
                maxLength={200}
                onChange={(e) => setDraft({ ...draft, note: e.target.value })}
              />
            </span>
          </label>

          {overlaps.length > 0 && (
            <p className="whWarn">
              Overlaps with: {overlaps.map((o) => `"${o.name}"`).join(", ")}. If
              an employee falls in both, a period for selected employees wins
              over an "All employees" period; between two of the same kind the
              most recently created one wins.
            </p>
          )}
          <small className="muted">
            {draft.startDate && draft.endDate && draft.endDate >= draft.startDate
              ? daysBetween(draft.startDate, draft.endDate) + " day(s). "
              : ""}
            Attendance already recorded inside these dates is recalculated with
            the new hours (including points). Employees without a required-hours
            target stay without one. Weekly off days and leaves are not changed.
          </small>

          <div className="dcSave whSave">
            <button type="button" className="primary" disabled={busy} onClick={save}>
              {draft.id ? "Save changes" : "Create period"}
            </button>
            <button type="button" className="secondary" disabled={busy} onClick={() => setDraft(null)}>
              Cancel
            </button>
          </div>
        </section>
      )}

      <section className="efCard">
        <h3>
          <Users size={18} /> Periods
        </h3>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : !periods.length ? (
          <p className="muted">No special periods yet.</p>
        ) : (
          <div className="whList">
            {periods.map((p) => {
              const st = statusOf(p);
              return (
                <div className={"whItem" + (p.active ? "" : " dim")} key={p.id}>
                  <div className="whMain">
                    <div className="whTitle">
                      <b>{p.name}</b>
                      <span className={"dcTag " + st.tone}>{st.label}</span>
                    </div>
                    <div className="whMeta">
                      <span>
                        {String(p.start_date)} → {String(p.end_date)} (
                        {daysBetween(String(p.start_date), String(p.end_date))} days)
                      </span>
                      <span>{scopeText(p)}</span>
                    </div>
                    {p.note ? <small className="muted">{p.note}</small> : null}
                  </div>
                  <div className="whHours">
                    <b>{fmtHours(Number(p.hours))}</b>
                    <small>h / day</small>
                  </div>
                  <div className="whBtns">
                    <button type="button" className="secondary small" disabled={busy} onClick={() => startEdit(p)}>
                      <Pencil size={14} /> Edit
                    </button>
                    <button type="button" className="secondary small" disabled={busy} onClick={() => toggle(p)}>
                      <Power size={14} /> {p.active ? "Disable" : "Enable"}
                    </button>
                    <button type="button" className="danger small" disabled={busy} onClick={() => remove(p)}>
                      <Trash2 size={14} /> Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
