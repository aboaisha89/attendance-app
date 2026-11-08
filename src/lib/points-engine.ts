/**
 * Employee points engine (pure functions, no database access).
 *
 *  🟢 Green  = overtime reward
 *  🔴 Red    = late arrival / partial early leave (accumulated shortfall)
 *  ⚫ Black  = full-day absence, or red points that reached a workday's worth
 *
 * Points are always *computed* from attendance, leaves and weekly off days, so they
 * stay correct when records are edited. Only admin settlements (muqasa) are stored.
 * The ledger is replayed chronologically because conversions and settlements depend on order.
 */

export type PointsConfig = {
  /** dynamic = one green per employee workday of overtime; fixed = one green per N overtime hours */
  greenMode: "dynamic" | "fixed";
  greenFixedHours: number;
  greenGraceMinutes: number;
  /** minutes of shortfall that make one red point (60 = one hour) */
  redUnitMinutes: number;
  redGraceMinutes: number;
  /** deduct = the grace minutes are never counted; threshold = once exceeded, everything counts */
  graceMode: "deduct" | "threshold";
  /** workday = red points needed for a black point equal the employee's daily hours */
  redToBlackMode: "workday" | "fixed";
  redToBlackFixed: number;
  /** money */
  payBasis: "salary" | "basic";
  daysPerMonth: number;
  defaultDailyHours: number;
  greenValueMode: "day" | "fixed";
  greenFixedAmount: number;
  redValueMode: "hour" | "fixed";
  redFixedAmount: number;
  blackValueMode: "day" | "fixed";
  blackFixedAmount: number;
  currency: string;
};

export const DEFAULT_POINTS_CONFIG: PointsConfig = {
  greenMode: "dynamic",
  greenFixedHours: 4,
  greenGraceMinutes: 0,
  redUnitMinutes: 60,
  redGraceMinutes: 15,
  graceMode: "deduct",
  redToBlackMode: "workday",
  redToBlackFixed: 8,
  payBasis: "salary",
  daysPerMonth: 30,
  defaultDailyHours: 8,
  greenValueMode: "day",
  greenFixedAmount: 0,
  redValueMode: "hour",
  redFixedAmount: 0,
  blackValueMode: "day",
  blackFixedAmount: 0,
  currency: "QAR",
};

const num = (v: unknown, d: number, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
};
const pick = <T extends string>(v: unknown, allowed: readonly T[], d: T): T =>
  allowed.includes(v as T) ? (v as T) : d;

/** Merge stored JSON with defaults and clamp every value to a safe range. */
export function normalizeConfig(raw: unknown): PointsConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const D = DEFAULT_POINTS_CONFIG;
  return {
    greenMode: pick(r.greenMode, ["dynamic", "fixed"] as const, D.greenMode),
    greenFixedHours: num(r.greenFixedHours, D.greenFixedHours, 0.25, 72),
    greenGraceMinutes: num(r.greenGraceMinutes, D.greenGraceMinutes, 0, 240),
    redUnitMinutes: num(r.redUnitMinutes, D.redUnitMinutes, 5, 480),
    redGraceMinutes: num(r.redGraceMinutes, D.redGraceMinutes, 0, 240),
    graceMode: pick(r.graceMode, ["deduct", "threshold"] as const, D.graceMode),
    redToBlackMode: pick(r.redToBlackMode, ["workday", "fixed"] as const, D.redToBlackMode),
    redToBlackFixed: Math.round(num(r.redToBlackFixed, D.redToBlackFixed, 1, 100)),
    payBasis: pick(r.payBasis, ["salary", "basic"] as const, D.payBasis),
    daysPerMonth: num(r.daysPerMonth, D.daysPerMonth, 20, 31),
    defaultDailyHours: num(r.defaultDailyHours, D.defaultDailyHours, 1, 24),
    greenValueMode: pick(r.greenValueMode, ["day", "fixed"] as const, D.greenValueMode),
    greenFixedAmount: num(r.greenFixedAmount, D.greenFixedAmount, 0, 1e7),
    redValueMode: pick(r.redValueMode, ["hour", "fixed"] as const, D.redValueMode),
    redFixedAmount: num(r.redFixedAmount, D.redFixedAmount, 0, 1e7),
    blackValueMode: pick(r.blackValueMode, ["day", "fixed"] as const, D.blackValueMode),
    blackFixedAmount: num(r.blackFixedAmount, D.blackFixedAmount, 0, 1e7),
    currency: String(r.currency ?? D.currency).trim().slice(0, 8) || D.currency,
  };
}

