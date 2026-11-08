"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CalendarRange, Clock3, Pencil, Plus, Power, Trash2, Users } from "lucide-react";
import { WEEK_ORDER, WEEKDAY_NAMES } from "../lib/offdays";

type Row = Record<string, any>;
type Props = {
  api: (path: string, payload?: Row) => Promise<Row>;
  staff: Row[];
  onChanged: () => void;
};

type Kind = "range" | "weekday" | "date" | "nth";
type EndMode = "month" | "year" | "custom" | "forever";
const FOREVER = "2100-12-31";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const NTH = ["1st", "2nd", "3rd", "4th", "Last"];

type Draft = {
  id: string;
  kind: Kind;
  name: string;
  startDate: string;
  endDate: string;
  endMode: EndMode;
  hours: string;
  scope: "all" | "employees";
  employeeIds: string[];
  note: string;
  weekdays: number[];
  months: number[];
  dayOfMonth: string;
  dateRepeat: "monthly" | "yearly";
  nth: number;
  nthRepeat: "yearly" | "once";
  onceYear: string;
};

const todayQatar = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Qatar" });
const pad = (n: number) => String(n).padStart(2, "0");
const lastDayOf = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const fmtHours = (h: number) => (Number.isInteger(h) ? String(h) : String(Number(h.toFixed(2))));
const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000) + 1;
const addDay = (d: string) => new Date(Date.parse(d + "T00:00:00Z") + 86400000).toISOString().slice(0, 10);

const emptyDraft = (today: string): Draft => ({
  id: "",
  kind: "range",
  name: "",
  startDate: today,
  endDate: today,
  endMode: "forever",
  hours: "6",
  scope: "all",
  employeeIds: [],
  note: "",
  weekdays: [5],
  months: [],
  dayOfMonth: String(Number(today.slice(8, 10))),
  dateRepeat: "yearly",
  nth: 2,
  nthRepeat: "yearly",
  onceYear: today.slice(0, 4),
});

/** Same matching rule as the database function wh_period_matches. */
function matches(r: { kind: string; weekdays: number[]; months: number[]; dom: number | null; nth: number | null }, d: string) {
  if (r.kind === "range") return true;
  const y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7)), day = Number(d.slice(8, 10));
  const wd = new Date(d + "T00:00:00Z").getUTCDay();
  const monthOk = !r.months.length || r.months.includes(m);
  if (r.kind === "weekday") return r.weekdays.includes(wd) && monthOk;
  if (r.kind === "date") return day === r.dom && monthOk;
  if (r.kind === "nth") {
    if (!r.weekdays.includes(wd) || !monthOk) return false;
    return r.nth === 5 ? day + 7 > lastDayOf(y, m) : Math.floor((day - 1) / 7) + 1 === r.nth;
  }
  return false;
}

function nextDates(
  r: { kind: string; weekdays: number[]; months: number[]; dom: number | null; nth: number | null },
  start: string,
  end: string,
  today: string,
  count = 6,
) {
  const out: string[] = [];
  let d = start > today ? start : today;
  for (let i = 0; i < 2600 && d <= end && out.length < count; i++, d = addDay(d)) if (matches(r, d)) out.push(d);
  return out;
}

const monthList = (ms: number[]) => ms.map((m) => MONTHS[m - 1]).join(", ");
const dayList = (ds: number[]) => WEEK_ORDER.filter((d) => ds.includes(d)).map((d) => WEEKDAY_NAMES[d]).join(", ");

function describe(p: Row) {
  const ws = ((p.weekdays as number[]) || []).map(Number);
  const ms = ((p.months as number[]) || []).map(Number);
  if (p.kind === "weekday") return `Every ${dayList(ws)}` + (ms.length ? ` in ${monthList(ms)}` : "");
  if (p.kind === "date")
    return `Day ${p.day_of_month} of ` + (ms.length ? `every ${monthList(ms)}` : "every month");
  if (p.kind === "nth")
    return `${NTH[Number(p.nth) - 1]} ${dayList(ws)} of ` + (ms.length ? monthList(ms) : "every month");
  return "";
}

