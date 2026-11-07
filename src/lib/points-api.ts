import { NextRequest, NextResponse } from "next/server";
import { db } from "./db";
import {
  addDays,
  buildLedger,
  normalizeConfig,
  pointAmounts,
  pointRates,
  qatarDay,
  redToBlackAt,
  totalsForRange,
  type LeaveRow,
  type Ledger,
  type OffRow,
  type OverrideRow,
  type PointsConfig,
  type SessionRow,
  type SettlementRow,
} from "./points-engine";

type Sql = ReturnType<typeof db>;
type Ctx = {
  sql: Sql;
  req: NextRequest;
  body: Record<string, any>;
  me: { id: string; role: string };
  isFull: boolean;
  isAll: boolean;
  visiblePages: string[];
  uiVisibility: Record<string, boolean> | null;
};
type Row = Record<string, any>;

const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
const fail = (message: string, status = 400) => json({ error: message }, status);
const validDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + "T12:00:00Z"));
const UUID = /^[0-9a-f-]{36}$/i;
const MAX_LOOKBACK_DAYS = 1100;

async function loadSettings(sql: Sql) {
  const r = await sql`SELECT enabled,start_date::text AS start_date,config FROM points_settings WHERE id=1`;
  const row = r[0] || {};
  return {
    enabled: row.enabled === true,
    startDate: row.start_date ? String(row.start_date).slice(0, 10) : null,
    config: normalizeConfig(row.config),
  };
}

async function loadInputs(sql: Sql, ids: string[], start: string) {
  if (!ids.length)
    return { sessions: [], leaves: [], off: [], over: [], settle: [] } as Record<string, Row[]>;
  const [sessions, leaves, off, over, settle] = await Promise.all([
    sql`SELECT employee_id,check_in,check_out,break_seconds,break_started_at,missed_checkout,expired_absent,required_hours_snapshot FROM attendance_sessions WHERE employee_id=ANY(${ids}::uuid[]) AND check_in >= (${start}::date::timestamp AT TIME ZONE 'Asia/Qatar')`,
    sql`SELECT employee_id,start_date::text AS start_date,end_date::text AS end_date FROM employee_leaves WHERE employee_id=ANY(${ids}::uuid[]) AND end_date>=${start}::date UNION ALL SELECT employee_id,start_date::text AS start_date,end_date::text AS end_date FROM requests WHERE status='approved' AND start_date IS NOT NULL AND end_date IS NOT NULL AND employee_id=ANY(${ids}::uuid[]) AND end_date>=${start}::date`,
    sql`SELECT employee_id,effective_from::text AS effective_from,days FROM employee_off_days WHERE employee_id=ANY(${ids}::uuid[])`,
    sql`SELECT employee_id,day::text AS day,kind FROM employee_day_overrides WHERE employee_id=ANY(${ids}::uuid[]) AND day>=${start}::date`,
    sql`SELECT id,employee_id,kind,count,red_points,note,settled_on::text AS settled_on,created_at FROM points_settlements WHERE employee_id=ANY(${ids}::uuid[]) ORDER BY settled_on,created_at`,
  ]);
  return { sessions, leaves, off, over, settle } as Record<string, Row[]>;
}

function groupBy(rows: Row[]) {
  const m = new Map<string, Row[]>();
  for (const r of rows) {
    const k = String(r.employee_id);
    const l = m.get(k);
    if (l) l.push(r);
    else m.set(k, [r]);
  }
  return m;
}

function ledgerFor(
  person: Row,
  inputs: Record<string, Map<string, Row[]>>,
  cfg: PointsConfig,
  start: string,
  today: string,
): Ledger {
  const id = String(person.id);
  return buildLedger({
    person: person as any,
    sessions: (inputs.sessions.get(id) || []) as unknown as SessionRow[],
    leaves: (inputs.leaves.get(id) || []) as unknown as LeaveRow[],
    off: (inputs.off.get(id) || []) as unknown as OffRow[],
    overrides: (inputs.over.get(id) || []) as unknown as OverrideRow[],
    settlements: (inputs.settle.get(id) || []) as unknown as SettlementRow[],
    config: cfg,
    startDate: start,
    today,
  });
}

const requiredMinOf = (person: Row, cfg: PointsConfig) =>
  (Number(person.required_daily_hours) > 0 ? Number(person.required_daily_hours) : cfg.defaultDailyHours) * 60;