export type SessionRow = {
  employee_id: string;
  check_in: string | Date;
  check_out: string | Date | null;
  break_seconds: number | string | null;
  break_started_at: string | Date | null;
  missed_checkout: boolean | null;
  expired_absent: boolean | null;
  required_hours_snapshot: number | string | null;
};
export type PersonRow = {
  id: string;
  created_at?: string | Date | null;
  required_daily_hours?: number | string | null;
};
export type LeaveRow = { employee_id: string; start_date: string; end_date: string };
export type OffRow = { employee_id: string; effective_from: string; days: number[] };
export type OverrideRow = { employee_id: string; day: string; kind: string };
export type SettlementRow = {
  id: string;
  employee_id: string;
  kind: "green_black" | "green_red";
  count: number;
  red_points: number;
  note?: string | null;
  settled_on: string;
  created_at?: string | Date | null;
};

export type AdjustmentRow = {
  id: string;
  employee_id: string;
  type: "green" | "red" | "black";
  /** positive = added by an administrator, negative = removed */
  points: number;
  reason?: string | null;
  adjusted_on: string;
};

export type PointType = "green" | "red" | "black";
export type PointEvent = {
  date: string;
  type: PointType;
  /** positive = earned, negative = cancelled by a settlement or converted */
  points: number;
  kind: "earn" | "convert" | "settle" | "adjust";
  reason: string;
  /** for conversions: how many red points were turned into this black point */
  redConsumed?: number;
};
export type Ledger = {
  events: PointEvent[];
  balance: { green: number; red: number; black: number };
  /** minutes of overtime / shortfall still accumulating toward the next point */
  greenBucketMinutes: number;
  redBucketMinutes: number;
};