export default function WorkHours({ api, staff, onChanged }: Props) {
  const people = useMemo(() => staff.filter((s) => !["admin", "display"].includes(String(s.role))), [staff]);
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
    return { tone: "worked", label: p.kind === "range" ? "Active now" : "Running" };
  };

  const visible = people.filter(
    (p) => !find || (String(p.name) + " " + String(p.public_id || "")).toLowerCase().includes(find.toLowerCase()),
  );

  const startNew = () => {
    setFind("");
    setDraft(emptyDraft(today));
  };
  const startEdit = (p: Row) => {
    setFind("");
    const kind = (["range", "weekday", "date", "nth"].includes(p.kind) ? p.kind : "range") as Kind;
    const start = String(p.start_date), end = String(p.end_date);
    const ms = ((p.months as number[]) || []).map(Number);
    const wholeYear = start.slice(0, 4) === end.slice(0, 4) && start.endsWith("-01-01") && end.endsWith("-12-31");
    setDraft({
      ...emptyDraft(today),
      id: String(p.id),
      kind,
      name: String(p.name),
      startDate: start,
      endDate: end,
      endMode: end === FOREVER ? "forever" : "custom",
      hours: fmtHours(Number(p.hours)),
      scope: p.scope === "employees" ? "employees" : "all",
      employeeIds: ((p.employee_ids as string[]) || []).map(String),
      note: String(p.note || ""),
      weekdays: ((p.weekdays as number[]) || []).map(Number),
      months: ms,
      dayOfMonth: p.day_of_month ? String(p.day_of_month) : emptyDraft(today).dayOfMonth,
      dateRepeat: ms.length ? "yearly" : "monthly",
      nth: p.nth ? Number(p.nth) : 2,
      nthRepeat: kind === "nth" && wholeYear ? "once" : "yearly",
      onceYear: start.slice(0, 4),
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  /** Window (valid from / until) and rule fields as they will be saved. */
  const resolved = (d: Draft) => {
    let start = d.startDate;
    let end = d.endDate;
    let months = d.months;
    if (d.kind !== "range") {
      if (d.kind === "nth" && d.nthRepeat === "once") {
        start = `${d.onceYear}-01-01`;
        end = `${d.onceYear}-12-31`;
      } else if (d.endMode === "forever") end = FOREVER;
      else if (d.endMode === "month") end = `${start.slice(0, 7)}-${pad(lastDayOf(Number(start.slice(0, 4)), Number(start.slice(5, 7))))}`;
      else if (d.endMode === "year") end = `${start.slice(0, 4)}-12-31`;
    }
    if (d.kind === "date") months = d.dateRepeat === "yearly" ? d.months.slice(0, 1) : [];
    return { start, end, months };
  };

  const preview = useMemo(() => {
    if (!draft || draft.kind === "range") return [] as string[];
    const { start, end, months } = resolved(draft);
    if (!start || !end || end < start) return [];
    return nextDates(
      {
        kind: draft.kind,
        weekdays: draft.weekdays,
        months,
        dom: Number(draft.dayOfMonth) || null,
        nth: draft.nth,
      },
      start,
      end,
      today,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, today]);

  const save = async () => {
    if (!draft) return;
    const hours = Number(draft.hours);
    const { start, end, months } = resolved(draft);
    if (draft.name.trim().length < 2) return toast.error("Enter a name");
    if (!start || !end) return toast.error("Choose the dates");
    if (end < start) return toast.error("End date must be on or after the start date");
    if (!Number.isFinite(hours) || hours < 0.5 || hours > 24) return toast.error("Daily hours must be between 0.5 and 24");
    if (draft.kind === "weekday" && !draft.weekdays.length) return toast.error("Choose at least one weekday");
    if (draft.kind === "nth" && draft.weekdays.length !== 1) return toast.error("Choose one weekday");
    if (draft.kind === "date") {
      const n = Number(draft.dayOfMonth);
      if (!Number.isInteger(n) || n < 1 || n > 31) return toast.error("Day of month must be 1-31");
      if (draft.dateRepeat === "yearly" && !months.length) return toast.error("Choose the month");
    }
    if (draft.scope === "employees" && !draft.employeeIds.length) return toast.error("Select at least one employee");
    setBusy(true);
    try {
      const r = await api("work-hours", {
        action: "save",
        id: draft.id || undefined,
        kind: draft.kind,
        name: draft.name.trim(),
        startDate: start,
        endDate: end,
        hours,
        scope: draft.scope,
        employeeIds: draft.scope === "employees" ? draft.employeeIds : [],
        note: draft.note.trim(),
        weekdays: draft.kind === "range" || draft.kind === "date" ? [] : draft.weekdays,
        months: draft.kind === "range" ? [] : months,
        dayOfMonth: draft.kind === "date" ? Number(draft.dayOfMonth) : null,
        nth: draft.kind === "nth" ? draft.nth : null,
      });
      toast.success("Saved" + (Number(r.sessions) > 0 ? " — " + r.sessions + " existing record(s) updated" : ""));
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
      toast.success(p.active ? "Disabled" : "Enabled");
      await load();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (p: Row) => {
    if (!window.confirm(`Delete "${p.name}"?\n\nRecords it applied to go back to each employee's normal required hours.`)) return;
    setBusy(true);
    try {
      await api("work-hours", { action: "delete", id: p.id, name: p.name });
      toast.success("Deleted");
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
      d ? { ...d, employeeIds: d.employeeIds.includes(id) ? d.employeeIds.filter((x) => x !== id) : [...d.employeeIds, id] } : d,
    );
  const toggleIn = (list: number[], v: number) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v].sort((a, b) => a - b));

  const scopeText = (p: Row) => {
    if (p.scope !== "employees") return "All employees";
    const ids = ((p.employee_ids as string[]) || []).map(String);
    const names = ids.map((i) => nameOf.get(i)).filter(Boolean) as string[];
    if (!names.length) return ids.length + " employee(s)";
    return names.length <= 3 ? names.join(", ") : names.slice(0, 3).join(", ") + " +" + (names.length - 3) + " more";
  };

  const windowText = (p: Row) => {
    const s = String(p.start_date), e = String(p.end_date);
    if (p.kind === "range") return `${s} → ${e} (${daysBetween(s, e)} days)`;
    return e === FOREVER ? `From ${s}, no end date` : `${s} → ${e}`;
  };

  const overlaps = useMemo(() => {
    if (!draft) return [] as Row[];
    const { start, end } = resolved(draft);
    if (!start || !end) return [];
    return periods.filter((p) => {
      if (!p.active || p.id === draft.id) return false;
      if (String(p.start_date) > end || String(p.end_date) < start) return false;
      if (p.scope !== "employees" || draft.scope !== "employees") return true;
      const mine = new Set(draft.employeeIds);
      return ((p.employee_ids as string[]) || []).some((i) => mine.has(String(i)));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, periods]);

  const recurring = draft && draft.kind !== "range";
  const showWindow = recurring && !(draft?.kind === "nth" && draft.nthRepeat === "once");

  return (
    <div className="whPage">
      <section className="efCard">
        <h3>
          <CalendarRange size={18} /> Special working hours
        </h3>
        <p className="muted whIntro">
          Change the required daily hours for a date range, a repeating weekday (e.g. every Friday), a repeating date
          (e.g. the 15th of each month) or a day like “the 2nd Tuesday of February” — for everyone or for selected
          employees. On those days the required hours are replaced, so a shorter day is not counted as early leave or
          absence. Other days are not affected.
        </p>
        {!draft && (
          <div className="dcActions">
            <button type="button" className="primary" onClick={startNew}>
              <Plus size={16} /> Add rule
            </button>
          </div>
        )}
      </section>

      {draft && (
        <section className="efCard">
          <h3>
            <Clock3 size={18} /> {draft.id ? "Edit rule" : "New rule"}
          </h3>

          <div className="whScope">
            <b>Type</b>
            <div className="dcChips">
              {(
                [
                  ["range", "Date range"],
                  ["weekday", "Repeating weekday"],
                  ["date", "Day of month"],
                  ["nth", "Nth weekday of a month"],
                ] as [Kind, string][]
              ).map(([k, label]) => (
                <button key={k} type="button" className={"dcChip" + (draft.kind === k ? " on" : "")} onClick={() => setDraft({ ...draft, kind: k })}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="whForm">
            <label className="efLabel">
              Name
              <span className="efInput">
                <input value={draft.name} maxLength={60} placeholder="e.g. Short Fridays" onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </span>
            </label>
            <label className="efLabel">
              Required hours per day
              <span className="efInput">
                <input type="number" min="0.5" max="24" step="0.25" value={draft.hours} onChange={(e) => setDraft({ ...draft, hours: e.target.value })} />
              </span>
            </label>
          </div>

          {draft.kind === "range" && (
            <div className="whForm">
              <label className="efLabel">
                From
                <span className="efInput">
                  <input
                    type="date"
                    value={draft.startDate}
                    onChange={(e) => setDraft({ ...draft, startDate: e.target.value, endDate: draft.endDate < e.target.value ? e.target.value : draft.endDate })}
                  />
                </span>
              </label>
              <label className="efLabel">
                To
                <span className="efInput">
                  <input type="date" value={draft.endDate} min={draft.startDate} onChange={(e) => setDraft({ ...draft, endDate: e.target.value })} />
                </span>
              </label>
            </div>
          )}

          {draft.kind === "weekday" && (
            <>
              <div className="whScope">
                <b>Weekday(s)</b>
                <div className="dcChips">
                  {WEEK_ORDER.map((d) => (
                    <button key={d} type="button" className={"dcChip" + (draft.weekdays.includes(d) ? " on" : "")} onClick={() => setDraft({ ...draft, weekdays: toggleIn(draft.weekdays, d) })}>
                      {WEEKDAY_NAMES[d]}
                    </button>
                  ))}
                </div>
              </div>
              <div className="whScope">
                <b>Only in these months (leave empty for all months)</b>
                <div className="dcChips">
                  {MONTHS.map((m, i) => (
                    <button key={m} type="button" className={"dcChip" + (draft.months.includes(i + 1) ? " on" : "")} onClick={() => setDraft({ ...draft, months: toggleIn(draft.months, i + 1) })}>
                      {m.slice(0, 3)}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {draft.kind === "date" && (
            <div className="whForm">
              <label className="efLabel">
                Day of month
                <span className="efInput">
                  <input type="number" min="1" max="31" value={draft.dayOfMonth} onChange={(e) => setDraft({ ...draft, dayOfMonth: e.target.value })} />
                </span>
              </label>
              <label className="efLabel">
                Repeats
                <span className="efInput">
                  <select value={draft.dateRepeat} onChange={(e) => setDraft({ ...draft, dateRepeat: e.target.value as "monthly" | "yearly", months: e.target.value === "yearly" && !draft.months.length ? [Number(today.slice(5, 7))] : draft.months })}>
                    <option value="monthly">Every month</option>
                    <option value="yearly">Every year, in one month</option>
                  </select>
                </span>
              </label>
              {draft.dateRepeat === "yearly" && (
                <label className="efLabel">
                  Month
                  <span className="efInput">
                    <select value={draft.months[0] || ""} onChange={(e) => setDraft({ ...draft, months: [Number(e.target.value)] })}>
                      <option value="" disabled>Choose…</option>
                      {MONTHS.map((m, i) => (
                        <option key={m} value={i + 1}>{m}</option>
                      ))}
                    </select>
                  </span>
                </label>
              )}
            </div>
          )}

          {draft.kind === "nth" && (
            <>
              <div className="whForm">
                <label className="efLabel">
                  Week of the month
                  <span className="efInput">
                    <select value={draft.nth} onChange={(e) => setDraft({ ...draft, nth: Number(e.target.value) })}>
                      {NTH.map((n, i) => (
                        <option key={n} value={i + 1}>{n}</option>
                      ))}
                    </select>
                  </span>
                </label>
                <label className="efLabel">
                  Weekday
                  <span className="efInput">
                    <select value={draft.weekdays[0] ?? 5} onChange={(e) => setDraft({ ...draft, weekdays: [Number(e.target.value)] })}>
                      {WEEK_ORDER.map((d) => (
                        <option key={d} value={d}>{WEEKDAY_NAMES[d]}</option>
                      ))}
                    </select>
                  </span>
                </label>
                <label className="efLabel">
                  Month
                  <span className="efInput">
                    <select value={draft.months[0] || ""} onChange={(e) => setDraft({ ...draft, months: e.target.value ? [Number(e.target.value)] : [] })}>
                      <option value="">Every month</option>
                      {MONTHS.map((m, i) => (
                        <option key={m} value={i + 1}>{m}</option>
                      ))}
                    </select>
                  </span>
                </label>
                <label className="efLabel">
                  Repeat
                  <span className="efInput">
                    <select value={draft.nthRepeat} onChange={(e) => setDraft({ ...draft, nthRepeat: e.target.value as "yearly" | "once" })}>
                      <option value="yearly">Repeat every year</option>
                      <option value="once">Only once (one year)</option>
                    </select>
                  </span>
                </label>
                {draft.nthRepeat === "once" && (
                  <label className="efLabel">
                    Year
                    <span className="efInput">
                      <input type="number" min="2000" max="2099" value={draft.onceYear} onChange={(e) => setDraft({ ...draft, onceYear: e.target.value })} />
                    </span>
                  </label>
                )}
              </div>
            </>
          )}

          {showWindow && (
            <div className="whForm">
              <label className="efLabel">
                Starting from
                <span className="efInput">
                  <input type="date" value={draft.startDate} onChange={(e) => setDraft({ ...draft, startDate: e.target.value, endDate: draft.endDate < e.target.value ? e.target.value : draft.endDate })} />
                </span>
              </label>
              <label className="efLabel">
                Keeps repeating
                <span className="efInput">
                  <select value={draft.endMode} onChange={(e) => setDraft({ ...draft, endMode: e.target.value as EndMode })}>
                    <option value="month">Until the end of that month</option>
                    <option value="year">Until the end of that year</option>
                    <option value="custom">Until a date…</option>
                    <option value="forever">Forever (all years)</option>
                  </select>
                </span>
              </label>
              {draft.endMode === "custom" && (
                <label className="efLabel">
                  Until
                  <span className="efInput">
                    <input type="date" value={draft.endDate} min={draft.startDate} onChange={(e) => setDraft({ ...draft, endDate: e.target.value })} />
                  </span>
                </label>
              )}
            </div>
          )}

          {recurring && (
            <p className="whNext">
              {preview.length ? (
                <>
                  <b>Next dates:</b> {preview.join(" · ")}
                </>
              ) : (
                <>No matching dates yet — check the day, month and dates.</>
              )}
            </p>
          )}

          <div className="whScope">
            <b>Applies to</b>
            <div className="dcChips">
              <button type="button" className={"dcChip" + (draft.scope === "all" ? " on" : "")} onClick={() => setDraft({ ...draft, scope: "all" })}>
                All employees
              </button>
              <button type="button" className={"dcChip" + (draft.scope === "employees" ? " on" : "")} onClick={() => setDraft({ ...draft, scope: "employees" })}>
                Selected employees
              </button>
            </div>
          </div>

          {draft.scope === "employees" && (
            <div className="dcPick">
              <div className="dcPickBar">
                <span className="efInput">
                  <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Search employees" />
                </span>
                <button type="button" className="secondary small" onClick={() => setDraft({ ...draft, employeeIds: Array.from(new Set([...draft.employeeIds, ...visible.map((p) => String(p.id))])) })}>
                  Select all{find ? " (filtered)" : ""}
                </button>
                <button type="button" className="secondary small" onClick={() => setDraft({ ...draft, employeeIds: [] })}>
                  Clear
                </button>
                <b>{draft.employeeIds.length} selected</b>
              </div>
              <div className="dcPickList">
                {visible.map((p) => (
                  <label key={p.id}>
                    <input type="checkbox" checked={draft.employeeIds.includes(String(p.id))} onChange={() => togglePerson(String(p.id))} />
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
              <input value={draft.note} maxLength={200} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
            </span>
          </label>

          {overlaps.length > 0 && (
            <p className="whWarn">
              Other rules cover some of the same dates: {overlaps.map((o) => `"${o.name}"`).join(", ")}. When several rules match the same day for an employee:
              a rule for selected employees wins over “All employees”; then a specific day (day of month / Nth weekday) wins over a repeating weekday, and a
              repeating weekday wins over a date range; then the most recently created rule.
            </p>
          )}
          <small className="muted">
            Attendance already recorded on matching days is recalculated with the new hours (including points). Employees without a required-hours target stay
            without one. Weekly off days and leaves are not changed.
          </small>

          <div className="dcSave whSave">
            <button type="button" className="primary" disabled={busy} onClick={save}>
              {draft.id ? "Save changes" : "Create rule"}
            </button>
            <button type="button" className="secondary" disabled={busy} onClick={() => setDraft(null)}>
              Cancel
            </button>
          </div>
        </section>
      )}

      <section className="efCard">
        <h3>
          <Users size={18} /> Rules
        </h3>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : !periods.length ? (
          <p className="muted">No rules yet.</p>
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
                      {p.kind !== "range" && <span>{describe(p)}</span>}
                      <span>{windowText(p)}</span>
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