function monthRange(today: string) {
  const [y, m] = today.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${today.slice(0, 7)}-01`, to: `${today.slice(0, 7)}-${String(last).padStart(2, "0")}` };
}

export async function handlePoints(c: Ctx): Promise<NextResponse> {
  const { sql, req, body, me, isFull, isAll } = c;
  const settings = await loadSettings(sql);
  const today = qatarDay(new Date());
  const floor = addDays(today, -MAX_LOOKBACK_DAYS);
  const start = settings.startDate ? (settings.startDate < floor ? floor : settings.startDate) : null;

  // ---------------- writes (administrators only) ----------------
  if (req.method === "POST") {
    if (!isFull) return fail("Only administrators can change points", 403);
    const action = String(body.action || "");

    if (action === "save-config") {
      const enabled = body.enabled === true;
      let startDate: string | null = String(body.startDate || "").slice(0, 10) || null;
      if (startDate && !validDate(startDate)) return fail("Enter a valid start date");
      if (enabled && !startDate) startDate = monthRange(today).from;
      const config = normalizeConfig(body.config);
      await sql`UPDATE points_settings SET enabled=${enabled},start_date=${startDate}::date,config=${JSON.stringify(config)}::jsonb,updated_at=now() WHERE id=1`;
      await sql`INSERT INTO changes(topic) VALUES('points')`;
      return json({ ok: true, enabled, startDate, config });
    }

    if (!start) return fail("Set a start date and enable points first");
    const cfg = settings.config;

    if (action === "delete-settlement") {
      const id = String(body.id || "");
      if (!UUID.test(id)) return fail("Invalid settlement");
      await sql`DELETE FROM points_settlements WHERE id=${id}::uuid`;
      await sql`INSERT INTO changes(topic) VALUES('points')`;
      return json({ ok: true });
    }

    const settleOne = async (person: Row, led: Ledger, kind: "green_black" | "green_red", count: number, note: string) => {
      const T = redToBlackAt(cfg, requiredMinOf(person, cfg));
      const redPoints = kind === "green_red" ? count * T : 0;
      await sql`INSERT INTO points_settlements(employee_id,kind,count,red_points,note,settled_on,created_by) VALUES(${String(person.id)}::uuid,${kind},${count},${redPoints},${note || null},${today}::date,${me.id}::uuid)`;
      led.balance.green -= count;
      if (kind === "green_black") led.balance.black -= count;
      else led.balance.red -= redPoints;
    };

    const prep = async (ids: string[]) => {
      const people = await sql`SELECT id,name,created_at,required_daily_hours FROM employees WHERE id=ANY(${ids}::uuid[]) AND role NOT IN ('admin','display')`;
      const raw = await loadInputs(sql, people.map((p) => String(p.id)), start);
      const inputs = {
        sessions: groupBy(raw.sessions),
        leaves: groupBy(raw.leaves),
        off: groupBy(raw.off),
        over: groupBy(raw.over),
        settle: groupBy(raw.settle),
      };
      return { people, inputs };
    };

    if (action === "settle") {
      const id = String(body.employeeId || "");
      const kind = body.kind === "green_red" ? "green_red" : body.kind === "green_black" ? "green_black" : "";
      const count = Math.floor(Number(body.count));
      if (!UUID.test(id) || !kind || !Number.isFinite(count) || count < 1 || count > 1000)
        return fail("Choose an employee, a settlement type and a valid number of points");
      const { people, inputs } = await prep([id]);
      if (!people.length) return fail("Employee not found", 404);
      const led = ledgerFor(people[0], inputs, cfg, start, today);
      if (count > led.balance.green) return fail(`Only ${led.balance.green} green point(s) available`);
      if (kind === "green_black" && count > led.balance.black)
        return fail(`Only ${led.balance.black} black point(s) to cancel`);
      if (kind === "green_red") {
        const T = redToBlackAt(cfg, requiredMinOf(people[0], cfg));
        if (count * T > led.balance.red)
          return fail(`Each green point cancels ${T} red points; only ${led.balance.red} red point(s) available`);
      }
      await settleOne(people[0], led, kind, count, String(body.note || "").slice(0, 200));
      await sql`INSERT INTO changes(topic) VALUES('points')`;
      return json({ ok: true });
    }

    if (action === "auto-settle") {
      const ids = (Array.isArray(body.employeeIds) ? body.employeeIds : []).map(String).filter((x: string) => UUID.test(x));
      if (!ids.length) return fail("No employees selected");
      if (ids.length > 500) return fail("Too many employees selected");
      const { people, inputs } = await prep(ids);
      let black = 0,
        red = 0,
        touched = 0;
      for (const p of people) {
        const led = ledgerFor(p, inputs, cfg, start, today);
        const T = redToBlackAt(cfg, requiredMinOf(p, cfg));
        const n1 = Math.min(led.balance.green, led.balance.black);
        let did = false;
        if (n1 > 0) {
          await settleOne(p, led, "green_black", n1, "Auto-settlement");
          black += n1;
          did = true;
        }
        const n2 = Math.min(led.balance.green, Math.floor(led.balance.red / T));
        if (n2 > 0) {
          await settleOne(p, led, "green_red", n2, "Auto-settlement");
          red += n2;
          did = true;
        }
        if (did) touched++;
      }
      if (touched) await sql`INSERT INTO changes(topic) VALUES('points')`;
      return json({ ok: true, employees: touched, againstBlack: black, againstRed: red });
    }
    return fail("Invalid action");
  }

  // ---------------- reads ----------------
  if (req.method !== "GET") return fail("Method not allowed", 405);
  const q = req.nextUrl.searchParams;
  const selfMode = q.get("self") === "1" || !isAll;
  if (!isFull) {
    const allowed = isAll
      ? c.visiblePages.includes("points")
      : c.visiblePages.includes("points") || c.uiVisibility?.["dashboard.points"] !== false;
    if (!settings.enabled) return json({ enabled: false });
    if (!allowed) return fail("Points are not available for your role", 403);
  }
  if (!settings.enabled && !selfMode) {
    return json({ enabled: false, startDate: settings.startDate, config: settings.config, rows: [] });
  }
  if (!settings.enabled) return json({ enabled: false });
  if (!start) return json({ enabled: true, startDate: null, config: settings.config, rows: [], balance: { green: 0, red: 0, black: 0 } });
  const cfg = settings.config;

  const def = monthRange(today);
  const from = validDate(String(q.get("from") || "")) ? String(q.get("from")) : def.from;
  const to = validDate(String(q.get("to") || "")) ? String(q.get("to")) : def.to;
  if (from > to) return fail("From date must be before To date");
  if ((Date.parse(to) - Date.parse(from)) / 86400000 > 400) return fail("Date range cannot exceed 400 days");
  const type = ["green", "red", "black"].includes(String(q.get("type"))) ? String(q.get("type")) : "all";
  const filterEvents = (ev: Ledger["events"]) =>
    ev.filter((e) => e.date >= from && e.date <= to && (type === "all" || e.type === type)).sort((a, b) => b.date.localeCompare(a.date));

  const run = async (people: Row[]) => {
    const raw = await loadInputs(sql, people.map((p) => String(p.id)), start);
    const inputs = {
      sessions: groupBy(raw.sessions),
      leaves: groupBy(raw.leaves),
      off: groupBy(raw.off),
      over: groupBy(raw.over),
      settle: groupBy(raw.settle),
    };
    return { inputs, ledgers: people.map((p) => ({ p, led: ledgerFor(p, inputs, cfg, start, today) })), settleRows: raw.settle };
  };

  if (selfMode) {
    const people = await sql`SELECT id,name,created_at,required_daily_hours FROM employees WHERE id=${me.id}::uuid`;
    if (!people.length) return fail("Employee not found", 404);
    const { ledgers, settleRows } = await run(people);
    const { p, led } = ledgers[0];
    const needsEvents = q.get("summary") !== "1";
    const reqMin = requiredMinOf(p, cfg);
    return json({
      enabled: true,
      mode: "self",
      startDate: start,
      from,
      to,
      balance: led.balance,
      redToBlackAt: redToBlackAt(cfg, reqMin),
      greenPerPointMinutes: cfg.greenMode === "fixed" ? cfg.greenFixedHours * 60 : reqMin,
      greenBucketMinutes: Math.round(led.greenBucketMinutes),
      redBucketMinutes: Math.round(led.redBucketMinutes),
      redUnitMinutes: cfg.redUnitMinutes,
      totals: totalsForRange(led.events, from, to),
      events: needsEvents ? filterEvents(led.events) : [],
      settlements: needsEvents ? settleRows.filter((s) => s.settled_on >= from && s.settled_on <= to) : [],
    });
  }

  // Administrator / manager report
  const detail = String(q.get("detail") || "");
  const employeeFilter = String(q.get("employee") || "");
  const branchFilter = String(q.get("branch") || "");
  if ((detail && !UUID.test(detail)) || (employeeFilter && !UUID.test(employeeFilter)) || (branchFilter && !UUID.test(branchFilter)))
    return fail("Invalid filter");
  const target = detail || employeeFilter;
  const people = await sql`SELECT e.id,e.public_id,e.name,e.branch_id,e.created_at,e.required_daily_hours,e.salary,e.basic_salary,b.name AS branch_name FROM employees e LEFT JOIN branches b ON b.id=e.branch_id WHERE e.role NOT IN ('admin','display') AND (e.status='active' OR e.id::text=${target}) AND (${target}='' OR e.id::text=${target}) AND (${branchFilter}='' OR e.branch_id::text=${branchFilter}) ORDER BY e.name LIMIT 500`;
  const { ledgers, settleRows } = await run(people);

  if (detail) {
    const x = ledgers[0];
    if (!x) return fail("Employee not found", 404);
    return json({
      enabled: true,
      detail: true,
      from,
      to,
      balance: x.led.balance,
      redToBlackAt: redToBlackAt(cfg, requiredMinOf(x.p, cfg)),
      events: filterEvents(x.led.events),
      settlements: settleRows.filter((s) => s.employee_id === detail).reverse(),
    });
  }

  const rows = ledgers.map(({ p, led }) => {
    const totals = totalsForRange(led.events, from, to);
    const rates = pointRates(p, cfg);
    const amounts = pointAmounts({ green: totals.netGreen, red: totals.netRed, black: totals.netBlack }, rates);
    return {
      id: p.id,
      public_id: p.public_id,
      name: p.name,
      branch_name: p.branch_name,
      required_daily_hours: p.required_daily_hours,
      totals,
      balance: led.balance,
      redToBlackAt: redToBlackAt(cfg, requiredMinOf(p, cfg)),
      rates,
      amounts,
    };
  });
  return json({ enabled: true, startDate: start, from, to, type, config: cfg, rows });
}
