// Weekly off days per employee, with history so changing them never rewrites past days.
type Sched = { from: string; days: number[] };
const sched = new Map<string, Sched[]>();
const over = new Map<string, string>();

/** JS weekday numbers (Sun=0 … Sat=6) in the order the week is shown: Saturday → Friday. */
export const WEEK_ORDER = [6, 0, 1, 2, 3, 4, 5];
export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type OffRow = { employee_id: string; effective_from: string; days: number[] };
type OverRow = { employee_id: string; day: string; kind: string };

/**
 * Replace the off-day data held in memory.
 * scopeIds: only those employees are replaced (partial data such as a report); omitted = everything.
 * range: when given, only overrides inside [from,to] are replaced for the scoped employees.
 */
export function setOffState(
  rows: OffRow[] | undefined,
  overrides: OverRow[] | undefined,
  scopeIds?: string[],
  range?: { from: string; to: string },
) {
  if (!scopeIds) {
    sched.clear();
    over.clear();
  } else {
    const ids = new Set(scopeIds.map(String));
    ids.forEach((id) => sched.delete(id));
    for (const k of Array.from(over.keys())) {
      const [id, day] = k.split("|");
      if (ids.has(id) && (!range || (day >= range.from && day <= range.to)))
        over.delete(k);
    }
  }
  for (const r of rows || []) {
    const id = String(r.employee_id);
    const list = sched.get(id) || [];
    list.push({ from: String(r.effective_from).slice(0, 10), days: (r.days || []).map(Number) });
    sched.set(id, list);
  }
  sched.forEach((l) => l.sort((a, b) => a.from.localeCompare(b.from)));
  for (const o of overrides || []) over.set(String(o.employee_id) + "|" + String(o.day).slice(0, 10), String(o.kind));
}

/** Weekly off days that apply on a given date (YYYY-MM-DD), ignoring per-day overrides. */
export function offDaysOn(employeeId: string, date: string): number[] {
  const list = sched.get(String(employeeId));
  if (!list) return [];
  let days: number[] = [];
  for (const s of list) if (s.from <= date) days = s.days;
  return days;
}

export function isOffDay(employeeId: string, date: string): boolean {
  const o = over.get(String(employeeId) + "|" + date);
  if (o === "off") return true;
  if (o === "work") return false;
  const wd = new Date(date + "T00:00:00Z").getUTCDay();
  return offDaysOn(employeeId, date).includes(wd);
}