const DAY_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Qatar",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
export const qatarDay = (d: unknown) => DAY_FMT.format(new Date(String(d)));
export const addDays = (day: string, n: number) =>
  new Date(Date.parse(day + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const fmtMin = (m: number) => {
  const r = Math.max(0, Math.round(m));
  return r >= 60 ? `${Math.floor(r / 60)}h ${String(r % 60).padStart(2, "0")}m` : `${r}m`;
};

function sessionNet(rows: SessionRow[]) {
  let net = 0;
  for (const s of rows) {
    const end = s.check_out ? new Date(s.check_out).getTime() : Date.now();
    const gross = Math.max(0, (end - new Date(s.check_in).getTime()) / 60000);
    const brk =
      Number(s.break_seconds || 0) / 60 +
      (s.break_started_at
        ? Math.max(0, (end - new Date(s.break_started_at).getTime()) / 60000)
        : 0);
    net += Math.max(0, gross - brk);
  }
  return net;
}

const counted = (diff: number, grace: number, mode: PointsConfig["graceMode"]) =>
  diff <= grace ? 0 : mode === "deduct" ? diff - grace : diff;

/** Red points that make one black point for an employee working `requiredMin` minutes a day. */
export function redToBlackAt(cfg: PointsConfig, requiredMin: number) {
  return cfg.redToBlackMode === "fixed"
    ? cfg.redToBlackFixed
    : Math.max(1, Math.round(requiredMin / 60));
}

export function buildLedger(p: {
  person: PersonRow;
  sessions: SessionRow[];
  leaves: LeaveRow[];
  off: OffRow[];
  overrides: OverrideRow[];
  settlements: SettlementRow[];
  adjustments?: AdjustmentRow[];
  config: PointsConfig;
  startDate: string;
  today: string;
}): Ledger {
  const { person, config: cfg, today } = p;
  const start = p.startDate;
  const events: PointEvent[] = [];
  const bal = { green: 0, red: 0, black: 0 };
  let greenBucket = 0;
  let redBucket = 0;
  if (!start || start > today) {
    return { events, balance: bal, greenBucketMinutes: 0, redBucketMinutes: 0 };
  }

  const byDay = new Map<string, SessionRow[]>();
  for (const s of p.sessions) {
    const k = qatarDay(s.check_in);
    const list = byDay.get(k);
    if (list) list.push(s);
    else byDay.set(k, [s]);
  }
  const offSorted = [...p.off].sort((a, b) => a.effective_from.localeCompare(b.effective_from));
  const overMap = new Map(p.overrides.map((o) => [String(o.day).slice(0, 10), o.kind]));
  const isOff = (day: string) => {
    const o = overMap.get(day);
    if (o === "off") return true;
    if (o === "work") return false;
    let days: number[] = [];
    for (const r of offSorted) if (r.effective_from <= day) days = (r.days || []).map(Number);
    return days.includes(new Date(day + "T00:00:00Z").getUTCDay());
  };
  const onLeave = (day: string) =>
    p.leaves.some(
      (l) => day >= String(l.start_date).slice(0, 10) && day <= String(l.end_date).slice(0, 10),
    );
  const createdDay = person.created_at ? qatarDay(person.created_at) : null;
  const reqDaily = Number(person.required_daily_hours);

  const settleByDay = new Map<string, SettlementRow[]>();
  for (const s of p.settlements) {
    const d = s.settled_on < start ? start : s.settled_on > today ? today : s.settled_on;
    const list = settleByDay.get(d);
    if (list) list.push(s);
    else settleByDay.set(d, [s]);
  }

  const adjustByDay = new Map<string, AdjustmentRow[]>();
  for (const a of p.adjustments || []) {
    const d = a.adjusted_on < start ? start : a.adjusted_on > today ? today : a.adjusted_on;
    const list = adjustByDay.get(d);
    if (list) list.push(a);
    else adjustByDay.set(d, [a]);
  }

  const convert = (day: string, requiredMin: number) => {
    const t = redToBlackAt(cfg, requiredMin);
    while (bal.red >= t) {
      bal.red -= t;
      bal.black += 1;
      events.push({
        date: day,
        type: "black",
        points: 1,
        kind: "convert",
        redConsumed: t,
        reason: `${t} red points reached a full workday and became 1 black point`,
      });
    }
  };

  for (let day = start; day <= today; day = addDays(day, 1)) {
    const all = byDay.get(day) || [];
    // A session left without check-out (or past its maximum) is void on its own.
    const ss = all.filter((s) => !s.expired_absent && !s.missed_checkout);
    const skip = onLeave(day) || (!all.length && isOff(day));
    if (!skip) {
      if (!ss.length) {
        const started = !createdDay || day >= createdDay;
        const absent = all.length > 0 || (started && reqDaily > 0);
        if (absent && day < today) {
          bal.black += 1;
          events.push({
            date: day,
            type: "black",
            points: 1,
            kind: "earn",
            reason: all.length
              ? "Full-day absence (session without check-out)"
              : "Full-day absence",
          });
        }
      } else if (ss.every((s) => !!s.check_out)) {
        const snap = ss[0].required_hours_snapshot;
        const requiredMin =
          (snap != null && Number(snap) > 0 ? Number(snap) : reqDaily > 0 ? reqDaily : 0) * 60;
        if (requiredMin > 0) {
          const net = sessionNet(ss);
          // 🔴 shortfall
          const short = counted(requiredMin - net, cfg.redGraceMinutes, cfg.graceMode);
          if (short > 0) {
            redBucket += short;
            const n = Math.floor(redBucket / cfg.redUnitMinutes);
            if (n > 0) {
              redBucket -= n * cfg.redUnitMinutes;
              bal.red += n;
              events.push({
                date: day,
                type: "red",
                points: n,
                kind: "earn",
                reason: `Late / early leave: ${fmtMin(short)} short today (accumulated)`,
              });
              convert(day, requiredMin);
            }
          }
          // 🟢 overtime
          const over = counted(net - requiredMin, cfg.greenGraceMinutes, cfg.graceMode);
          if (over > 0) {
            greenBucket += over;
            const threshold =
              cfg.greenMode === "fixed" ? cfg.greenFixedHours * 60 : requiredMin;
            const n = Math.floor(greenBucket / threshold);
            if (n > 0) {
              greenBucket -= n * threshold;
              bal.green += n;
              events.push({
                date: day,
                type: "green",
                points: n,
                kind: "earn",
                reason: `Overtime: ${fmtMin(over)} today (accumulated)`,
              });
            }
          }
        }
      }
    }
    // Manual rewards / penalties from an administrator.
    for (const a of adjustByDay.get(day) || []) {
      const t = a.type;
      const note = a.reason ? `: ${a.reason}` : "";
      if (a.points > 0) {
        bal[t] += a.points;
        events.push({
          date: day,
          type: t,
          points: a.points,
          kind: "adjust",
          reason: `Added by administrator${note}`,
        });
        if (t === "red") convert(day, (reqDaily > 0 ? reqDaily : cfg.defaultDailyHours) * 60);
      } else {
        const k = Math.min(-a.points, bal[t]);
        if (k > 0) {
          bal[t] -= k;
          events.push({
            date: day,
            type: t,
            points: -k,
            kind: "adjust",
            reason: `Removed by administrator${note}`,
          });
        }
      }
    }
    // Settlements dated this day are applied after the day's earnings.
    for (const s of settleByDay.get(day) || []) {
      const g = Math.min(s.count, bal.green);
      if (g <= 0) continue;
      if (s.kind === "green_black") {
        const b = Math.min(g, bal.black);
        if (b <= 0) continue;
        bal.green -= b;
        bal.black -= b;
        events.push(
          { date: day, type: "green", points: -b, kind: "settle", reason: "Settled against black point" },
          { date: day, type: "black", points: -b, kind: "settle", reason: "Cancelled by green point" },
        );
      } else {
        const r = Math.min(s.red_points, bal.red);
        if (r <= 0) continue;
        bal.green -= g;
        bal.red -= r;
        events.push(
          { date: day, type: "green", points: -g, kind: "settle", reason: "Settled against red points" },
          { date: day, type: "red", points: -r, kind: "settle", reason: "Cancelled by green point" },
        );
      }
    }
  }
  return { events, balance: bal, greenBucketMinutes: greenBucket, redBucketMinutes: redBucket };
}

export type RangeTotals = {
  greenEarned: number;
  redEarned: number;
  blackAbsent: number;
  blackConverted: number;
  redConverted: number;
  greenSettled: number;
  redCancelled: number;
  blackCancelled: number;
  greenManual: number;
  redManual: number;
  blackManual: number;
  netGreen: number;
  netRed: number;
  netBlack: number;
};

/** Sum the events that fall inside [from, to]. */
export function totalsForRange(events: PointEvent[], from: string, to: string): RangeTotals {
  const t: RangeTotals = {
    greenEarned: 0,
    redEarned: 0,
    blackAbsent: 0,
    blackConverted: 0,
    redConverted: 0,
    greenSettled: 0,
    redCancelled: 0,
    blackCancelled: 0,
    greenManual: 0,
    redManual: 0,
    blackManual: 0,
    netGreen: 0,
    netRed: 0,
    netBlack: 0,
  };
  for (const e of events) {
    if (e.date < from || e.date > to) continue;
    if (e.kind === "earn") {
      if (e.type === "green") t.greenEarned += e.points;
      else if (e.type === "red") t.redEarned += e.points;
      else t.blackAbsent += e.points;
    } else if (e.kind === "adjust") {
      if (e.type === "green") t.greenManual += e.points;
      else if (e.type === "red") t.redManual += e.points;
      else t.blackManual += e.points;
    } else if (e.kind === "convert") {
      t.blackConverted += e.points;
      t.redConverted += e.redConsumed || 0;
    } else {
      if (e.type === "green") t.greenSettled += -e.points;
      else if (e.type === "red") t.redCancelled += -e.points;
      else t.blackCancelled += -e.points;
    }
  }
  t.netGreen = t.greenEarned - t.greenSettled + t.greenManual;
  t.netRed = t.redEarned - t.redConverted - t.redCancelled + t.redManual;
  t.netBlack = t.blackAbsent + t.blackConverted - t.blackCancelled + t.blackManual;
  return t;
}

export type Rates = {
  base: number | null;
  day: number | null;
  hour: number | null;
  green: number | null;
  red: number | null;
  black: number | null;
};

/** Money value of one point of each colour for one employee. */
export function pointRates(
  emp: { salary?: unknown; basic_salary?: unknown; required_daily_hours?: unknown },
  cfg: PointsConfig,
): Rates {
  const raw = cfg.payBasis === "basic" ? emp.basic_salary : emp.salary;
  const base = raw == null || raw === "" || !Number.isFinite(Number(raw)) ? null : Number(raw);
  const day = base === null ? null : base / cfg.daysPerMonth;
  const hours = Number(emp.required_daily_hours) > 0 ? Number(emp.required_daily_hours) : cfg.defaultDailyHours;
  const hour = day === null ? null : day / hours;
  return {
    base,
    day,
    hour,
    green: cfg.greenValueMode === "fixed" ? cfg.greenFixedAmount : day,
    red: cfg.redValueMode === "fixed" ? cfg.redFixedAmount : hour,
    black: cfg.blackValueMode === "fixed" ? cfg.blackFixedAmount : day,
  };
}

export function pointAmounts(
  net: { green: number; red: number; black: number },
  r: Rates,
) {
  const bonus = r.green === null ? null : net.green * r.green;
  const redCost = r.red === null ? null : net.red * r.red;
  const blackCost = r.black === null ? null : net.black * r.black;
  const deduction = redCost === null || blackCost === null ? null : redCost + blackCost;
  return {
    bonus,
    deduction,
    net: bonus === null || deduction === null ? null : bonus - deduction,
  };
}
