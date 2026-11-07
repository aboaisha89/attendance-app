"use client";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Toaster, toast } from "sonner";
import dynamic from "next/dynamic";
import EmployeeForm from "./EmployeeForm";
import PointsPage, { PointsCards } from "./PointsPage";
import TableTools from "./TableTools";
import DayControl from "./DayControl";
import {
  PUNCH_ALERTS,
  PunchAlertCard,
  PunchGeoError,
  type PunchAlertInfo,
  classifyPunchError,
  getPunchPosition,
  punchToast,
  usePunchEnvironmentAlert,
} from "./punchAlerts";
import Announcements, { KindIcon } from "./Announcements";
import { kindMeta } from "../lib/announcement-kinds";
import { setOffState, isOffDay, offDaysOn } from "../lib/offdays";
import {
  Home,
  Clock3,
  Fingerprint,
  BarChart3,
  UserRound,
  Bell,
  Menu,
  ArrowLeft,
  Filter,
  MapPin,
  LogOut,
  Users,
  Building2,
  Map as MapIcon,
  Settings,
  ClipboardList,
  Plus,
  Pencil,
  Trash2,
  Check,
  CalendarDays,
  Coffee,
  CalendarCheck,
  DoorOpen,
  ShieldCheck,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Power,
  PowerOff,
  Camera,
  X,
  LoaderCircle,
  Copy,
  Eye,
  EyeOff,
  Award,
} from "lucide-react";
const MapEditor = dynamic(() => import("./MapEditor"), { ssr: false });
type Row = Record<string, any>;
// Sidebar sections (single source of truth for both the menu and "which section is open").
const SIDE_GROUP_DEFS = [
  {
    id: "locations",
    label: "Employees",
    icon: Users,
    ids: [
      "employees",
      "shifts",
      "day-control",
      "requests",
      "admin-messages",
      "devices",
      "failed-attempts",
    ],
  },
  {
    id: "reports",
    label: "Reports",
    icon: BarChart3,
    ids: [
      "reports",
      "overtime-report",
      "hours-report",
      "points",
      "history",
      "activity-log",
    ],
  },
  {
    id: "configuration",
    label: "Settings",
    icon: Settings,
    ids: [
      "settings",
      "permissions",
      "branches",
      "geofences",
      "request-categories",
    ],
  },
];
const SIDE_GROUP_OF: Record<string, string> = Object.fromEntries(
  SIDE_GROUP_DEFS.flatMap((g) => g.ids.map((id) => [id, g.id])),
);
type Snapshot = {
  staff: Row[];
  sessions: Row[];
  kitchen?: Row[];
  fences: Row[];
  branches: Row[];
  requests: Row[];
  settings?: Row | null;
  version: number;
  deviceAlerts?: number;
  employeeStats?: { total: number; active: number; pending: number };
};
const empty: Snapshot = {
  staff: [],
  sessions: [],
  fences: [],
  branches: [],
  requests: [],
  version: 0,
};
const zone = "Asia/Qatar";
let sessionEndedAt = 0;
function getLoginLocation(): Promise<Row> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      return resolve({
        locationStatus: "unsupported",
        locationMessage:
          "Location services are not supported by this browser. Please use another browser.",
      });
    }

    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolve({
          lat: p.coords.latitude,
          lon: p.coords.longitude,
          accuracy: p.coords.accuracy,
          locationStatus: "ok",
          locationMessage: "",
        }),

      (e) => {
        let message =
          "Unable to determine your location. Please check your GPS and try again.";

        switch (e.code) {
          case 1:
            message =
              "Location permission denied. Please allow location access in your browser settings.";
            break;

          case 2:
            message =
              "Your location is unavailable. Please enable GPS or Location Services.";
            break;

          case 3:
            message =
              "Location request timed out. Please try again.";
            break;
        }

        resolve({
          locationStatus: "error",
          locationMessage: message,
        });
      },

      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      },
    );
  });
}
let deviceInfoHeader: string | null = null;
async function getDeviceHeader() {
  if (deviceInfoHeader !== null) return deviceInfoHeader;
  try {
    const nav = navigator as Navigator & {
      userAgentData?: {
        mobile?: boolean;
        platform?: string;
        getHighEntropyValues?: (h: string[]) => Promise<Record<string, string>>;
      };
      deviceMemory?: number;
    };
    let hi: Record<string, string> = {};
    try {
      hi =
        (await nav.userAgentData?.getHighEntropyValues?.([
          "model",
          "platform",
          "platformVersion",
        ])) || {};
    } catch {
      hi = {};
    }
    deviceInfoHeader = encodeURIComponent(
      JSON.stringify({
        model: hi.model || "",
        platform: hi.platform || nav.userAgentData?.platform || "",
        platformVersion: hi.platformVersion || "",
        mobile: nav.userAgentData?.mobile ?? null,
        screen: screen.width + "x" + screen.height,
        touch: nav.maxTouchPoints || 0,
        lang: nav.language || "",
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
        cores: nav.hardwareConcurrency || 0,
        mem: nav.deviceMemory || 0,
      }),
    );
  } catch {
    deviceInfoHeader = "";
  }
  return deviceInfoHeader;
}
// A second, browser-side identity so the same phone is still recognised if the device cookie is lost.
function getDeviceId() {
  try {
    let id = localStorage.getItem("attendance_device_id") || "";
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      id = crypto.randomUUID();
      localStorage.setItem("attendance_device_id", id);
    }
    return id;
  } catch {
    return "";
  }
}
async function api(path: string, payload?: Row) {
  const dh = await getDeviceHeader();
  const did = getDeviceId();
  const response = await fetch("/api/" + path, {
    method: payload ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      ...(dh ? { "X-Device-Info": dh } : {}),
      ...(did ? { "X-Device-Id": did } : {}),
    },
    body: payload ? JSON.stringify(payload) : undefined,
    cache: "no-store",
  });
  const result = await response.json();
  if (!response.ok) {
    if (
      response.status === 401 &&
      !["login", "register", "logout", "me"].includes(path) &&
      Date.now() - sessionEndedAt > 3000
    ) {
      sessionEndedAt = Date.now();
      window.dispatchEvent(
        new CustomEvent("session-ended", {
          detail: result.error || "Your session ended.",
        }),
      );
    }
    const apiError = Error(result.error || "Server request failed") as Error & {
      code?: string;
      meta?: Row;
      status?: number;
    };
    apiError.code = result.code;
    apiError.meta = result;
    apiError.status = response.status;
    throw apiError;
  }
  return result;
}
async function uploadAvatar(file: File) {
  const form = new FormData();
  form.append("file", file);
  const r = await fetch("/api/avatar-upload", { method: "POST", body: form });
  const data = await r.json();
  if (!r.ok) throw Error(data.error || "Image upload failed");
  return data;
}
// Intl formatters are expensive to create, so they are built once.
const STAMP_FMT = {
  "12": new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }),
  "24": new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }),
};
const stamp = (date: unknown, mode = "12") =>
  date
    ? STAMP_FMT[mode === "12" ? "12" : "24"].format(new Date(String(date)))
    : "--:--";
const SHORT_DATE_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: zone,
  day: "2-digit",
  month: "short",
  year: "numeric",
});
const shortDate = (date: unknown) =>
  SHORT_DATE_FMT.format(new Date(String(date)));
const DAY_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: zone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const dayKey = (date: unknown) => DAY_FMT.format(new Date(String(date)));
// Hours display: "auto" keeps the original mix (reports 9.7, clocks 09:42); "decimal" = 9.7; "hhmm" = 9:42.
let HOURS_FORMAT: "auto" | "decimal" | "hhmm" = "auto";
const setHoursFormat = (v: unknown) => {
  HOURS_FORMAT = v === "decimal" || v === "hhmm" ? v : "auto";
};
const fmtH = (
  minutes: number,
  style: "report" | "clock" = "report",
  unit = false,
) => {
  const m = Math.max(0, Math.round(minutes));
  const f =
    HOURS_FORMAT === "auto"
      ? style === "clock"
        ? "clock"
        : "decimal"
      : HOURS_FORMAT;
  if (f === "decimal") return (m / 60).toFixed(1) + (unit ? "h" : "");
  const h = Math.floor(m / 60);
  return (
    (f === "clock" ? String(h).padStart(2, "0") : String(h)) +
    ":" +
    String(m % 60).padStart(2, "0")
  );
};
const csvH = (minutes: number) =>
  HOURS_FORMAT === "hhmm" ? fmtH(minutes) : (minutes / 60).toFixed(2);
const duration = (a: unknown, b: unknown) => {
  if (!a) return HOURS_FORMAT === "auto" ? "00:00" : fmtH(0, "clock");
  const n = Math.max(
    0,
    Math.floor(
      (new Date(String(b || Date.now())).getTime() -
        new Date(String(a)).getTime()) /
        60000,
    ),
  );
  if (HOURS_FORMAT !== "auto") return fmtH(n, "clock");
  return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
};
function sessionNetMinutes(s: Row, now: Date | null) {
  if (s.missed_checkout) return 0;
  const end = s.check_out ? new Date(s.check_out) : now || new Date();
  const gross = Math.max(
    0,
    (end.getTime() - new Date(s.check_in).getTime()) / 60000,
  );
  const seconds =
    Number(s.break_seconds || 0) +
    (s.break_started_at
      ? Math.max(
          0,
          (end.getTime() - new Date(s.break_started_at).getTime()) / 1000,
        )
      : 0);
  return Math.max(0, gross - seconds / 60);
}
const graceMinutes = (
  settings: Row | undefined,
  key: "early_grace_minutes" | "overtime_grace_minutes",
) => Math.max(0, Math.min(240, Number(settings?.[key] || 0) || 0));
const attendanceVariance = (
  net: number,
  required: number,
  settings: Row | undefined,
) => {
  const earlyGrace = graceMinutes(settings, "early_grace_minutes");

  const overtimeGrace = graceMinutes(settings, "overtime_grace_minutes");

  const early = required - net > earlyGrace ? Math.max(0, required - net) : 0;

  // Grace period is only a threshold, not a deduction.
  // Once exceeded, count all overtime minutes.
  const overtime =
    net > required + overtimeGrace ? Math.max(0, net - required) : 0;

  return {
    early,
    overtime,
  };
};
const minsLabel = (n: number) =>
  HOURS_FORMAT === "auto"
    ? `${Math.floor(n / 60)}h ${String(Math.floor(n % 60)).padStart(2, "0")}m`
    : fmtH(n, "report", true);
const EMPLOYEE_VISIBILITY: {
  group: string;
  items: { key: string; label: string }[];
}[] = [
  {
    group: "Dashboard Cards",
    items: [
      { key: "dashboard.status", label: "Today Status card" },
      { key: "dashboard.status.checkIn", label: "Today Status: Check In" },
      { key: "dashboard.status.checkOut", label: "Today Status: Check Out" },
      { key: "dashboard.status.netHours", label: "Today Status: Net Hours" },
      { key: "dashboard.metrics", label: "Quick Statistics cards" },
      { key: "dashboard.metrics.punchIn", label: "Punch In card" },
      { key: "dashboard.metrics.punchOut", label: "Punch Out card" },
      { key: "dashboard.metrics.break", label: "Break card" },
      { key: "dashboard.metrics.hours", label: "Total Hours card" },
      { key: "dashboard.overview", label: "Attendance Overview card" },
      { key: "dashboard.summary", label: "Monthly Summary card" },
      { key: "dashboard.activities", label: "Recent Activities card" },
      { key: "dashboard.points", label: "Points cards (green / red / black)" },
      {
        key: "dashboard.kitchen",
        label: "Employees Currently in Kitchen card",
      },
      { key: "dashboard.kitchen.title", label: "Kitchen card title" },
      { key: "dashboard.kitchen.count", label: "Currently Checked In count" },
      { key: "dashboard.kitchen.photo", label: "Employee photo" },
      { key: "dashboard.kitchen.name", label: "Employee name" },
      { key: "dashboard.kitchen.branch", label: "Employee branch" },
      { key: "dashboard.kitchen.status", label: "Employee attendance status" },
      { key: "dashboard.kitchen.checkInLabel", label: "Check-in label" },
      { key: "dashboard.kitchen.checkInTime", label: "Check-in time" },
      { key: "dashboard.kitchen.emptyMessage", label: "Empty-state message" },
    ],
  },
  {
    group: "Profile — what the employee can edit",
    items: [
      { key: "profile.editPhoto", label: "Change / remove own profile photo" },
      { key: "profile.changePassword", label: "Change own password" },
      { key: "profile.editName", label: "Edit own name (off by default)" },
      { key: "profile.editEmail", label: "Edit own email (off by default)" },
    ],
  },
  {
    group: "Header",
    items: [
      { key: "header.menu", label: "Menu button (open / collapse sidebar)" },
      { key: "header.title", label: "Page title and subtitle" },
      { key: "header.requests", label: "Requests shortcut button" },
      { key: "header.notifications", label: "Notifications bell" },
      { key: "header.profile", label: "Profile photo and name menu" },
    ],
  },
  {
    group: "Punch Page",
    items: [{ key: "punch.break", label: "Start / End Break button" }],
  },
  {
    group: "Attendance History",
    items: [
      { key: "history.calendar", label: "Calendar card" },
      { key: "history.legend", label: "Calendar legend (status colours)" },
      { key: "history.summary", label: "Month Summary card" },
      { key: "history.events", label: "Attendance History card" },
      { key: "history.date", label: "Day and date heading" },
      { key: "history.total", label: "Daily total hours" },
      { key: "history.eventDate", label: "Date on each event" },
      { key: "history.eventTime", label: "Time on each event" },
      { key: "history.checkIn", label: "Check In events" },
      { key: "history.checkOut", label: "Check Out events" },
      { key: "history.breakIn", label: "Break In events" },
      { key: "history.breakOut", label: "Break Out events" },
    ],
  },
  {
    group: "Employee Reports",
    items: [
      { key: "reports.daily", label: "Daily attendance cards" },
      { key: "reports.date", label: "Day date" },
      { key: "reports.checkIn", label: "First Check In" },
      { key: "reports.checkOut", label: "Last Check Out" },
      { key: "reports.sessions", label: "Number of sessions" },
      { key: "reports.break", label: "Total break" },
      { key: "reports.net", label: "Net hours" },
      { key: "reports.status", label: "Completion label" },
    ],
  },
];
type Visibility = Record<string, boolean>;
// Profile edits that are OFF unless the role explicitly allows them.
const DEFAULT_OFF = new Set(["profile.editName", "profile.editEmail"]);
const isVisible = (visibility: Visibility | undefined, key: string) =>
  DEFAULT_OFF.has(key)
    ? visibility?.[key] === true
    : visibility?.[key] !== false;
function VisibilitySettings({
  visibility,
  onChange,
}: {
  visibility: Visibility;
  onChange: (key: string, enabled: boolean) => void;
}) {
  return (
    <div className="visibilitySettings">
      {EMPLOYEE_VISIBILITY.map((group) => (
        <div className="visibilityGroup" key={group.group}>
          <h4>{group.group}</h4>
          <div className="visibilityOptions">
            {group.items.map((item) => (
              <label key={item.key}>
                <input
                  type="checkbox"
                  checked={isVisible(visibility, item.key)}
                  onChange={(e) => onChange(item.key, e.target.checked)}
                />
                <span>{item.label}</span>
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="uiCard">
      <header className="sectionHead">
        <h3>{title}</h3>
        {action}
      </header>
      {children}
    </section>
  );
}
function IconButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button type="button" className="iconButton" onClick={onClick}>
      {children}
    </button>
  );
}
function DataTable({
  rows,
  cols,
  actions,
}: {
  rows: Row[];
  cols: string[];
  actions?: (row: Row) => React.ReactNode;
}) {
  const formatCell = (row: Row, column: string) => {
    const value = row[column];
    if (value == null) return "—";
    if (column.includes("check_") || column === "created_at") {
      return `${shortDate(value)} ${stamp(value)}`;
    }
    return String(value);
  };

  return (
    <TableTools>
      <div className="dataScroll">
        <table>
          <thead>
            <tr>
              {cols.map((column) => (
                <th key={column}>{column.replaceAll("_", " ")}</th>
              ))}
              {actions && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.id ?? index}>
                {cols.map((column) => (
                  <td key={column}>{formatCell(row, column)}</td>
                ))}
                {actions && (
                  <td>
                    <div className="rowActions">{actions(row)}</div>
                  </td>
                )}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={cols.length + (actions ? 1 : 0)}>
                  No records found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </TableTools>
  );
}
const PRESENT_CODES = ["P", "EL", "OT", "IN"];
const MonthlyAttendanceReport = memo(MonthlyAttendanceReportInner);
function MonthlyAttendanceReportInner({
  isAdmin,
  staff,
  branches,
  mode = "attendance",
}: {
  isAdmin: boolean;
  staff: Row[];
  branches: Row[];
  mode?: "attendance" | "overtime" | "summary";
}) {
  const initialMonth = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Qatar",
    year: "numeric",
    month: "2-digit",
  }).format(new Date());
  const [month, setMonth] = useState(initialMonth);
  const [fromDate, setFromDate] = useState(initialMonth + "-01");
  const [toDate, setToDate] = useState(() => {
    const [y, m] = initialMonth.split("-").map(Number);
    return `${initialMonth}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
  });
  const [periodMode, setPeriodMode] = useState<"month" | "range">("month");
  const [employee, setEmployee] = useState("");
  const [branch, setBranch] = useState("");
  const [report, setReport] = useState<{
    people: Row[];
    events: Row[];
    history: Row[];
    leaves?: Row[];
    settings?: Row;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let live = true;
    setLoading(true);
    const q = new URLSearchParams({
      from: periodMode === "month" ? month + "-01" : fromDate,
      to:
        periodMode === "month"
          ? (() => {
              const [y, m] = month.split("-").map(Number);
              return `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
            })()
          : toDate,
      employee,
      branch,
    });
    fetch("/api/calendar-report?" + q, { cache: "no-store" })
      .then(async (res) => {
        const j = await res.json();
        if (!res.ok) throw Error(j.error || "Report failed");
        if (live) {
          setOffState(
            j.offDays,
            j.dayOverrides,
            (j.people || []).map((p: Row) => String(p.id)),
            { from: String(j.from), to: String(j.to) },
          );
          setReport(j);
        }
      })
      .catch((e) => {
        if (live) {
          setReport(null);
          toast.error(String(e.message || e));
        }
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [month, fromDate, toDate, periodMode, employee, branch]);
  const dates = (() => {
    const a = new Date(
        (periodMode === "month" ? month + "-01" : fromDate) + "T12:00:00+03:00",
      ),
      b = new Date(
        (periodMode === "month"
          ? (() => {
              const [y, m] = month.split("-").map(Number);
              return `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
            })()
          : toDate) + "T12:00:00+03:00",
      );
    if (
      !Number.isFinite(a.getTime()) ||
      !Number.isFinite(b.getTime()) ||
      b.getTime() < a.getTime()
    )
      return [];
    const count = Math.min(
      366,
      Math.floor((b.getTime() - a.getTime()) / 86400000) + 1,
    );
    return Array.from({ length: count }, (_, i) => {
      const d = new Date(a.getTime() + i * 86400000);
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Qatar",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(d);
    });
  })();
  function key(v: unknown) {
    return dayKey(v);
  }
  // Index sessions by employee and day once per report instead of filtering them for every cell.
  const evIndex = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const s of report?.events || []) {
      const k = String(s.employee_id) + "|" + dayKey(s.check_in);
      const list = m.get(k);
      if (list) list.push(s);
      else m.set(k, [s]);
    }
    return m;
  }, [report]);
  const recCache = useMemo(
    () => new Map<string, ReturnType<typeof dayRecord>>(),
    [report, isAdmin],
  );
  function dayRec(person: Row, date: string) {
    const k = String(person.id) + "|" + date;
    let v = recCache.get(k);
    if (!v) {
      v = dayRecord(person, date);
      recCache.set(k, v);
    }
    return v;
  }
  function dayRecord(person: Row, date: string) {
    const absentSessions = (
      evIndex.get(String(person.id) + "|" + date) || []
    ).filter((s) => !!s.expired_absent || !!s.missed_checkout).length;
    return { ...dayRecordCore(person, date), absentSessions };
  }
  function dayRecordCore(person: Row, date: string) {
    const allSs = evIndex.get(String(person.id) + "|" + date) || [];
    // A session left without check-out (or past its maximum duration) is void on its own;
    // the other sessions of the same day are still counted normally.
    const ss = allSs.filter((s) => !s.expired_absent && !s.missed_checkout);
    const onLeave = (report?.leaves || []).some(
      (l) =>
        String(l.employee_id) === String(person.id) &&
        date >= String(l.start_date).slice(0, 10) &&
        date <= String(l.end_date).slice(0, 10),
    );
    if (onLeave)
      return {
        code: "L",
        net: 0,
        breakMin: 0,
        over: 0,
        early: 0,
        required: null as number | null,
      };
    if (
      !allSs.length &&
      (isAdmin || date < key(new Date())) &&
      isOffDay(String(person.id), date)
    )
      return {
        code: "O",
        net: 0,
        breakMin: 0,
        over: 0,
        early: 0,
        required: null as number | null,
      };
    if (!ss.length) {
      const todayKey = key(new Date());
      const started = !person.created_at || date >= key(person.created_at);
      const absent =
        allSs.length > 0 ||
        (date < todayKey &&
          started &&
          person.required_daily_hours != null &&
          Number(person.required_daily_hours) > 0);
      return {
        code: absent ? "A" : "—",
        net: 0,
        breakMin: 0,
        over: 0,
        early: 0,
        required: null as number | null,
      };
    }
    const completed = ss.every((s) => !!s.check_out && !s.missed_checkout);
    let net = 0,
      breakMin = 0;
    for (const s of ss) {
      const end = s.check_out ? new Date(s.check_out).getTime() : Date.now();
      const gross = Math.max(0, (end - new Date(s.check_in).getTime()) / 60000);
      const b =
        Number(s.break_seconds || 0) / 60 +
        (s.break_started_at
          ? Math.max(0, (end - new Date(s.break_started_at).getTime()) / 60000)
          : 0);
      breakMin += b;
      net += Math.max(0, gross - b);
    }
    // Daily expected duration is preserved from the first session of the day.
    // Never rewrite historical records when an employee's shift changes.
    const saved = ss[0].required_hours_snapshot;
    const required = saved == null ? null : Number(saved) * 60;
    const variance =
      required !== null
        ? attendanceVariance(net, required, report?.settings)
        : { early: 0, overtime: 0 };
    const over = completed ? variance.overtime : 0;
    const early = completed ? variance.early : 0;
    return {
      code: ss.some((s) => s.missed_checkout)
        ? "A"
        : !completed
          ? "IN"
          : required !== null && early > 0
            ? "EL"
            : required !== null && over > 0
              ? "OT"
              : "P",
      net,
      breakMin,
      over,
      early,
      required,
    };
  }
  const csvCell = (v: unknown) =>
    '"' + String(v ?? "").replaceAll('"', '""') + '"';
  const wdShort = (date: string) =>
    new Date(date + "T00:00:00Z").toLocaleDateString("en-GB", {
      weekday: "short",
      timeZone: "UTC",
    });
  const multiMonth =
    dates.length > 0 &&
    dates[0].slice(0, 7) !== dates[dates.length - 1].slice(0, 7);
  const dayText = (date: string) =>
    multiMonth ? date.slice(8) + "/" + date.slice(5, 7) : date.slice(-2);
  const summaryRows = (report?.people || []).map((p) => {
    const rows = dates.map((dt) => dayRec(p, dt));
    const present = rows.filter((x) => PRESENT_CODES.includes(x.code));
    return {
      p,
      worked: present.length,
      net: rows.reduce((a, x) => a + x.net, 0),
      required: present.reduce((a, x) => a + (x.required ?? 0), 0),
      breakMin: rows.reduce((a, x) => a + x.breakMin, 0),
      over: rows.reduce((a, x) => a + x.over, 0),
      early: rows.reduce((a, x) => a + x.early, 0),
      absent: rows.filter((x) => x.code === "A").length,
      leave: rows.filter((x) => x.code === "L").length,
      off: rows.filter((x) => x.code === "O").length,
      absSessions: rows.reduce((a, x) => a + x.absentSessions, 0),
    };
  });
  const hrs = (m: number) => fmtH(m);
  const isOffDayAny = (dt: string) =>
    !!report?.people?.length &&
    report.people.every((p) => isOffDay(String(p.id), dt));
  const saveCSV = (cols: unknown[], data: unknown[][], name: string) => {
    const content =
      "\uFEFF" +
      [cols, ...data].map((r) => r.map(csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(
      new Blob([content], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };
  function exportCSV() {
    if (!report) return;
    const period = periodMode === "month" ? month : fromDate + "-to-" + toDate;
    if (mode === "summary") {
      saveCSV(
        [
          "Employee ID",
          "Employee",
          "Days Worked",
          "Work Hours",
          "Required Hours",
          "Break Hours",
          "Overtime Hours",
          "Early Left Hours",
          "Absent Days",
          "Leave Days",
          "Off Days",
          "Absent Sessions",
        ],
        summaryRows.map((x) => [
          x.p.public_id,
          x.p.name,
          x.worked,
          csvH(x.net),
          csvH(x.required),
          csvH(x.breakMin),
          csvH(x.over),
          csvH(x.early),
          x.absent,
          x.leave,
          x.off,
          x.absSessions,
        ]),
        `work-hours-${period}.csv`,
      );
      return;
    }
    const cols = [
      "Employee ID",
      "Employee",
      ...dates.map((dt) => wdShort(dt) + " " + dt),
      ...(mode === "overtime"
        ? ["Overtime Days", "Overtime Hours"]
        : [
            "Present",
            "Work Hours",
            "Break Hours",
            "Overtime",
            "Early Left",
            "Absent Sessions",
          ]),
    ];
    const data = report.people.map((p) => {
      const entries = dates.map((dt) => dayRec(p, dt)),
        sum = (f: "net" | "breakMin" | "over" | "early") =>
          entries.reduce((a, b) => a + b[f], 0);
      return [
        p.public_id,
        p.name,
        ...entries.map((x) =>
          mode === "overtime" ? (x.over > 0 ? csvH(x.over) : "") : x.code,
        ),
        ...(mode === "overtime"
          ? [entries.filter((x) => x.over > 0).length, csvH(sum("over"))]
          : [
              entries.filter((x) => PRESENT_CODES.includes(x.code)).length,
              csvH(sum("net")),
              csvH(sum("breakMin")),
              csvH(sum("over")),
              csvH(sum("early")),
              entries.reduce((a, b) => a + b.absentSessions, 0),
            ]),
      ];
    });
    saveCSV(
      cols,
      data,
      `${mode === "overtime" ? "overtime" : "attendance"}-${period}.csv`,
    );
  }
  return (
    <Section
      title={
        mode === "overtime"
          ? "Monthly Overtime Calendar"
          : mode === "summary"
            ? "Work Hours Summary"
            : "Monthly Attendance Calendar"
      }
      action={
        <div className="rowActions">
          <button
            className="secondary small"
            onClick={exportCSV}
            disabled={!report}
          >
            Export CSV / Excel
          </button>
          <button className="secondary small" onClick={() => window.print()}>
            Print / PDF
          </button>
        </div>
      }
    >
      <div className="fieldGrid reportFilters">
        <label>
          Period
          <select
            value={periodMode}
            onChange={(e) => setPeriodMode(e.target.value as "month" | "range")}
          >
            <option value="month">Select month</option>
            <option value="range">Custom date range</option>
          </select>
        </label>
        {periodMode === "month" ? (
          <label>
            Month
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          </label>
        ) : (
          <>
            <label>
              From Date
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
              />
            </label>
            <label>
              To Date
              <input
                type="date"
                min={fromDate}
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
              />
            </label>
          </>
        )}
        {isAdmin && (
          <>
            <label>
              Employee
              <select
                value={employee}
                onChange={(e) => setEmployee(e.target.value)}
              >
                <option value="">All employees</option>
                {staff
                  .filter((s) => s.role !== "admin" && s.role !== "display")
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Branch
              <select
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
              >
                <option value="">All branches</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
      </div>
      {loading && <p>Loading report…</p>}
      {!loading && report && mode === "summary" && (
        <TableTools>
          <div className="dataScroll">
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Days worked</th>
                  <th>Work hours</th>
                  <th>Required hours</th>
                  <th>Break hours</th>
                  <th>Overtime hours</th>
                  <th>Early-left hours</th>
                  <th>Absent days</th>
                  <th>Leave days</th>
                  <th>Off days</th>
                  <th>Abs. sessions</th>
                </tr>
              </thead>
              <tbody>
                {summaryRows.map((x) => (
                  <tr key={x.p.id}>
                    <td>
                      {isAdmin ? x.p.name : "My Attendance"}
                      {x.p.public_id && (
                        <small className="annSnippet">{x.p.public_id}</small>
                      )}
                    </td>
                    <td>{x.worked}</td>
                    <td>{hrs(x.net)}</td>
                    <td>{hrs(x.required)}</td>
                    <td>{hrs(x.breakMin)}</td>
                    <td>{hrs(x.over)}</td>
                    <td>{hrs(x.early)}</td>
                    <td>{x.absent}</td>
                    <td>{x.leave}</td>
                    <td>{x.off}</td>
                    <td>{x.absSessions}</td>
                  </tr>
                ))}
              </tbody>
              {summaryRows.length > 1 && (
                <tfoot>
                  <tr>
                    <th>Total ({summaryRows.length} employees)</th>
                    <th>{summaryRows.reduce((a, x) => a + x.worked, 0)}</th>
                    <th>{hrs(summaryRows.reduce((a, x) => a + x.net, 0))}</th>
                    <th>
                      {hrs(summaryRows.reduce((a, x) => a + x.required, 0))}
                    </th>
                    <th>
                      {hrs(summaryRows.reduce((a, x) => a + x.breakMin, 0))}
                    </th>
                    <th>{hrs(summaryRows.reduce((a, x) => a + x.over, 0))}</th>
                    <th>{hrs(summaryRows.reduce((a, x) => a + x.early, 0))}</th>
                    <th>{summaryRows.reduce((a, x) => a + x.absent, 0)}</th>
                    <th>{summaryRows.reduce((a, x) => a + x.leave, 0)}</th>
                    <th>{summaryRows.reduce((a, x) => a + x.off, 0)}</th>
                    <th>
                      {summaryRows.reduce((a, x) => a + x.absSessions, 0)}
                    </th>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </TableTools>
      )}
      {!loading && report && mode !== "summary" && (
        <TableTools>
          <div className="dataScroll calendarMatrix">
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  {dates.map((dt) => (
                    <th
                      key={dt}
                      title={dt}
                      className={isOffDayAny(dt) ? "dayOffHead" : ""}
                    >
                      <span className="dh">{wdShort(dt)}</span>
                      <b>{dayText(dt)}</b>
                    </th>
                  ))}
                  {mode === "overtime" ? (
                    <>
                      <th>OT days</th>
                      <th>OT hours</th>
                    </>
                  ) : (
                    <>
                      <th>Days</th>
                      <th>Hours</th>
                      <th>Break</th>
                      <th>OT</th>
                      <th>Early</th>
                      <th>Abs. Sessions</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {report.people.map((p) => {
                  const rows = dates.map((dt) => dayRec(p, dt));
                  const sum = (f: "net" | "breakMin" | "over" | "early") =>
                    rows.reduce((v, x) => v + x[f], 0);
                  return (
                    <tr key={p.id}>
                      <td className="matrixEmployee">
                        {isAdmin ? p.name : "My Attendance"}
                      </td>
                      {rows.map((r, i) =>
                        mode === "overtime" ? (
                          <td
                            key={i}
                            title={`${wdShort(dates[i])} ${dates[i]}: overtime ${Math.round(r.over)} min`}
                            className={r.over > 0 ? "mark-OT" : ""}
                          >
                            {r.over > 0 ? fmtH(r.over) : ""}
                          </td>
                        ) : (
                          <td
                            key={i}
                            title={`${wdShort(dates[i])} ${dates[i]}: net ${Math.round(r.net)} min; overtime ${Math.round(r.over)} min; early ${Math.round(r.early)} min`}
                            className={"mark-" + r.code.replace("—", "none")}
                          >
                            {r.code === "—" ? "" : r.code}
                          </td>
                        ),
                      )}
                      {mode === "overtime" ? (
                        <>
                          <td>{rows.filter((r) => r.over > 0).length}</td>
                          <td>
                            <b>{fmtH(sum("over"))}</b>
                          </td>
                        </>
                      ) : (
                        <>
                          <td>
                            {
                              rows.filter((r) => PRESENT_CODES.includes(r.code))
                                .length
                            }
                          </td>
                          <td>{fmtH(sum("net"))}</td>
                          <td>{fmtH(sum("breakMin"))}</td>
                          <td>{fmtH(sum("over"))}</td>
                          <td>{fmtH(sum("early"))}</td>
                          <td>
                            {rows.reduce((v, x) => v + x.absentSessions, 0)}
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </TableTools>
      )}
      {mode === "attendance" && (
        <div className="markLegend">
          <span>
            <i className="mark-P" />P Present
          </span>
          <span>
            <i className="mark-EL" />
            EL Early left
          </span>
          <span>
            <i className="mark-OT" />
            OT Overtime
          </span>
          <span>
            <i className="mark-IN" />
            IN Open session
          </span>
          <span>
            <i className="mark-A" />A Absent / missed check-out
          </span>
          <span>
            <i className="mark-O" />O Off day (weekly day off)
          </span>
          <span>
            <i className="mark-L" />L Approved leave
          </span>
        </div>
      )}
      <p className="muted">
        {mode === "overtime"
          ? "Overtime is counted from the end of the required hours once the overtime grace period is exceeded (the whole overtime is counted). Only completed sessions count."
          : mode === "summary"
            ? "Totals for the chosen month or date range. Work hours are net of breaks; required hours are the daily targets of the days worked. Early-left and overtime follow the grace rules."
            : ""}{" "}
        Absent is shown for past days without a record when the employee has
        required daily hours. Approved leave and approved requests show as L.
        Hours are net of breaks. A check-in that is never closed (or stays open
        longer than the employee's Maximum Check-in Duration) is voided on its
        own: its hours are not counted and the other sessions of that day are
        calculated normally.
      </p>
    </Section>
  );
}

function EmployeeAttendanceReport({
  sessions,
  timeMode,
  breakPeriods,
  visibility,
}: {
  sessions: Row[];
  now: Date | null;
  timeMode: string;
  breakPeriods: Row[];
  visibility?: Visibility;
}) {
  const events: {
    key: string;
    date: unknown;
    label: string;
    kind: string;
    permission: string;
  }[] = [];
  for (const session of sessions) {
    events.push({
      key: String(session.id) + "-in",
      date: session.check_in,
      label: "Check In",
      kind: "in",
      permission: "history.checkIn",
    });
    if (session.missed_checkout)
      events.push({
        key: String(session.id) + "-missed",
        date: session.check_in,
        label: session.expired_absent
          ? "Absent (max duration exceeded)"
          : "Missed Check Out",
        kind: "out",
        permission: "history.checkOut",
      });
    if (session.check_out && !session.missed_checkout)
      events.push({
        key: String(session.id) + "-out",
        date: session.check_out,
        label: "Check Out",
        kind: "out",
        permission: "history.checkOut",
      });
    for (const b of breakPeriods.filter(
      (p) => String(p.session_id) === String(session.id),
    )) {
      events.push({
        key: String(b.id) + "-start",
        date: b.started_at,
        label: "Break In",
        kind: "break",
        permission: "history.breakIn",
      });
      if (b.ended_at)
        events.push({
          key: String(b.id) + "-end",
          date: b.ended_at,
          label: "Break Out",
          kind: "break",
          permission: "history.breakOut",
        });
    }
  }
  events.sort(
    (a, b) =>
      new Date(String(b.date)).getTime() - new Date(String(a.date)).getTime(),
  );
  const visibleEvents = events.filter((e) =>
    isVisible(visibility, e.permission),
  );
  const date = sessions[0]?.check_in;
  const net = sessions.reduce((sum, s) => sum + sessionNetMinutes(s, null), 0);
  return (
    <div className="attendanceHistoryActivity">
      {(isVisible(visibility, "history.date") ||
        isVisible(visibility, "history.total")) && (
        <div className="attendanceHistoryTop">
          {isVisible(visibility, "history.date") && (
            <strong>{date ? shortDate(date) : "Selected day"}</strong>
          )}
          {isVisible(visibility, "history.total") && (
            <span>
              Total Hours: <b>{minsLabel(net)}</b>
            </span>
          )}
        </div>
      )}
      <div className="activityList">
        {visibleEvents.map((e) => (
          <div className="activityItem" key={e.key}>
            <span
              className={
                "activityIcon " +
                (e.kind === "in"
                  ? "on"
                  : e.kind === "out"
                    ? "off"
                    : "historyBreak")
              }
            >
              <span aria-hidden="true">
                {e.kind === "in" ? "↓" : e.kind === "out" ? "↑" : "Ⅱ"}
              </span>
            </span>
            <div>
              <strong>{e.label}</strong>
              {isVisible(visibility, "history.eventDate") && (
                <small>{shortDate(e.date)}</small>
              )}
            </div>
            {isVisible(visibility, "history.eventTime") && (
              <b>{stamp(e.date, timeMode)}</b>
            )}
          </div>
        ))}
        {!visibleEvents.length && (
          <p className="muted">No attendance entries for this day.</p>
        )}
      </div>
    </div>
  );
}

function getEmployeeMonthStats(
  sessions: Row[],
  leaves: Row[],
  user: Row,
  now: Date | null,
  settings: Row,
) {
  const current = now || new Date();
  const prefix = dayKey(current).slice(0, 7);
  const today = dayKey(current);
  const firstAccountDay = user.created_at ? dayKey(user.created_at) : null;
  const days = new Date(
    current.getFullYear(),
    current.getMonth() + 1,
    0,
  ).getDate();
  let present = 0,
    early = 0,
    absent = 0,
    overtime = 0,
    leaveDays = 0;
  for (let d = 1; d <= days; d++) {
    const key = prefix + "-" + String(d).padStart(2, "0");
    if (key > today || (firstAccountDay && key < firstAccountDay)) continue;
    const onLeave = leaves.some(
      (l) =>
        String(l.employee_id) === String(user.id) &&
        key >= String(l.start_date).slice(0, 10) &&
        key <= String(l.end_date).slice(0, 10),
    );
    if (onLeave) {
      leaveDays++;
      continue;
    }
    const dayAll = sessions.filter((s) => dayKey(s.check_in) === key);
    const records = dayAll.filter(
      (s) => !s.expired_absent && !s.missed_checkout,
    );
    if (records.length) {
      // Match the calendar color rules: an open session or an unconfigured
      // required-hours value must never count as a completed (green) day.
      const complete = records.every(
        (s) => Boolean(s.check_out) && !s.missed_checkout,
      );
      const net = records.reduce((v, s) => v + sessionNetMinutes(s, now), 0);
      const snapshot = records.find(
        (s) => s.required_hours_snapshot != null,
      )?.required_hours_snapshot;
      const raw = snapshot != null ? snapshot : user.required_daily_hours;
      const required =
        raw != null && raw !== "" && Number(raw) > 0 ? Number(raw) * 60 : null;
      if (
        records.some((s) => s.missed_checkout) ||
        (!complete && key < today && !user.variable_overnight_shift)
      ) {
        absent++;
      }
      if (complete && required !== null) {
        const variance = attendanceVariance(net, required, settings);
        if (variance.early > 0) early++;
        else if (variance.overtime > 0) overtime++;
        else present++;
      }
    } else if (
      dayAll.length > 0 ||
      (key < today &&
        !isOffDay(String(user.id), key) &&
        Number(user.required_daily_hours) > 0)
    ) {
      absent++;
    }
  }
  return { present, early, absent, overtime, leaveDays };
}
function EmployeeMonthlySummary({
  sessions,
  leaves,
  user,
  now,
  settings,
}: {
  sessions: Row[];
  leaves: Row[];
  user: Row;
  now: Date | null;
  settings: Row;
}) {
  const { present, early, absent, overtime, leaveDays } = getEmployeeMonthStats(
    sessions,
    leaves,
    user,
    now,
    settings,
  );
  return (
    <div className="monthSummaryCards">
      <div>
        <strong className="greenText">{present}</strong>
        <span>Present</span>
      </div>
      <div>
        <strong className="redText">{absent}</strong>
        <span>Absent</span>
      </div>
      <div>
        <strong className="orangeText">{early}</strong>
        <span>Early Left</span>
      </div>
      <div>
        <strong className="blueText">{overtime}</strong>
        <span>Overtime</span>
      </div>
      <div>
        <strong style={{ color: "#8b5cf6" }}>{leaveDays}</strong>
        <span>Leave</span>
      </div>
    </div>
  );
}
function EmployeeDailyCards({
  sessions,
  now,
  timeMode,
  visibility,
}: {
  sessions: Row[];
  now: Date | null;
  timeMode: string;
  visibility?: Visibility;
}) {
  const groups = new Map<string, Row[]>();
  for (const s of sessions) {
    const day = dayKey(s.check_in);
    groups.set(day, [...(groups.get(day) || []), s]);
  }
  const days = [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  return (
    <div className="employeeDayCards">
      {isVisible(visibility, "reports.daily") &&
        days.map(([date, items]) => {
          const sorted = [...items].sort(
            (a, b) =>
              new Date(a.check_in).getTime() - new Date(b.check_in).getTime(),
          );
          const total = sorted.reduce(
            (v, s) => v + sessionNetMinutes(s, now),
            0,
          );
          const breaks = sorted.reduce((v, s) => {
            const end = new Date(s.check_out || now || Date.now()).getTime();
            return (
              v +
              Number(s.break_seconds || 0) / 60 +
              (s.break_started_at
                ? Math.max(
                    0,
                    (end - new Date(s.break_started_at).getTime()) / 60000,
                  )
                : 0)
            );
          }, 0);
          const completed = sorted.every(
            (s) => Boolean(s.check_out) && !s.missed_checkout,
          );
          return (
            <article key={date} className="employeeDayCard">
              <div className="employeeDayTop">
                {isVisible(visibility, "reports.date") && (
                  <strong>{date}</strong>
                )}
                {isVisible(visibility, "reports.status") && (
                  <span>{completed ? "Completed" : "—"}</span>
                )}
              </div>
              <div className="employeeDayTimes">
                {isVisible(visibility, "reports.checkIn") && (
                  <div>
                    <small>First Check In</small>
                    <strong>{stamp(sorted[0].check_in, timeMode)}</strong>
                  </div>
                )}
                {isVisible(visibility, "reports.checkOut") && (
                  <div>
                    <small>Last Check Out</small>
                    <strong>
                      {stamp(
                        [...sorted]
                          .reverse()
                          .find((s) => s.check_out && !s.missed_checkout)
                          ?.check_out,
                        timeMode,
                      )}
                    </strong>
                  </div>
                )}
              </div>
              <div className="employeeDayTotals">
                {isVisible(visibility, "reports.sessions") && (
                  <span>Sessions: {sorted.length}</span>
                )}
                {isVisible(visibility, "reports.break") && (
                  <span>Break: {minsLabel(breaks)}</span>
                )}
                {isVisible(visibility, "reports.net") && (
                  <b>Net: {minsLabel(total)}</b>
                )}
              </div>
            </article>
          );
        })}
      {!days.length && <p className="muted">No attendance records.</p>}
    </div>
  );
}
function AdminSessionsTable({
  sessions,
  now,
  timeMode,
  settings,
}: {
  sessions: Row[];
  now: Date | null;
  timeMode: string;
  settings: Row;
}) {
  const ordered = [...sessions].sort(
    (a, b) => new Date(a.check_in).getTime() - new Date(b.check_in).getTime(),
  );
  const grouped = new Map<string, Row[]>();
  for (const session of ordered) {
    const id = String(session.employee_id) + "|" + dayKey(session.check_in);
    grouped.set(id, [...(grouped.get(id) || []), session]);
  }
  const rows = Array.from(grouped.values()).reverse();
  return (
    <TableTools>
      <div className="dataScroll adminAttendanceTable">
        <table>
          <thead>
            <tr>
              <th>Employee</th>
              <th>Date</th>
              <th>First In</th>
              <th>Last Out</th>
              <th>Sessions</th>
              <th>Break</th>
              <th>Net Hours</th>
              <th>Required</th>
              <th>Early Left</th>
              <th>Overtime</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((items) => {
              const first = items[0],
                last = items[items.length - 1],
                done = items.every((x) => Boolean(x.check_out));
              const net = items.reduce(
                (v, x) => v + sessionNetMinutes(x, now),
                0,
              );
              const breaks = items.reduce((v, x) => {
                const end = new Date(
                  x.check_out || now || Date.now(),
                ).getTime();
                return (
                  v +
                  Number(x.break_seconds || 0) / 60 +
                  (x.break_started_at
                    ? Math.max(
                        0,
                        (end - new Date(x.break_started_at).getTime()) / 60000,
                      )
                    : 0)
                );
              }, 0);
              const required =
                first.required_hours_snapshot == null
                  ? null
                  : Number(first.required_hours_snapshot) * 60;
              const variance =
                required !== null
                  ? attendanceVariance(net, required, settings)
                  : { early: 0, overtime: 0 };
              const early = done ? variance.early : 0;
              const overtime = done ? variance.overtime : 0;
              return (
                <tr
                  key={String(first.employee_id) + "-" + dayKey(first.check_in)}
                >
                  <td>{first.name}</td>
                  <td>{shortDate(first.check_in)}</td>
                  <td>{stamp(first.check_in, timeMode)}</td>
                  <td>{done ? stamp(last.check_out, timeMode) : "—"}</td>
                  <td>
                    {items.length}
                    {items.some((x) => x.expired_absent)
                      ? ` (${items.filter((x) => x.expired_absent).length} absent)`
                      : ""}
                  </td>
                  <td>{minsLabel(breaks)}</td>
                  <td>{minsLabel(net)}</td>
                  <td>{required === null ? "—" : minsLabel(required)}</td>
                  <td className="earlyText">
                    {early > 0 ? minsLabel(early) : "—"}
                  </td>
                  <td className="overtimeText">
                    {overtime > 0 ? minsLabel(overtime) : "—"}
                  </td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr>
                <td colSpan={10}>No attendance records.</td>
              </tr>
            )}
          </tbody>
        </table>
        <p className="muted">
          Early Left and Overtime are calculated only after all sessions for the
          day are closed and required hours are available. Breaks are deducted
          from net hours.
        </p>
      </div>
    </TableTools>
  );
}

function MapLink({ lat, lon }: { lat: unknown; lon: unknown }) {
  if (lat == null || lon == null) return <span className="muted">—</span>;
  const la = Number(lat),
    lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo))
    return <span className="muted">—</span>;
  const text = la.toFixed(6) + ", " + lo.toFixed(6);
  return (
    <span className="mapCell">
      <a
        className="mapLink"
        href={
          "https://www.google.com/maps/search/?api=1&query=" + la + "," + lo
        }
        target="_blank"
        rel="noopener noreferrer"
        title="Open in Google Maps"
      >
        <MapPin size={13} /> {text}
      </a>
      <button
        type="button"
        className="copyBtn"
        title="Copy coordinates"
        aria-label="Copy coordinates"
        onClick={() => {
          void navigator.clipboard?.writeText(la + "," + lo).then(
            () => toast.success("Coordinates copied"),
            () => toast.error("Copy is not available"),
          );
        }}
      >
        <Copy size={12} />
      </button>
    </span>
  );
}
function AdminLocationTable({
  sessions,
  timeMode,
}: {
  sessions: Row[];
  timeMode: string;
}) {
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Row | null>(null);
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const rows = [...sessions]
    .sort(
      (a, b) => new Date(b.check_in).getTime() - new Date(a.check_in).getTime(),
    )
    .filter((x) =>
      String(x.name || "")
        .toLowerCase()
        .includes(q.toLowerCase()),
    );
  const localInput = (v: unknown) => {
    const d = new Date(String(v));
    return `${new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d)}T${new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d)}`;
  };
  const beginEdit = (x: Row) => {
    setEditing(x);
    setCheckIn(localInput(x.check_in));
    setCheckOut(
      x.check_out && !x.missed_checkout ? localInput(x.check_out) : "",
    );
    setReason("");
  };
  const saveEdit = async () => {
    if (!editing) return;
    if (!checkIn) {
      toast.error("Please select the Check-in date and time");
      return;
    }
    if (!reason.trim() || reason.trim().length < 5) {
      toast.error("Please enter a reason (at least 5 characters)");
      return;
    }
    if (
      checkOut &&
      new Date(checkOut).getTime() < new Date(checkIn).getTime()
    ) {
      toast.error("Check-out cannot be earlier than Check-in");
      return;
    }
    setSaving(true);
    try {
      await api("manage", {
        kind: "attendance",
        action: "edit",
        id: editing.id,
        check_in: checkIn,
        check_out: checkOut,
        reason: reason.trim(),
      });
      toast.success("Attendance updated");
      setEditing(null);
      window.dispatchEvent(new Event("attendance-data-refresh"));
    } catch (e) {
      toast.error(String((e as Error).message || e));
    } finally {
      setSaving(false);
    }
  };
  const remove = async (x: Row) => {
    if (!window.confirm(`Delete attendance session for ${x.name}?`)) return;
    const why = window.prompt(
      "Reason for deleting this attendance record (required)",
    );
    if (!why || why.trim().length < 5) {
      toast.error("Please enter a reason (at least 5 characters)");
      return;
    }
    try {
      await api("manage", {
        kind: "attendance",
        action: "delete",
        id: x.id,
        reason: why.trim(),
      });
      toast.success("Attendance deleted");
      window.dispatchEvent(new Event("attendance-data-refresh"));
    } catch (e) {
      toast.error(String((e as Error).message || e));
    }
  };
  return (
    <>
      <input
        className="adminEmployeeSearch"
        aria-label="Search employee"
        placeholder="Search employee"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <TableTools>
        <div className="dataScroll">
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Date</th>
                <th>Check in</th>
                <th>Check-in location</th>
                <th>Check out</th>
                <th>Check-out location</th>
                <th>Admin actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((x) => (
                <tr key={String(x.id)}>
                  <td>{String(x.name || "—")}</td>
                  <td>{shortDate(x.check_in)}</td>
                  <td>{stamp(x.check_in, timeMode)}</td>
                  <td>
                    <MapLink lat={x.in_lat} lon={x.in_lon} />
                  </td>
                  <td>
                    {x.expired_absent ? (
                      <span className="requestStatus rejected">Absent</span>
                    ) : x.check_out && !x.missed_checkout ? (
                      stamp(x.check_out, timeMode)
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    <MapLink lat={x.out_lat} lon={x.out_lon} />
                  </td>
                  <td>
                    <div className="rowActions">
                      <button
                        className="secondary small"
                        onClick={() => beginEdit(x)}
                      >
                        <Pencil size={14} /> Edit
                      </button>
                      <button
                        className="danger small"
                        onClick={() => void remove(x)}
                      >
                        <Trash2 size={14} /> Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={7}>No sessions found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </TableTools>
      <p className="muted">
        Each session is listed separately. Admin corrections require a reason
        and are recorded in the audit log. Manual entries have no coordinates.
      </p>
      {editing && (
        <div
          className="modalBackdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !saving) setEditing(null);
          }}
        >
          <section
            className="dialog attendanceEditDialog"
            role="dialog"
            aria-modal="true"
          >
            <div className="sectionHead">
              <h3>Edit Attendance · {String(editing.name || "Employee")}</h3>
              <button
                className="iconButton"
                onClick={() => setEditing(null)}
                disabled={saving}
              >
                <X />
              </button>
            </div>
            <label>
              Check-in date &amp; time
              <input
                type="datetime-local"
                value={checkIn}
                onChange={(e) => setCheckIn(e.target.value)}
              />
            </label>
            <label>
              Check-out date &amp; time{" "}
              <small>(Leave empty for an open session)</small>
              <input
                type="datetime-local"
                value={checkOut}
                onChange={(e) => setCheckOut(e.target.value)}
              />
            </label>
            <label>
              Reason for correction
              <textarea
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Enter the reason for this correction (minimum 5 characters)"
              />
            </label>
            <div className="dialogFooter">
              <button
                className="secondary"
                onClick={() => setEditing(null)}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                className="primary"
                onClick={() => void saveEdit()}
                disabled={saving}
              >
                {saving ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
function FailedAttempts({
  timeMode,
  refreshKey,
  canDelete,
}: {
  timeMode: string;
  refreshKey: number;
  canDelete: boolean;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const load = useCallback(async () => {
    try {
      const r = await api("attendance-failures");
      setRows(r.failures || []);
      setErr("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load, refreshKey]);
  const remove = async (body: Row) => {
    try {
      await api("attendance-failures", body);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  const shown = rows.filter((r) =>
    (String(r.name || "") + " " + String(r.reason || ""))
      .toLowerCase()
      .includes(q.toLowerCase()),
  );
  const dist = (m: unknown) =>
    m == null
      ? "—"
      : Number(m) >= 1000
        ? (Number(m) / 1000).toFixed(2) + " km"
        : Math.round(Number(m)) + " m";
  return (
    <Section
      title="Failed Attempts"
      action={
        <>
          <button className="secondary small" onClick={() => void load()}>
            Refresh
          </button>
          {canDelete && rows.length > 0 && (
            <button
              className="danger small"
              onClick={() => {
                if (window.confirm("Delete all failed attempt records?"))
                  void remove({ all: true });
              }}
            >
              <Trash2 size={14} /> Clear all
            </button>
          )}
        </>
      }
    >
      <p className="muted">
        Every check-in and check-out attempt that failed (GPS off, location
        permission denied, weak GPS, outside the allowed area, missing
        geofence, on break…). Attempts without GPS have no location.
      </p>
      {err && <p className="errorText">{err}</p>}
      <input
        className="adminEmployeeSearch"
        aria-label="Search failed attempts"
        placeholder="Search employee or reason"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <TableTools>
        <div className="dataScroll">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Employee</th>
                <th>Branch</th>
                <th>Attempt</th>
                <th>Reason</th>
                <th>Distance</th>
                <th>GPS accuracy</th>
                <th>Location</th>
                {canDelete && <th></th>}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={String(r.id)}>
                  <td>
                    {shortDate(r.created_at)} {stamp(r.created_at, timeMode)}
                  </td>
                  <td>{String(r.name || "—")}</td>
                  <td>{String(r.branch_name || "—")}</td>
                  <td>{r.action === "check-out" ? "Check out" : "Check in"}</td>
                  <td>{String(r.reason)}</td>
                  <td>{dist(r.distance_m)}</td>
                  <td>
                    {r.accuracy == null
                      ? "—"
                      : Math.round(Number(r.accuracy)) + " m"}
                  </td>
                  <td>
                    <MapLink lat={r.lat} lon={r.lon} />
                  </td>
                  {canDelete && (
                    <td>
                      <button
                        className="danger small"
                        title="Delete"
                        onClick={() => void remove({ id: r.id })}
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {!shown.length && (
                <tr>
                  <td colSpan={canDelete ? 9 : 8}>
                    {loading ? "Loading…" : "No failed attempts recorded."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </TableTools>
    </Section>
  );
}
function ActivityLog({ timeMode }: { timeMode: string }) {
  const [pages, setPages] = useState<Row[][]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [actions, setActions] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [action, setAction] = useState("");
  const [err, setErr] = useState("");
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const rows = pages[pageIndex] || [];
  const load = useCallback(
    async (before?: string, target = 0) => {
      setLoading(true);
      try {
        const r = await api(
          "activity-log?q=" +
            encodeURIComponent(q) +
            "&action=" +
            encodeURIComponent(action) +
            (before ? "&before=" + before : ""),
        );
        const list: Row[] = r.rows || [];
        setPages((old) =>
          target === 0 ? [list] : [...old.slice(0, target), list],
        );
        setPageIndex(target);
        setActions(r.actions || []);
        setMore(r.hasMore === true);
        setErr("");
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [q, action],
  );
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const t = setInterval(() => {
      if (pageIndex === 0 && document.visibilityState === "visible")
        void load();
    }, 20000);
    return () => clearInterval(t);
  }, [load, pageIndex]);
  const next = () => {
    if (pageIndex + 1 < pages.length) {
      setPageIndex((i) => i + 1);
      return;
    }
    const last = rows[rows.length - 1];
    if (last) void load(String(last.id), pageIndex + 1);
  };
  const tone = (a: string) =>
    /failed|blocked|rejected|Deleted|Cleared/i.test(a)
      ? "dev-open"
      : /Signed in|Check in|Check out|approved|Allowed|Created/i.test(a)
        ? "dev-approved"
        : "";
  return (
    <Section
      title="Activity Log"
      action={
        <button className="secondary small" onClick={() => void load()}>
          Refresh
        </button>
      }
    >
      <p className="muted">
        Sign-ins (with location), punches, requests and administrative changes.
        Entries are kept for 180 days. 50 entries per page.
      </p>
      {err && <p className="errorText">{err}</p>}
      <div className="logFilters">
        <input
          aria-label="Search activity"
          placeholder="Search user, target or details"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          aria-label="Filter by action"
          value={action}
          onChange={(e) => setAction(e.target.value)}
        >
          <option value="">All actions</option>
          {actions.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
      </div>
      <TableTools>
        <div className="dataScroll">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>User</th>
                <th>Action</th>
                <th>Details</th>
                <th>Location</th>
                <th>IP</th>
                <th>Device</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={String(r.id)}>
                  <td>
                    {shortDate(r.created_at)} {stamp(r.created_at, timeMode)}
                  </td>
                  <td>
                    {String(r.actor_name || "—")}
                    {r.actor_role && (
                      <>
                        <br />
                        <small className="muted">{String(r.actor_role)}</small>
                      </>
                    )}
                  </td>
                  <td>
                    <span className={"devStatus " + tone(String(r.action))}>
                      {String(r.action)}
                    </span>
                  </td>
                  <td>
                    {[r.target, r.detail]
                      .filter(Boolean)
                      .map(String)
                      .join(" · ") || "—"}
                  </td>
                  <td>
                    <MapLink lat={r.lat} lon={r.lon} />
                    {r.accuracy != null && (
                      <>
                        <br />
                        <small className="muted">
                          ±{Math.round(Number(r.accuracy))} m
                        </small>
                      </>
                    )}
                  </td>
                  <td>{String(r.ip || "—")}</td>
                  <td>{String(r.device || "—")}</td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={7}>
                    {loading ? "Loading…" : "No activity found."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </TableTools>
      <div className="rowActions activityPagination">
        <button
          className="secondary small"
          disabled={pageIndex === 0 || loading}
          onClick={() => setPageIndex((i) => Math.max(0, i - 1))}
        >
          Previous
        </button>
        <span className="muted">
          Page {pageIndex + 1} · {rows.length} records
        </span>
        <button
          className="secondary small"
          disabled={(!pages[pageIndex + 1] && !more) || loading}
          onClick={next}
        >
          Next
        </button>
      </div>
    </Section>
  );
}

function DeviceCell({ label, info }: { label: unknown; info: unknown }) {
  const i = (info && typeof info === "object" ? info : {}) as Row;
  const bits = [i.type, i.screen, i.tz].filter(Boolean).map(String).join(" · ");
  return (
    <>
      <b>{String(label || "—")}</b>
      {bits && (
        <>
          <br />
          <small className="muted">{bits}</small>
        </>
      )}
    </>
  );
}
function DeviceSecurity({
  timeMode,
  refreshKey,
  isFull,
}: {
  timeMode: string;
  refreshKey: number;
  isFull: boolean;
}) {
  const [devices, setDevices] = useState<Row[]>([]);
  const [alerts, setAlerts] = useState<Row[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [matchMode, setMatchMode] = useState("flexible");
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const load = useCallback(async () => {
    try {
      const r = await api("devices");
      setDevices(r.devices || []);
      setAlerts(r.alerts || []);
      setEnabled(r.enabled !== false);
      setMatchMode(r.matchMode === "strict" ? "strict" : "flexible");
      setErr("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load, refreshKey]);
  const act = async (body: Row, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    try {
      await api("devices", body);
      toast.success("Done");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };
  const when = (v: unknown) =>
    v ? shortDate(v) + " " + stamp(v, timeMode) : "—";
  const open = alerts.filter((a) => a.status === "open");
  const list = devices.filter((d) =>
    (String(d.name || "") + " " + String(d.email || ""))
      .toLowerCase()
      .includes(q.toLowerCase()),
  );
  return (
    <>
      <Section
        title={"Device Alerts" + (open.length ? " (" + open.length + ")" : "")}
        action={
          <button className="secondary small" onClick={() => void load()}>
            Refresh
          </button>
        }
      >
        {err && <p className="errorText">{err}</p>}
        <p className="muted">
          Shown when an employee tries to sign in or punch from a device that is
          not the one registered to their account.
        </p>
        <TableTools>
          <div className="dataScroll">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Employee</th>
                  <th>Attempted device</th>
                  <th>Registered device</th>
                  <th>IP</th>
                  <th>Where</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {alerts.map((a) => (
                  <tr key={String(a.id)}>
                    <td>{when(a.created_at)}</td>
                    <td>{String(a.name)}</td>
                    <td>
                      <DeviceCell label={a.label} info={a.info} />
                    </td>
                    <td>
                      <DeviceCell
                        label={a.registered_label}
                        info={a.registered_info}
                      />
                    </td>
                    <td>{String(a.ip || "—")}</td>
                    <td>{a.context === "login" ? "Sign in" : "Punch"}</td>
                    <td>
                      <span className={"devStatus dev-" + String(a.status)}>
                        {String(a.status)}
                      </span>
                    </td>
                    <td className="rowActions">
                      {a.status === "open" && (
                        <>
                          <button
                            className="primary small"
                            title="Replace the registered device with this one"
                            onClick={() =>
                              void act(
                                { action: "approve", alertId: a.id },
                                "Allow this device? The currently registered device will be signed out and no longer able to use this account.",
                              )
                            }
                          >
                            Allow device
                          </button>
                          <button
                            className="secondary small"
                            onClick={() =>
                              void act({ action: "dismiss", alertId: a.id })
                            }
                          >
                            Dismiss
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
                {!alerts.length && (
                  <tr>
                    <td colSpan={8}>No device alerts.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </TableTools>
      </Section>
      <Section
        title="Registered Devices"
        action={
          isFull ? (
            <label className="deviceToggle">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) =>
                  void act({ action: "toggle", enabled: e.target.checked })
                }
              />{" "}
              Device lock {enabled ? "on" : "off"}
            </label>
          ) : undefined
        }
      >
        {isFull && (
          <p className="muted">
            Device recognition:{" "}
            <select
              value={matchMode}
              onChange={(e) =>
                void act({ action: "match-mode", mode: e.target.value })
              }
            >
              <option value="flexible">
                Flexible — same browser, or same phone model and settings
              </option>
              <option value="strict">Strict — same browser only</option>
            </select>
          </p>
        )}
        <p className="muted">
          Each employee is locked to the first device they sign in from. Reset a
          device to let the employee register a new one at their next sign-in.
          Administrators and display screens are not locked.
        </p>
        <input
          className="adminEmployeeSearch"
          aria-label="Search employees"
          placeholder="Search employees"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <TableTools>
          <div className="dataScroll">
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Device</th>
                  <th>IP</th>
                  <th>Registered</th>
                  <th>Last seen</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {list.map((d) => (
                  <tr key={String(d.employee_id)}>
                    <td>
                      {String(d.name)}
                      <br />
                      <small className="muted">{String(d.email)}</small>
                    </td>
                    <td>
                      <DeviceCell label={d.label} info={d.info} />
                    </td>
                    <td>{String(d.ip || "—")}</td>
                    <td>{when(d.bound_at)}</td>
                    <td>{when(d.last_seen)}</td>
                    <td>
                      <button
                        className="danger small"
                        onClick={() =>
                          void act(
                            { action: "reset", employeeId: d.employee_id },
                            "Reset the device for " +
                              String(d.name) +
                              "? Their current device will be signed out, and the next device they sign in from becomes the registered one.",
                          )
                        }
                      >
                        Reset device
                      </button>
                    </td>
                  </tr>
                ))}
                {!list.length && (
                  <tr>
                    <td colSpan={6}>No registered devices yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </TableTools>
      </Section>
    </>
  );
}
function WorkforceAnalytics({ settings }: { settings: Row }) {
  const [raw, setRaw] = useState<Row[]>([]);
  const [headcount, setHeadcount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const r = await api("workforce-analytics?days=30");
      setRaw(r.rows || []);
      setHeadcount(Number(r.headcount || 0));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load analytics");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 60000);
    return () => clearInterval(id);
  }, [load]);
  const byDay = new Map<string, Row[]>();
  for (const x of raw) {
    const k = dayKey(x.check_in);
    byDay.set(k, [...(byDay.get(k) || []), x]);
  }
  const dates = Array.from({ length: 14 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (13 - i));
    return dayKey(d);
  });
  const daily = dates.map((date) => {
    const sessions = byDay.get(date) || [];
    const people = new Map<string, Row[]>();
    for (const x of sessions.filter(
      (v) => !v.expired_absent && !v.missed_checkout,
    ))
      people.set(String(x.employee_id), [
        ...(people.get(String(x.employee_id)) || []),
        x,
      ]);
    let present = people.size,
      ontime = 0,
      punctualEligible = 0,
      early = 0,
      otHours = 0;
    for (const list of people.values()) {
      const sorted = [...list].sort(
        (a, b) =>
          new Date(a.check_in).getTime() - new Date(b.check_in).getTime(),
      );
      const first = sorted[0];
      const start = String(first.shift_start_snapshot || "").slice(0, 5);
      const check = new Intl.DateTimeFormat("en-GB", {
        timeZone: zone,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(new Date(first.check_in));
      if (start) {
        punctualEligible++;
        if (check <= start) ontime++;
      }
      const complete = sorted.every((x) => !!x.check_out && !x.missed_checkout);
      if (!complete) continue;
      const net = sorted.reduce(
        (v, x) =>
          v +
          Math.max(
            0,
            (new Date(x.check_out).getTime() - new Date(x.check_in).getTime()) /
              60000 -
              Number(x.break_seconds || 0) / 60,
          ),
        0,
      );
      const target =
        Number(
          first.required_hours_snapshot ?? first.required_daily_hours ?? 0,
        ) * 60;
      if (target > 0) {
        if (net < target - graceMinutes(settings, "early_grace_minutes"))
          early++;
        if (net > target + graceMinutes(settings, "overtime_grace_minutes"))
          otHours += (net - target) / 60;
      }
    }
    return {
      date,
      present,
      attendance: headcount ? Math.min(100, (present / headcount) * 100) : 0,
      punctualEligible,
      punctuality: punctualEligible ? (ontime / punctualEligible) * 100 : 0,
      ontime,
      early,
      overtime: otHours,
    };
  });
  const totals = daily.reduce(
    (a, d) => ({
      present: a.present + d.present,
      ontime: a.ontime + d.ontime,
      eligible: a.eligible + d.punctualEligible,
      early: a.early + d.early,
      overtime: a.overtime + d.overtime,
    }),
    { present: 0, ontime: 0, eligible: 0, early: 0, overtime: 0 },
  );
  const attendanceRate = daily.length
    ? daily.reduce((v, d) => v + d.attendance, 0) / daily.length
    : 0;
  const punctualRate = totals.eligible
    ? (totals.ontime / totals.eligible) * 100
    : 0;
  const bars = (
    key: "attendance" | "punctuality" | "early" | "overtime",
    label: string,
    max: number,
  ) => (
    <div className="analyticsChart">
      <div className="analyticsChartTitle">
        <strong>{label}</strong>
        <small>Last 14 days</small>
      </div>
      <div className="analyticsBarGrid">
        {daily.map((d) => (
          <div className="analyticsBarCol" key={d.date}>
            <div className="analyticsBarTrack">
              <i
                style={{
                  height:
                    Math.max(
                      d[key] === 0 ? 1 : 4,
                      Math.min(100, (d[key] / max) * 100),
                    ) + "%",
                }}
              />
            </div>
            <small>{d.date.slice(8)}</small>
          </div>
        ))}
      </div>
    </div>
  );
  return (
    <Section
      title="Attendance Analytics"
      action={
        <button className="secondary small" onClick={() => void load()}>
          Refresh
        </button>
      }
    >
      {error && <p className="errorText">{error}</p>}
      {loading ? (
        <p className="muted">Loading attendance analytics…</p>
      ) : (
        <>
          <div className="analyticsKpis">
            <div>
              <small>Average Attendance</small>
              <strong>{attendanceRate.toFixed(1)}%</strong>
            </div>
            <div>
              <small>On-time Rate</small>
              <strong>{punctualRate.toFixed(1)}%</strong>
            </div>
            <div>
              <small>Early Departures</small>
              <strong>{totals.early}</strong>
            </div>
            <div>
              <small>Overtime Hours</small>
              <strong>{fmtH(totals.overtime * 60, "report", true)}</strong>
            </div>
          </div>
          <div className="analyticsCharts">
            {bars("attendance", "Attendance rate", 100)}
            {bars("punctuality", "On-time rate", 100)}
            {bars(
              "early",
              "Early departures",
              Math.max(1, ...daily.map((d) => d.early)),
            )}
            {bars(
              "overtime",
              "Overtime hours",
              Math.max(1, ...daily.map((d) => d.overtime)),
            )}
          </div>
          <p className="muted">
            Based on active employees only; administrators and display accounts
            are excluded. Attendance rate compares employees with at least one
            punch against the active employee count. Early departures and
            overtime are calculated only for completed shifts with configured
            required hours.
          </p>
        </>
      )}
    </Section>
  );
}

function AdminWorkforceDashboard({
  staff,
  sessions,
  kitchen,
  now,
  timeMode,
  onReports,
  onEmployees,
  settings,
  showKitchen = true,
  showKitchenPart,
}: {
  staff: Row[];
  sessions: Row[];
  kitchen: Row[];
  now: Date | null;
  timeMode: string;
  onReports: () => void;
  onEmployees: () => void;
  settings: Row;
  showKitchen?: boolean;
  showKitchenPart: (key: string) => boolean;
}) {
  const [search, setSearch] = useState("");
  const today = dayKey(now || new Date());
  const employees = staff.filter(
    (e) => e.role === "employee" && e.status === "active",
  );
  const items = employees.map((e) => {
    const all = sessions.filter((s) => String(s.employee_id) === String(e.id));
    const open = all
      .filter((s) => !s.check_out)
      .sort(
        (a, b) =>
          new Date(b.check_in).getTime() - new Date(a.check_in).getTime(),
      );
    const todaySessions = all.filter((s) => dayKey(s.check_in) === today);
    const relevant = todaySessions.length
      ? todaySessions
      : open.length
        ? open
        : [];
    const net = relevant.reduce((v, s) => v + sessionNetMinutes(s, now), 0);
    const inShift = open.length > 0;
    const onBreak = open.some((s) => !!s.break_started_at);
    const checkedOut =
      todaySessions.length > 0 && todaySessions.every((s) => !!s.check_out);
    const snapshot = todaySessions.find(
      (s) => s.required_hours_snapshot != null,
    )?.required_hours_snapshot;
    const target = Number(snapshot ?? e.required_daily_hours);
    const early =
      checkedOut &&
      target > 0 &&
      net < target * 60 - graceMinutes(settings, "early_grace_minutes");
    const overtime =
      checkedOut &&
      target > 0 &&
      net > target * 60 + graceMinutes(settings, "overtime_grace_minutes");
    const status = onBreak
      ? "On Break"
      : inShift
        ? "Checked In"
        : early
          ? "Early Left"
          : overtime
            ? "Overtime"
            : checkedOut
              ? "Checked Out"
              : "No Punch";
    return { e, relevant, net, status, early, inShift, onBreak, checkedOut };
  });
  const visible = items.filter((v) =>
    (String(v.e.name || "") + " " + String(v.e.email || ""))
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const count = (filter: (v: (typeof items)[number]) => boolean) =>
    items.filter(filter).length;
  return (
    <>
      <Section
        title="Workforce Overview"
        action={
          <button className="primary small" onClick={onReports}>
            All Employees Reports
          </button>
        }
      >
        <div className="adminWorkforceMetrics">
          <div>
            <small>Total Employees</small>
            <strong>{employees.length}</strong>
          </div>
          <div>
            <small>Checked In</small>
            <strong>{count((v) => v.inShift && !v.onBreak)}</strong>
          </div>
          <div>
            <small>On Break</small>
            <strong>{count((v) => v.onBreak)}</strong>
          </div>
          <div>
            <small>Checked Out Today</small>
            <strong>{count((v) => v.checkedOut)}</strong>
          </div>
          <div>
            <small>Early Left Today</small>
            <strong>{count((v) => v.early)}</strong>
          </div>
          <div>
            <small>Not Checked In Today</small>
            <strong>{count((v) => v.status === "No Punch")}</strong>
          </div>
        </div>
        <p className="muted">
          Live attendance status · {shortDate(now || new Date())}. No punch does
          not necessarily mean absent (leave and scheduled rest days are
          excluded from automatic conclusions).
        </p>
      </Section>
      <div className={"dashRow" + (showKitchen ? "" : " noSide")}>
        <div className="dashMain">
          <WorkforceAnalytics settings={settings} />
          <Section
            title="Employee Attendance Monitor"
            action={
              <button className="secondary small" onClick={onEmployees}>
                Manage Employees
              </button>
            }
          >
            <input
              className="adminEmployeeSearch"
              aria-label="Search employees"
              placeholder="Search employees"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <TableTools>
              <div className="dataScroll">
                <table>
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th>Status</th>
                      <th>First Check In</th>
                      <th>Last Check Out</th>
                      <th>Net Hours</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map(({ e, relevant, net, status }) => (
                      <tr key={String(e.id)}>
                        <td>{String(e.name || "—")}</td>
                        <td>{status}</td>
                        <td>{stamp(relevant[0]?.check_in, timeMode)}</td>
                        <td>
                          {stamp(
                            [...relevant]
                              .reverse()
                              .find((s) => s.check_out && !s.missed_checkout)
                              ?.check_out,
                            timeMode,
                          )}
                        </td>
                        <td>{minsLabel(net)}</td>
                      </tr>
                    ))}
                    {!visible.length && (
                      <tr>
                        <td colSpan={5}>No employees found.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </TableTools>
          </Section>
        </div>
        {showKitchen && (
          <div className="dashSide">
            <KitchenStaffActivity people={kitchen} show={showKitchenPart} />
          </div>
        )}
      </div>
    </>
  );
}

export default function Dashboard() {
  const [access, setAccess] = useState<{
    pages: string[];
    sidebarEnabled: boolean;
    uiVisibility: Visibility;
    scope?: string;
  }>({
    uiVisibility: {},
    pages: [],
    sidebarEnabled: false,
  });
  const [loaded, setLoaded] = useState(false);
  const [roles, setRoles] = useState<Row[]>([]),
    [allowRegistration, setAllowRegistration] = useState(true),
    [registrationEnabled, setRegistrationEnabled] = useState(false);
  const [roleOptions, setRoleOptions] = useState<Row[]>([]);
  const [endedMsg, setEndedMsg] = useState("");
  useEffect(() => {
    try {
      const m = sessionStorage.getItem("sessionEndedMsg");
      if (m) {
        sessionStorage.removeItem("sessionEndedMsg");
        setEndedMsg(m);
      }
    } catch {}
  }, []);
  const [pendingMessages, setPendingMessages] = useState<Row[]>([]);
  const [messageList, setMessageList] = useState<Row[]>([]);
  const [messagePeople, setMessagePeople] = useState<Row[]>([]);
  const [messageTitle, setMessageTitle] = useState("");
  const [messageBody, setMessageBody] = useState("");
  const [messageEveryone, setMessageEveryone] = useState(true);
  const [messageSelected, setMessageSelected] = useState<string[]>([]);
  const [exitedEmployees, setExitedEmployees] = useState<Row[]>([]);
  const [displayFullScreen, setDisplayFullScreen] = useState(false);
  const [shifts, setShifts] = useState<Row[]>([]);
  const [adminGroups, setAdminGroups] = useState<Record<string, boolean>>({
    locations: true,
    reports: false,
    configuration: false,
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [flyout, setFlyout] = useState<{ id: string; top: number } | null>(
    null,
  );
  const [profileMenu, setProfileMenu] = useState(false);
  const [selectedDay, setSelectedDay] = useState<string | null>(() =>
    dayKey(new Date()),
  );
  const [employeeLeaves, setEmployeeLeaves] = useState<Row[]>([]);
  const [breakPeriods, setBreakPeriods] = useState<Row[]>([]);
  const [categories, setCategories] = useState<Row[]>([]);
  const [presentEmployees, setPresentEmployees] = useState<Row[]>([]),
    [presenceSearch, setPresenceSearch] = useState(""),
    [presenceBranch, setPresenceBranch] = useState(""),
    [notifications, setNotifications] = useState<Row[]>([]),
    [showNotifications, setShowNotifications] = useState(false),
    [geoLoading, setGeoLoading] = useState(false),
    [holdProgress, setHoldProgress] = useState(0),
    [punchAlert, setPunchAlert] = useState<PunchAlertInfo | null>(null);
  const holdTimer = useRef<number | null>(null);
  const holdStarted = useRef<number>(0);
  const holdTriggered = useRef(false);
  const [user, setUser] = useState<Row | null>(null),
    [ready, setReady] = useState(false),
    [signup, setSignup] = useState(false),
    [pendingAccount, setPendingAccount] = useState(false),
    [changePassword, setChangePassword] = useState(false);
  const [page, setPage] = useState("dashboard"),
    [data, setData] = useState<Snapshot>(empty),
    [form, setForm] = useState<Row>({}),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [now, setNow] = useState<Date | null>(null),
    [month, setMonth] = useState(new Date()),
    [menu, setMenu] = useState(false),
    [modal, setModal] = useState<{
      title: string;
      fields: {
        key: string;
        label: string;
        value: string;
        type?: string;
        options?: { value: string; label: string }[];
      }[];
      resolve: (v: Row | null) => void;
      danger?: boolean;
      message?: string;
      confirmLabel?: string;
    } | null>(null),
    [modalData, setModalData] = useState<Row>({}),
    [requestFilter, setRequestFilter] = useState("all"),
    [showPw, setShowPw] = useState<Record<string, boolean>>({}),
    [employeeForm, setEmployeeForm] = useState<{
      row: Row | null;
      password: string;
    } | null>(null),
    [fence, setFence] = useState<Row | null>(null);
  const refresh = useCallback(async () => {
    const a = await api("access");
    setAccess({
      pages: a.pages || [],
      sidebarEnabled: !!a.sidebarEnabled,
      uiVisibility: a.uiVisibility || {},
      scope: a.scope || "self",
    });
    try {
      if (a.role === "display") {
        const p = await api("presence");
        setPresentEmployees(p.people || []);
        setExitedEmployees(p.exited || []);
        return;
      }
      const safe = (p: Promise<Row>) => p.catch(() => null as Row | null);
      const manager = a.role === "admin" || a.scope === "all";
      const [me, leaves, cats, roleOpts, snap, bp, sh, n, pres] =
        await Promise.all([
          safe(api("me")),
          safe(api("employee-leaves")),
          safe(api("request-categories")),
          manager ? safe(api("role-options")) : Promise.resolve(null),
          api("snapshot"),
          safe(api("break-periods")),
          safe(api("shifts")),
          safe(api("notifications")),
          safe(api("presence")),
        ]);
      if (me?.user)
        setUser((old) =>
          JSON.stringify(old) === JSON.stringify(me.user) ? old : me.user,
        );
      if (leaves) setEmployeeLeaves(leaves.leaves || []);
      if (cats) setCategories(cats.categories || []);
      if (roleOpts) setRoleOptions(roleOpts.roles || []);
      setOffState(snap.offDays, snap.dayOverrides);
      setHoursFormat(snap.settings?.hours_format);
      setData(snap);
      if (bp) setBreakPeriods(bp.periods || []);
      if (sh) setShifts(sh.shifts || []);
      if (n) setNotifications(n.notifications || []);
      if (pres) {
        setPresentEmployees(pres.people || []);
        setExitedEmployees(pres.exited || []);
      }
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => {
    // Any sign-out or switch of account resets permissions to "nothing allowed".
    if (!user) {
      setLoaded(false);
      setAccess({ uiVisibility: {}, pages: [], sidebarEnabled: false });
    }
  }, [user]);
  useEffect(() => {
    const onAttendanceRefresh = () => void refresh();
    window.addEventListener("attendance-data-refresh", onAttendanceRefresh);
    return () =>
      window.removeEventListener(
        "attendance-data-refresh",
        onAttendanceRefresh,
      );
  }, [refresh]);
  const refreshMessages = useCallback(async () => {
    try {
      const r = await api("admin-messages-pending");
      setPendingMessages(r.messages || []);
    } catch {}
  }, []);
  useEffect(() => {
    if (!user || changePassword || user.role === "display") return;
    void refreshMessages();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void refreshMessages();
    }, 30000);
    const onFocus = () => void refreshMessages();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [user, changePassword, refreshMessages]);
  const loadAdminMessages = async () => {
    try {
      const r = await api("admin-messages");
      setMessageList(r.messages || []);
      setMessagePeople(r.people || []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Unable to load messages");
    }
  };
  const run = async (
    fn: () => Promise<unknown>,
    message = "Saved successfully",
  ) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const out = await fn();
      toast.success(typeof out === "string" && out ? out : message, {
        duration: 3200,
      });
      if (user) await refresh();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (message === "ACCOUNT_PENDING") {
        setPendingAccount(true);
        setSignup(false);
      } else toast.error(message, { duration: 4800 });
    } finally {
      setBusy(false);
    }
  };
  const ask = (
    title: string,
    fields: {
      key: string;
      label: string;
      value: string;
      type?: string;
      options?: { value: string; label: string }[];
    }[] = [],
    danger = false,
    opts: { message?: string; confirmLabel?: string } = {},
  ) =>
    new Promise<Row | null>((resolve) => {
      setModal({ title, fields, resolve, danger, ...opts });
      setModalData(Object.fromEntries(fields.map((f) => [f.key, f.value])));
    });
  useEffect(() => {
    if (page !== "employees") setEmployeeForm(null);
  }, [page]);
  useEffect(() => {
    // Entering a page opens the sidebar section that contains it (and closes the others).
    const g = SIDE_GROUP_OF[page];
    setAdminGroups({
      locations: g === "locations",
      reports: g === "reports",
      configuration: g === "configuration",
    });
    setFlyout(null);
    setProfileMenu(false);
  }, [page]);
  useEffect(() => {
    if (!sidebarCollapsed) setFlyout(null);
  }, [sidebarCollapsed]);
  useEffect(() => {
    if (!profileMenu) return;
    const close = (e: MouseEvent) => {
      if ((e.target as HTMLElement | null)?.closest(".profileMenuWrap")) return;
      setProfileMenu(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setProfileMenu(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", key);
    };
  }, [profileMenu]);
  useEffect(() => {
    if (!flyout) return;
    // Any click outside the pop-up menu (or Esc) closes it; clicking another group icon switches to it.
    const close = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest(".sideFlyout") || t?.closest(".sideGroupToggle")) return;
      setFlyout(null);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFlyout(null);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", key);
    };
  }, [flyout]);
  const dismiss = (v: Row | null) => {
    modal?.resolve(v);
    setModal(null);
  };
  useEffect(() => {
    const regCheck = api("registration-status")
      .then((r) => setRegistrationEnabled(r.enabled === true))
      .catch(() => setRegistrationEnabled(false));
    if ("serviceWorker" in navigator)
      void navigator.serviceWorker.register("/sw.js").catch(() => {});
    const meCheck = api("me")
      .then((r) => {
        setUser(r.user);
        setChangePassword(!!r.user?.must_change_password);
      })
      .catch(() => {});
    // Show nothing until both answers are known, so no control flashes and disappears.
    void Promise.allSettled([regCheck, meCheck]).then(() => setReady(true));
    setNow(new Date());
  }, []);
  useEffect(() => {
    // A one-second tick re-renders the whole page, so it only runs where a live clock is visible.
    const ms = ["dashboard", "punch", "onsite", "history"].includes(page)
      ? 1000
      : 30000;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") setNow(new Date());
    }, ms);
    return () => clearInterval(timer);
  }, [page]);
  useEffect(() => {
    if (!user || changePassword) return;
    let alive = true,
      known: number | null = null,
      checking = false;
    const check = async () => {
      if (checking || document.visibilityState !== "visible") return;
      checking = true;
      try {
        const v = await api("version");
        const n = Number(v.version || 0);
        if (!alive) return;
        if (known !== null && n !== known) {
          known = n;
          void refreshMessages();
          await refresh().catch(() => {});
        } else known = n;
      } catch {
      } finally {
        checking = false;
      }
    };
    void (async () => {
      try {
        known = Number((await api("version")).version || 0);
      } catch {}
      await refresh().catch((e) => {
        setError(String(e));
        setLoaded(true);
      });
    })();
    const timer = setInterval(() => void check(), 4000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("pageshow", onVisible);
    window.addEventListener("online", onVisible);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("pageshow", onVisible);
      window.removeEventListener("online", onVisible);
    };
  }, [user, changePassword, refresh, refreshMessages]);
  const visibility = access.uiVisibility;
  const show = (key: string) => isFull || isVisible(visibility, key);
  const settings = data.settings || {};
  const isFull = user?.role === "admin";
  const isAdmin = isFull || access.scope === "all";
  const can = (id: string) =>
    id === "points" && !isFull && !settings.points_enabled
      ? false
      : isFull
        ? !["punch", "history"].includes(id)
        : access.pages.includes(id);
  const showSidebar = access.sidebarEnabled;
  useEffect(() => {
    const h = (e: Event) => {
      try {
        sessionStorage.setItem(
          "sessionEndedMsg",
          String((e as CustomEvent).detail || "Your session ended."),
        );
      } catch {}
      window.location.reload();
    };
    window.addEventListener("session-ended", h);
    return () => window.removeEventListener("session-ended", h);
  }, []);
  useEffect(() => {
    if (page === "permissions" && isFull)
      void api("roles")
        .then((r) => {
          setRoles(r.roles || []);
          setAllowRegistration(r.allowRegistration !== false);
        })
        .catch(() => {});
  }, [page, isFull]);
  useEffect(() => {
    document.documentElement.lang = "en";
    document.documentElement.dir = "ltr";
    document.title = settings.site_name || "Attendance System";
    if (settings.icon) {
      let favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
      if (!favicon) {
        favicon = document.createElement("link");
        favicon.rel = "icon";
        document.head.appendChild(favicon);
      }
      favicon.href = settings.icon;
    }
  }, [settings.icon, settings.site_name]);
  const timeMode = String(settings.time_format || "12");
  const sessions = data.sessions.filter((s) => s.employee_id === user?.id);
  const today = now ? dayKey(now) : "";
  const todaySessions = sessions
    .filter(
      (s) =>
        dayKey(s.check_in) === today ||
        (!s.check_out &&
          !!user?.variable_overnight_shift &&
          new Date(s.check_in).getTime() < Date.now()),
    )
    .sort(
      (a, b) => new Date(a.check_in).getTime() - new Date(b.check_in).getTime(),
    );
  const active = sessions.find(
    (s) =>
      !s.check_out &&
      (user?.variable_overnight_shift || dayKey(s.check_in) === today),
  );
  const workedMinutes = todaySessions.reduce(
    (sum, s) => sum + sessionNetMinutes(s, now),
    0,
  );
  const todayBreakMinutes = todaySessions.reduce(
    (total, s) =>
      total +
      (Number(s.break_seconds || 0) +
        (s.break_started_at
          ? Math.max(
              0,
              (new Date(s.check_out || now || Date.now()).getTime() -
                new Date(s.break_started_at).getTime()) /
                1000,
            )
          : 0)) /
        60,
    0,
  );
  const worked = fmtH(workedMinutes, "clock");
  const nav = [
    { id: "dashboard", label: "Dashboard", icon: Home },
    { id: "history", label: "History", icon: Clock3 },
    { id: "onsite", label: "On Site", icon: Users },
    { id: "punch", label: "Punch", icon: Fingerprint },
    { id: "reports", label: "Attendance Report", icon: BarChart3 },
    { id: "overtime-report", label: "Overtime Report", icon: Clock3 },
    { id: "hours-report", label: "Work Hours Report", icon: ClipboardList },
    { id: "points", label: "Points", icon: Award },
    { id: "profile", label: "Profile", icon: UserRound },
    { id: "requests", label: "Requests", icon: ClipboardList },
  ];
  const adminNav = [
    { id: "employees", label: "Employees", icon: Users },
    { id: "devices", label: "Device Security", icon: Fingerprint },
    { id: "activity-log", label: "Activity Log", icon: Clock3 },
    { id: "day-control", label: "Day Control", icon: CalendarDays },
    { id: "branches", label: "Branches", icon: Building2 },
    { id: "shifts", label: "Shifts", icon: Clock3 },
    { id: "geofences", label: "Geofences", icon: MapIcon },
    { id: "failed-attempts", label: "Failed Attempts", icon: MapPin },
    {
      id: "request-categories",
      label: "Request Categories",
      icon: ClipboardList,
    },
    { id: "admin-messages", label: "Announcements", icon: Bell },
    { id: "settings", label: "Site settings", icon: Settings },
    { id: "permissions", label: "Permissions", icon: ShieldCheck },
  ];
  const go = (p: string) => {
    if (!can(p)) return;
    if (p === "history") {
      setSelectedDay(dayKey(new Date()));
      setMonth(new Date());
    } else setSelectedDay(dayKey(new Date()));
    if (p === "admin-messages") void loadAdminMessages();
    setPage(p);
    setMenu(false);
    setShowNotifications(false);
    setError("");
    setNotice("");
  };
  useEffect(() => {
    if (user && !can(page))
      setPage(user.role === "display" ? "onsite" : "dashboard");
  }, [user, page, access.pages]);
  useEffect(() => {
    setMenu(false);
  }, [user?.id]);
  const logout = async () => {
    setPage("dashboard");
    await api("logout", {});
    setUser(null);
    setData(empty);
  };
  const dayStatusOf = (key: string) => {
    const dayAll = sessions.filter((s) => dayKey(s.check_in) === key);
    const records = dayAll.filter(
      (s) => !s.expired_absent && !s.missed_checkout,
    );
    const onlyExpired = dayAll.length > 0 && records.length === 0;
    const leave =
      employeeLeaves.find(
        (l) =>
          String(l.employee_id) === String(user?.id) &&
          key >= String(l.start_date).slice(0, 10) &&
          key <= String(l.end_date).slice(0, 10),
      ) ||
      data.requests.find(
        (q) =>
          String(q.employee_id) === String(user?.id) &&
          q.status === "approved" &&
          q.start_date &&
          q.end_date &&
          key >= String(q.start_date).slice(0, 10) &&
          key <= String(q.end_date).slice(0, 10),
      );
    if (leave) return "leave";
    if (
      !dayAll.length &&
      key < dayKey(now || new Date()) &&
      isOffDay(String(user?.id), key)
    )
      return "off";
    const completed =
      records.length > 0 &&
      records.every((s) => !!s.check_out && !s.missed_checkout);
    const net = records.reduce((v, s) => v + sessionNetMinutes(s, now), 0);
    const stored = records.find(
      (s) => s.required_hours_snapshot != null,
    )?.required_hours_snapshot;
    const raw = stored != null ? stored : user?.required_daily_hours;
    const required =
      raw != null && raw !== "" && Number(raw) > 0 ? Number(raw) * 60 : null;
    const past = key < dayKey(now || new Date());
    if (onlyExpired) return "absent";
    if (records.length) {
      if (!completed)
        return records.some((s) => s.missed_checkout) ||
          (past && !user?.variable_overnight_shift)
          ? "absent"
          : "unrated";
      if (required === null) return "unrated";
      if (net < required - graceMinutes(settings, "early_grace_minutes"))
        return "early";
      if (net > required + graceMinutes(settings, "overtime_grace_minutes"))
        return "overtime";
      return "ontime";
    }
    const accountStart = user?.created_at ? dayKey(user.created_at) : null;
    return past &&
      (!accountStart || key >= accountStart) &&
      user?.required_daily_hours != null &&
      Number(user.required_daily_hours) > 0
      ? "absent"
      : "none";
  };
  const nowHM = () =>
    new Date().toLocaleTimeString("en-GB", {
      timeZone: zone,
      hour: "2-digit",
      minute: "2-digit",
    });
  const punch = async () => {
    if (busy || geoLoading) return;
    if (active?.break_started_at) {
      await run(async () => {
        await api("break", {});
        return "Break ended · " + nowHM();
      }, "Break ended");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    setPunchAlert(null);
    setGeoLoading(true);
    try {
      const pos = await getPunchPosition();
      const r = await api("attendance", {
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      });
      toast.success(
        (r.action === "checkin"
          ? "Check in completed"
          : "Check out completed") +
          " · " +
          nowHM(),
        { duration: 3200 },
      );
      if (r.outside) {
        setPunchAlert(PUNCH_ALERTS.outside_allowed);
        punchToast(PUNCH_ALERTS.outside_allowed);
      }
      if (user) await refresh();
    } catch (e) {
      if (e instanceof Error && e.message === "ACCOUNT_PENDING") {
        setPendingAccount(true);
        setSignup(false);
      } else {
        // GPS problems happen on the device, so report them to Failed Attempts.
        if (e instanceof PunchGeoError)
          void api("attendance-failure-report", { code: e.geoCode }).catch(
            () => {},
          );
        const info = classifyPunchError(e);
        setPunchAlert(info);
        punchToast(info);
        if (typeof navigator !== "undefined") navigator.vibrate?.([80, 60, 80]);
      }
    } finally {
      setGeoLoading(false);
      setBusy(false);
      setHoldProgress(0);
    }
  };
  // ---- Press-and-hold to punch ----
  const holdEnabled =
    (settings.punch_hold_enabled ?? false) && !active?.break_started_at;
  const holdSecs = Math.min(
    15,
    Math.max(1, Number(settings.punch_hold_seconds ?? 3) || 3),
  );
  const cancelHold = (early = false) => {
    if (holdTimer.current !== null) {
      cancelAnimationFrame(holdTimer.current);
      holdTimer.current = null;
    }
    const wasHolding = holdStarted.current > 0 && !holdTriggered.current;
    holdStarted.current = 0;
    if (!holdTriggered.current) setHoldProgress(0);
    if (early && wasHolding)
      toast.info("Keep holding the button until the ring is full", {
        id: "hold-hint",
        duration: 2200,
      });
  };
  const beginHold = () => {
    if (!holdEnabled || busy || geoLoading || holdStarted.current > 0) return;
    holdTriggered.current = false;
    holdStarted.current = performance.now();
    setPunchAlert(null);
    if (typeof navigator !== "undefined") navigator.vibrate?.(15);
    const tick = () => {
      if (holdStarted.current <= 0) return;
      const p = Math.min(
        1,
        (performance.now() - holdStarted.current) / (holdSecs * 1000),
      );
      setHoldProgress(p);
      if (p >= 1) {
        holdTimer.current = null;
        holdTriggered.current = true;
        holdStarted.current = 0;
        if (typeof navigator !== "undefined") navigator.vibrate?.(40);
        void punch();
        return;
      }
      holdTimer.current = requestAnimationFrame(tick);
    };
    holdTimer.current = requestAnimationFrame(tick);
  };
  useEffect(
    () => () => {
      if (holdTimer.current !== null) cancelAnimationFrame(holdTimer.current);
    },
    [],
  );
  useEffect(() => {
    if (page !== "punch") {
      if (holdTimer.current !== null) cancelAnimationFrame(holdTimer.current);
      holdTimer.current = null;
      holdStarted.current = 0;
      holdTriggered.current = false;
      setHoldProgress(0);
      setPunchAlert(null);
    }
  }, [page]);
  const envAlert = usePunchEnvironmentAlert(page === "punch");
  const request = async () => {
    const date = new Date().toISOString().slice(0, 10);
    const kinds = categories.filter((c) => c.active).map((c) => c.name);
    if (!kinds.length) {
      toast.error("No request categories are available");
      return;
    }
    const fields = [
      ...(user?.role === "admin"
        ? [
            {
              key: "employeeId",
              label: "Employee",
              value: "",
              options: [
                { value: "", label: "Select employee" },
                ...data.staff
                  .filter((e) => !["admin", "display"].includes(String(e.role)))
                  .map((e) => ({ value: String(e.id), label: String(e.name) })),
              ],
            },
          ]
        : []),
      {
        key: "kind",
        label: "Request category",
        value: kinds[0],
        options: kinds.map((k) => ({ value: k, label: k })),
      },
      { key: "startDate", label: "Start date", value: date, type: "date" },
      { key: "endDate", label: "End date", value: date, type: "date" },
      { key: "note", label: "Reason / Details", value: "" },
    ];
    const v = await ask(
      user?.role === "admin" ? "Create Request for Employee" : "New request",
      fields,
    );
    if (v)
      await run(
        () => api("request", v),
        user?.role === "admin"
          ? "Employee request created"
          : "Request submitted",
      );
  };
  const edit = async (
    kind: string,
    r: Row,
    fields: {
      key: string;
      label: string;
      value: string;
      type?: string;
      options?: { value: string; label: string }[];
    }[],
  ) => {
    const v = await ask("Edit " + kind, fields);
    if (v)
      await run(
        () => api("manage", { kind, action: "edit", id: r.id, ...v }),
        "Changes saved",
      );
  };
  const remove = async (kind: string, r: Row) => {
    const v = await ask(`Delete ${kind}? This cannot be undone.`, [], true);
    if (v)
      await run(
        () => api("manage", { kind, action: "delete", id: r.id }),
        "Deleted",
      );
  };
  const deleteEmployeePermanently = async (r: Row) => {
    const v = await ask(`Delete Employee — ${r.name}`, [], true, {
      message:
        "Warning: This action will permanently delete this employee and all associated data. This action cannot be undone.",
      confirmLabel: "Confirm Permanent Delete",
    });
    if (v)
      await run(
        () => api("manage", { kind: "employee", action: "delete", id: r.id }),
        "Employee and all associated data permanently deleted",
      );
  };
  const branchChoices = [
    { value: "", label: "Unassigned" },
    ...data.branches.map((b) => ({
      value: String(b.id),
      label: String(b.name),
    })),
  ];
  const shiftChoices = [
    { value: "", label: "Flexible schedule (no fixed shift)" },
    ...shifts.map((sh) => ({
      value: String(sh.id),
      label: `${sh.name} (${String(sh.start_time).slice(0, 5)}–${String(sh.end_time).slice(0, 5)})`,
    })),
  ];
  const roleChoices = roleOptions.length
    ? roleOptions.map((r) => ({
        value: String(r.role),
        label:
          String(r.label || r.role) +
          (r.role === "display" ? " (read-only)" : ""),
      }))
    : [
        { value: "employee", label: "Employee" },
        { value: "admin", label: "Administrator" },
        { value: "display", label: "Display Screen (read-only)" },
      ];
  const empStats = data.employeeStats;
  const statusChoices = [
    { value: "active", label: "Active" },
    { value: "pending", label: "Pending" },
    { value: "suspended", label: "Suspended" },
  ];
  const employeeFields = (r: Row = {}) => [
    { key: "name", label: "Full name", value: r.name || "" },
    { key: "email", label: "Email", value: r.email || "" },
    {
      key: "password",
      label: r.id
        ? "Reset password (leave empty to keep)"
        : "Temporary password (6+ characters)",
      value: "",
      type: "password",
    },
    {
      key: "role",
      label: "Role",
      value: r.role || "employee",
      options: roleChoices,
    },
    {
      key: "status",
      label: "Status",
      value: r.status || "active",
      options: statusChoices,
    },
    {
      key: "branchId",
      label: "Branch",
      value: r.branch_id || "",
      options: branchChoices,
    },
    {
      key: "requiredDailyHours",
      label: "Required daily hours (blank = no target)",
      value:
        r.required_daily_hours == null ? "" : String(r.required_daily_hours),
      type: "number",
    },
    {
      key: "shiftId",
      label: "Assigned shift",
      value: r.shift_id || "",
      options: shiftChoices,
    },
    {
      key: "variableOvernightShift",
      label: "Variable / Overnight Shift (may finish next day)",
      value: r.variable_overnight_shift ? "true" : "false",
      type: "checkbox",
    },
    {
      key: "allowOutsideGeofence",
      label: "Allow Check-in/Check-out Outside Geofence",
      value: r.allow_outside_geofence ? "true" : "false",
      type: "checkbox",
    },
    {
      key: "allowMultipleDevices",
      label: "Allow Multiple Devices (off = one device only)",
      value: r.allow_multiple_devices ? "true" : "false",
      type: "checkbox",
    },
    {
      key: "maxCheckinEnabled",
      label: "Enable Maximum Check-in Duration",
      value: r.max_checkin_enabled ? "true" : "false",
      type: "checkbox",
    },
    {
      key: "maxCheckinHours",
      label: "Maximum Check-in Duration (Hours)",
      value:
        r.max_checkin_hours == null
          ? "15"
          : String(Number(r.max_checkin_hours)),
      type: "number",
    },
  ];
  const editEmployee = async (r: Row) => {
    let current = "";
    try {
      current = (await api("employee-password", { id: r.id })).password || "";
    } catch {
      current = "";
    }
    setEmployeeForm({ row: r, password: current });
  };
  const saveEmployeeForm = async (
    values: Row,
    row: Row | null,
    original: string,
  ) => {
    setBusy(true);
    try {
      if (row) {
        const payload = { ...values };
        if (payload.password === original) delete payload.password;
        await api("manage", {
          kind: "employee",
          action: "edit",
          id: row.id,
          ...payload,
        });
        toast.success("Employee updated");
      } else {
        await api("create-employee", values);
        toast.success("Employee created");
      }
      setEmployeeForm(null);
      if (user) await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e), {
        duration: 4800,
      });
    } finally {
      setBusy(false);
    }
  };
  const toggleEmployee = (r: Row) =>
    run(
      () =>
        api("manage", {
          kind: "employee",
          action: "edit",
          id: r.id,
          name: r.name,
          email: r.email,
          role: r.role,
          status: r.status === "active" ? "suspended" : "active",
          branchId: r.branch_id || "",
          shiftId: r.shift_id || "",
          requiredDailyHours:
            r.required_daily_hours == null ? "" : r.required_daily_hours,
          variableOvernightShift: !!r.variable_overnight_shift,
        }),
      r.status === "active" ? "Employee deactivated" : "Employee activated",
    );
  const uploadEmployeePhoto = async (r: Row, file: File) => {
    const form = new FormData();
    form.append("file", file);
    form.append("employeeId", r.id);
    await run(async () => {
      const resp = await fetch("/api/avatar-upload", {
        method: "POST",
        body: form,
      });
      const result = await resp.json();
      if (!resp.ok) throw Error(result.error || "Photo upload failed");
    }, "Photo updated");
  };
  const opts = (rows: Row[], name = "branchId") => (
    <select
      value={form[name] ?? ""}
      onChange={(e) => setForm((p) => ({ ...p, [name]: e.target.value }))}
    >
      <option value="">Select branch</option>
      {rows.map((r) => (
        <option key={r.id} value={r.id}>
          {r.name}
        </option>
      ))}
    </select>
  );
  if (!ready) return <div className="loading">Loading attendance system…</div>;
  if (!user && pendingAccount)
    return (
      <main className="loginShell">
        <Toaster position="top-center" richColors duration={3500} />
        <div className="loginBanner">
          <Fingerprint size={48} />
          <h1>{settings.site_name || "Attendance System"}</h1>
          <p>Account approval</p>
        </div>
        <section className="loginCard pendingApprovalCard">
          <div className="pendingApprovalIcon">
            <Clock3 size={34} />
          </div>
          <h2>Account Pending Approval</h2>
          <p>
            Your account has been created successfully and is waiting for
            approval from the administrator or authorized manager.
          </p>
          <p className="muted">
            You will be able to sign in once your account has been activated.
            Please contact your administrator if you need assistance.
          </p>
          <button
            className="primary"
            type="button"
            onClick={() => {
              setPendingAccount(false);
              setSignup(false);
              setForm({});
            }}
          >
            Back to Sign In
          </button>
        </section>
      </main>
    );
  if (!user)
    return (
      <main className="loginShell">
        <Toaster position="top-center" richColors duration={3500} />
        <div className="loginBanner">
          <Fingerprint size={48} />
          <h1>{settings.site_name || "Attendance System"}</h1>
          <p>Work smarter, every day.</p>
        </div>
        <form
          className="loginCard"
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              async () => {
                const r = await api(
                  signup ? "register" : "login",
                  signup ? form : { ...form, ...(await getLoginLocation()) },
                );
                if (signup) {
                  setSignup(false);
                  setPendingAccount(true);
                } else {
                  setUser(r.user);
                  setChangePassword(!!r.user.mustChangePassword);
                  setPage(r.user.role === "display" ? "onsite" : "dashboard");
                  setMenu(false);
                  setShowNotifications(false);
                }
              },
              signup ? "Registration sent" : "Signed in",
            );
          }}
        >
          <h2>{signup ? "Create employee account" : "Welcome back"}</h2>
          {endedMsg && (
            <div className="deviceBanner" role="alert">
              <span>{endedMsg}</span>
            </div>
          )}
          {signup && (
            <label>
              Full name
              <input
                required
                value={form.name || ""}
                onChange={(e) =>
                  setForm((p) => ({ ...p, name: e.target.value }))
                }
              />
            </label>
          )}
          <label>
            Email address
            <input
              type="email"
              required
              value={form.email || ""}
              onChange={(e) =>
                setForm((p) => ({ ...p, email: e.target.value }))
              }
            />
          </label>
          <label>
            Password
            <input
              type="password"
              required
              value={form.password || ""}
              onChange={(e) =>
                setForm((p) => ({ ...p, password: e.target.value }))
              }
            />
          </label>
          <button className="primary" disabled={busy}>
            {signup ? "Register" : "Sign in"}
          </button>
          {registrationEnabled && (
            <button
              type="button"
              className="linkButton"
              onClick={() => setSignup((v) => !v)}
            >
              {signup
                ? "Already have an account? Sign in"
                : "Need an account? Register"}
            </button>
          )}
        </form>
      </main>
    );
  if (changePassword)
    return (
      <main className="loginShell">
        <Toaster position="top-center" richColors duration={3500} />
        <form
          className="loginCard"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await api("password", { password: form.newPassword });
              setChangePassword(false);
            }, "Password updated");
          }}
        >
          <h2>Change your temporary password</h2>
          <p>Choose a password of at least 6 characters.</p>
          <input
            type="password"
            minLength={6}
            required
            onChange={(e) =>
              setForm((p) => ({ ...p, newPassword: e.target.value }))
            }
          />
          <button className="primary">Update password</button>
        </form>
      </main>
    );
  const monthPrefix = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`;
  const visibleMonth = sessions.filter((s) =>
    dayKey(s.check_in).startsWith(monthPrefix),
  );
  const uniqueDays = new Set(visibleMonth.map((s) => dayKey(s.check_in)));
  const totalMonthMin = visibleMonth.reduce(
    (sum, s) => sum + sessionNetMinutes(s, now),
    0,
  );
  const monthDays = Array.from(
    {
      length: new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate(),
    },
    (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1),
  );
  if (user.role === "display")
    return (
      <div className="wallboardShell">
        <Toaster position="top-center" />
        <OnSiteWallboard
          people={presentEmployees}
          exited={exitedEmployees}
          now={now}
          siteName="On Site"
          signOut={logout}
          fullscreen={displayFullScreen}
          toggleFullscreen={() => setDisplayFullScreen((v) => !v)}
        />
      </div>
    );
  if (!loaded) return <div className="loading">Loading attendance system…</div>;
  // Standalone links at the top; Profile lives in the header and at the bottom of the sidebar.
  const topIds = [
    "dashboard",
    "onsite",
    "punch",
    ...(isAdmin ? [] : ["requests"]),
  ];
  const allNav = [...nav, ...adminNav];
  const sideGroups: {
    id: string;
    label: string;
    icon: typeof Users;
    items: { id: string; label: string; icon: typeof Users }[];
  }[] = SIDE_GROUP_DEFS.map((g) => ({
    id: g.id,
    label: g.label,
    icon: g.icon,
    items: allNav.filter(
      (n) => g.ids.includes(n.id) && can(n.id) && !topIds.includes(n.id),
    ),
  })).filter((g) => g.items.length > 0);
  const toggleGroup = (id: string, el: HTMLElement) => {
    if (sidebarCollapsed && window.matchMedia("(min-width: 801px)").matches) {
      const top = Math.max(
        8,
        Math.min(el.getBoundingClientRect().top, window.innerHeight - 80),
      );
      setFlyout((f) => (f?.id === id ? null : { id, top }));
      return;
    }
    setAdminGroups((v) => ({
      locations: false,
      reports: false,
      configuration: false,
      [id]: !v[id],
    }));
  };
  return (
    <div
      className={
        "appShell " +
        (!showSidebar ? "noSidebar" : "") +
        (sidebarCollapsed ? " sidebarCollapsed" : "")
      }
    >
      <Toaster position="top-center" richColors duration={3500} />
      {menu && showSidebar && (
        <div className="sidebarScrim" onClick={() => setMenu(false)} />
      )}
      <aside
        className={
          "desktopSidebar " + (menu && showSidebar ? "mobileOpen" : "")
        }
      >
        <div className="brand">
          <Fingerprint />
          <strong>{settings.site_name || "Attendance System"}</strong>
        </div>
        {topIds.map((id) => {
          const n = nav.find((x) => x.id === id);
          return n && can(id) ? (
            <button
              key={id}
              title={n.label}
              className={"sideNav " + (page === id ? "isActive" : "")}
              onClick={() => {
                setFlyout(null);
                go(id);
              }}
            >
              <n.icon size={19} />
              {n.label}
            </button>
          ) : null;
        })}
        {sideGroups.map((g) => (
          <div className="sideGroup" key={g.id}>
            <button
              title={g.label}
              className={
                "sideGroupToggle" +
                (g.items.some((x) => x.id === page) ? " hasActive" : "")
              }
              onClick={(e) => toggleGroup(g.id, e.currentTarget)}
            >
              <g.icon size={17} />
              {g.label}
              {g.id === "locations" && Number(data.deviceAlerts || 0) > 0 && (
                <span className="navBadge navBadgeDot">
                  {data.deviceAlerts}
                </span>
              )}
              {adminGroups[g.id] ? (
                <ChevronDown size={15} />
              ) : (
                <ChevronRight size={15} />
              )}
            </button>
            {adminGroups[g.id] &&
              g.items.map((n) => (
                <button
                  key={n.id}
                  title={n.label}
                  className={
                    "sideNav nested " + (page === n.id ? "isActive" : "")
                  }
                  onClick={() => go(n.id)}
                >
                  <n.icon size={18} />
                  {n.label}
                  {n.id === "devices" && Number(data.deviceAlerts || 0) > 0 && (
                    <span className="navBadge">{data.deviceAlerts}</span>
                  )}
                </button>
              ))}
          </div>
        ))}
      </aside>
      {flyout &&
        showSidebar &&
        (() => {
          const g = sideGroups.find((x) => x.id === flyout.id);
          if (!g) return null;
          return (
            <div className="sideFlyout" style={{ top: flyout.top }} role="menu">
              <h4>{g.label}</h4>
              {g.items.map((n) => (
                <button
                  key={n.id}
                  role="menuitem"
                  className={"sideNav " + (page === n.id ? "isActive" : "")}
                  onClick={() => {
                    setFlyout(null);
                    go(n.id);
                  }}
                >
                  <n.icon size={18} />
                  {n.label}
                  {n.id === "devices" && Number(data.deviceAlerts || 0) > 0 && (
                    <span className="navBadge">{data.deviceAlerts}</span>
                  )}
                </button>
              ))}
            </div>
          );
        })()}
      <div className="appBody">
        <header className="appHeader stickyHeader">
          <div className="headerLeft">
            {showSidebar && show("header.menu") && (
              <IconButton
                onClick={() => {
                  if (window.matchMedia("(max-width: 800px)").matches) {
                    setMenu((v) => !v);
                  } else {
                    setSidebarCollapsed((v) => !v);
                  }
                }}
              >
                <Menu />
              </IconButton>
            )}
            {show("header.title") && (
              <div>
                {page === "dashboard" ? (
                  <>
                    <h1>
                      {isAdmin
                        ? "Workforce Dashboard"
                        : `Good Morning, ${String(user.name || "there").split(" ")[0]}! 👋`}
                    </h1>
                    <small>
                      {isAdmin
                        ? "Monitor employee attendance and workforce reports."
                        : "Have a productive day ahead."}
                    </small>
                  </>
                ) : (
                  <h1>
                    {[...nav, ...adminNav].find((n) => n.id === page)?.label ||
                      "Attendance"}
                  </h1>
                )}
              </div>
            )}
          </div>
          <div className="headerActions">
            {can("requests") && show("header.requests") && (
              <IconButton onClick={() => go("requests")}>
                <ClipboardList />
              </IconButton>
            )}
            {show("header.notifications") && (
              <IconButton
                onClick={() => {
                  setProfileMenu(false);
                  setShowNotifications((v) => !v);
                }}
              >
                <Bell />
                {notifications.some((n) => !n.read_at) ? "•" : ""}
              </IconButton>
            )}
            {show("header.profile") ? (
              <div className="profileMenuWrap">
                <button
                  type="button"
                  className="profileChip"
                  title="Account"
                  aria-haspopup="menu"
                  aria-expanded={profileMenu}
                  onClick={() => {
                    setShowNotifications(false);
                    setProfileMenu((v) => !v);
                  }}
                >
                  <span className="miniAvatar">
                    {user.avatar ? (
                      <img src={String(user.avatar)} alt="" />
                    ) : (
                      String(user.name || "?")
                        .split(/\s+/)
                        .filter(Boolean)
                        .slice(0, 2)
                        .map((x: string) => x[0]?.toUpperCase())
                        .join("")
                    )}
                  </span>
                  <span className="profileChipName">
                    {String(user.name || "")}
                  </span>
                  <ChevronDown size={14} />
                </button>
                {profileMenu && (
                  <div className="profileMenu" role="menu">
                    {can("profile") && (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setProfileMenu(false);
                          go("profile");
                        }}
                      >
                        <UserRound size={16} /> Profile
                      </button>
                    )}
                    <button
                      type="button"
                      role="menuitem"
                      className="danger"
                      onClick={() => {
                        setProfileMenu(false);
                        void logout();
                      }}
                    >
                      <LogOut size={16} /> Sign out
                    </button>
                  </div>
                )}
              </div>
            ) : (
              // Only if neither the account menu nor the Profile page is available, so nobody is locked in.
              !can("profile") && (
                <IconButton onClick={() => void logout()}>
                  <LogOut />
                </IconButton>
              )
            )}
          </div>
        </header>
        {showNotifications && (
          <>
            <div
              className="notificationsDismiss"
              onClick={() => setShowNotifications(false)}
              aria-hidden="true"
            />
            <div className="notificationPanel">
              <div className="sectionHead">
                <strong>Notifications</strong>
                <button
                  className="secondary small"
                  onClick={() => {
                    setNotifications([]);
                    void api("notifications-read", {}).then(() => refresh());
                    setShowNotifications(false);
                  }}
                >
                  Mark all read
                </button>
              </div>
              {notifications.map((n) => (
                <div
                  key={n.id}
                  className="notificationItem"
                  role="button"
                  tabIndex={0}
                  title="Tap to mark as read"
                  onClick={() => {
                    setNotifications((old) => old.filter((x) => x.id !== n.id));
                    void api("notifications-read", { id: n.id }).catch(
                      () => {},
                    );
                  }}
                >
                  <strong>{n.title}</strong>
                  <p>{n.message}</p>
                </div>
              ))}
              {!notifications.length && <p>No notifications yet.</p>}
            </div>
          </>
        )}
        <main className="screen">
          {pendingMessages.length > 0 && (
            <div className="modalBackdrop announcementBackdrop">
              <section
                className={
                  "dialog announcementDialog kind-" +
                  String(pendingMessages[0].kind || "notice")
                }
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="announcement-heading"
              >
                <div className="announcementSymbol">
                  <KindIcon kind={pendingMessages[0].kind} size={30} />
                </div>
                <h2 id="announcement-heading">{pendingMessages[0].title}</h2>
                <p className="announcementContent">{pendingMessages[0].body}</p>
                <small>
                  Official announcement ·{" "}
                  {kindMeta(pendingMessages[0].kind).label} · Please confirm
                  that you have read this message.
                </small>
                <button
                  className="primary"
                  onClick={() =>
                    void run(async () => {
                      await api("admin-messages-ack", {
                        id: pendingMessages[0].id,
                      });
                      await refreshMessages();
                      await api("notifications").then((r) =>
                        setNotifications(r.notifications || []),
                      );
                    }, "Read confirmed")
                  }
                >
                  I have read and understood
                </button>
              </section>
            </div>
          )}
          {page === "dashboard" &&
            (isAdmin ? (
              <>
                {Number(data.deviceAlerts || 0) > 0 && can("devices") && (
                  <div className="deviceBanner" role="alert">
                    <span>
                      ⚠ {data.deviceAlerts} device alert
                      {Number(data.deviceAlerts) > 1 ? "s" : ""}: an employee
                      tried to use their account from another device.
                    </span>
                    <button
                      className="primary small"
                      onClick={() => go("devices")}
                    >
                      Review
                    </button>
                  </div>
                )}
                <AdminWorkforceDashboard
                  staff={data.staff}
                  sessions={data.sessions}
                  kitchen={data.kitchen || []}
                  now={now}
                  timeMode={timeMode}
                  settings={settings}
                  showKitchen={show("dashboard.kitchen")}
                  showKitchenPart={show}
                  onReports={() => go("reports")}
                  onEmployees={() => go("employees")}
                />
              </>
            ) : (
              <>
                {show("dashboard.status") && (
                  <div className="statusCard">
                    <div className="statusHead">
                      <strong>Today&apos;s Status</strong>
                      <small>{now ? shortDate(now) : "—"}</small>
                    </div>
                    <div className="statusRow">
                      <div>
                        {show("dashboard.status.checkIn") && (
                          <>
                            <small>Check In</small>
                            <b className="greenText">
                              {stamp(todaySessions[0]?.check_in, timeMode)}
                            </b>
                          </>
                        )}
                      </div>
                      <div className="progressRing">
                        <div>
                          {show("dashboard.status.netHours") && (
                            <>
                              <small>Net Hours</small>
                              <b>{worked}</b>
                              <small>Hrs</small>
                            </>
                          )}
                        </div>
                      </div>
                      <div>
                        {show("dashboard.status.checkOut") && (
                          <>
                            <small>Check Out</small>
                            <b>
                              {stamp(
                                [...todaySessions]
                                  .reverse()
                                  .find(
                                    (s) => s.check_out && !s.missed_checkout,
                                  )?.check_out,
                                timeMode,
                              )}
                            </b>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                )}
                {show("dashboard.metrics") && (
                  <div className="metricFour">
                    {show("dashboard.metrics.punchIn") && (
                      <div>
                        <CalendarCheck color="#6256ea" />
                        <small>Punch In</small>
                        <b>{stamp(todaySessions[0]?.check_in, timeMode)}</b>
                      </div>
                    )}
                    {show("dashboard.metrics.punchOut") && (
                      <div>
                        <DoorOpen color="#f59e0b" />
                        <small>Punch Out</small>
                        <b>
                          {stamp(
                            [...todaySessions]
                              .reverse()
                              .find((s) => s.check_out && !s.missed_checkout)
                              ?.check_out,
                            timeMode,
                          )}
                        </b>
                      </div>
                    )}
                    {show("dashboard.metrics.break") && (
                      <div>
                        <Coffee color="#2484d7" />
                        <small>Break</small>
                        <b>{minsLabel(todayBreakMinutes)}</b>
                      </div>
                    )}
                    {show("dashboard.metrics.hours") && (
                      <div>
                        <Clock3 color="#02a86b" />
                        <small>Total Hours</small>
                        <b>{worked}</b>
                      </div>
                    )}
                  </div>
                )}
                {!isAdmin && !!settings.points_enabled && show("dashboard.points") && (
                  <PointsCards
                    api={api}
                    version={data.version}
                    canOpen={can("points")}
                    onOpen={() => go("points")}
                  />
                )}
                {show("dashboard.overview") && (
                  <Section
                    title="Attendance Overview"
                    action={
                      <button
                        className="textLink"
                        onClick={() => go("history")}
                      >
                        View Calendar
                      </button>
                    }
                  >
                    <div className="weekStrip">
                      {Array.from({ length: 6 }, (_, i) => {
                        const d = new Date();
                        d.setDate(d.getDate() - 5 + i);
                        const key = dayKey(d);
                        const st = dayStatusOf(key);
                        const mk: Record<string, string> = {
                          ontime: "✓",
                          early: "✓",
                          overtime: "✓",
                          leave: "L",
                          off: "O",
                          absent: "✕",
                          unrated: "•",
                          none: "−",
                        };
                        const nm: Record<string, string> = {
                          ontime: "On time",
                          early: "Left early",
                          overtime: "Overtime",
                          leave: "Leave",
                          off: "Off day",
                          absent: "Absent",
                          unrated: "In progress / no target",
                          none: "No record",
                        };
                        return (
                          <div
                            key={i}
                            className={
                              key === dayKey(now || new Date())
                                ? "weekToday"
                                : ""
                            }
                          >
                            <small>
                              {new Intl.DateTimeFormat("en", {
                                weekday: "short",
                              }).format(d)}
                            </small>
                            <b>{d.getDate()}</b>
                            <span
                              className={"wkMark wk-" + st}
                              title={nm[st]}
                              aria-label={nm[st]}
                            >
                              {mk[st]}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </Section>
                )}
                {show("dashboard.activities") && (
                  <Section
                    title="Recent Activities"
                    action={
                      <button
                        className="textLink"
                        onClick={() => go("history")}
                      >
                        View All
                      </button>
                    }
                  >
                    <Activity
                      sessions={sessions.slice(0, 5)}
                      timeMode={timeMode}
                    />
                  </Section>
                )}
                {show("dashboard.kitchen") && !!active && (
                  <KitchenStaffActivity
                    people={data.kitchen || []}
                    show={show}
                  />
                )}{" "}
              </>
            ))}
          {page === "onsite" && can("onsite") && (
            <OnSiteWallboard
              people={presentEmployees}
              exited={exitedEmployees}
              now={now}
              siteName={String(settings.site_name || "Attendance System")}
              signOut={logout}
              fullscreen={displayFullScreen}
              toggleFullscreen={() => setDisplayFullScreen((v) => !v)}
            />
          )}
          {page === "history" && can("history") && (
            <>
              {show("history.calendar") && (
                <Section title="Attendance Calendar">
                  <div className="monthSwitcher">
                    <IconButton
                      onClick={() =>
                        setMonth(
                          (d) => new Date(d.getFullYear(), d.getMonth() - 1, 1),
                        )
                      }
                    >
                      <ChevronLeft />
                    </IconButton>
                    <strong>
                      {new Intl.DateTimeFormat("en", {
                        month: "long",
                        year: "numeric",
                      }).format(month)}
                    </strong>
                    <IconButton
                      onClick={() =>
                        setMonth(
                          (d) => new Date(d.getFullYear(), d.getMonth() + 1, 1),
                        )
                      }
                    >
                      <ChevronRight />
                    </IconButton>
                  </div>
                  <div className="calendarGrid">
                    {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(
                      (x) => (
                        <small key={x}>{x}</small>
                      ),
                    )}
                    {Array.from(
                      {
                        length:
                          (new Date(
                            month.getFullYear(),
                            month.getMonth(),
                            1,
                          ).getDay() +
                            6) %
                          7,
                      },
                      (_, i) => (
                        <i key={"p" + i} />
                      ),
                    )}
                    {monthDays.map((d) => {
                      const key = dayKey(d);
                      const dayAll = sessions.filter(
                        (s) => dayKey(s.check_in) === key,
                      );
                      const records = dayAll.filter(
                        (s) => !s.expired_absent && !s.missed_checkout,
                      );
                      const leave =
                        employeeLeaves.find(
                          (l) =>
                            String(l.employee_id) === String(user.id) &&
                            key >= String(l.start_date).slice(0, 10) &&
                            key <= String(l.end_date).slice(0, 10),
                        ) ||
                        data.requests.find(
                          (q) =>
                            String(q.employee_id) === String(user.id) &&
                            q.status === "approved" &&
                            q.start_date &&
                            q.end_date &&
                            key >= String(q.start_date).slice(0, 10) &&
                            key <= String(q.end_date).slice(0, 10),
                        );
                      const completed =
                        records.length > 0 &&
                        records.every(
                          (s) => !!s.check_out && !s.missed_checkout,
                        );
                      const net = records.reduce(
                        (v, s) => v + sessionNetMinutes(s, now),
                        0,
                      );
                      const storedHours = records.find(
                        (s) => s.required_hours_snapshot != null,
                      )?.required_hours_snapshot;
                      const rawRequired =
                        storedHours != null
                          ? storedHours
                          : user.required_daily_hours;
                      const required =
                        rawRequired != null &&
                        rawRequired !== "" &&
                        Number(rawRequired) > 0
                          ? Number(rawRequired) * 60
                          : null;
                      const early =
                        completed &&
                        required !== null &&
                        net <
                          required -
                            graceMinutes(settings, "early_grace_minutes");
                      const over =
                        completed &&
                        required !== null &&
                        net >
                          required +
                            graceMinutes(settings, "overtime_grace_minutes");
                      const accountStart = user.created_at
                        ? dayKey(user.created_at)
                        : null;
                      const past = key < today;
                      const mayMarkAbsent =
                        !accountStart || key >= accountStart;
                      const status = leave
                        ? "leave"
                        : dayAll.length === 0 &&
                            past &&
                            isOffDay(String(user.id), key)
                          ? "off"
                          : dayAll.length > 0 && records.length === 0
                            ? "absent"
                            : records.length
                              ? !completed
                                ? records.some((s) => s.missed_checkout) ||
                                  (past && !user.variable_overnight_shift)
                                  ? "absent"
                                  : "unrated"
                                : early
                                  ? "early"
                                  : over
                                    ? "overtime"
                                    : required === null
                                      ? "unrated"
                                      : "ontime"
                              : past &&
                                  mayMarkAbsent &&
                                  user.required_daily_hours != null &&
                                  Number(user.required_daily_hours) > 0
                                ? "absent"
                                : "none";
                      return (
                        <button
                          type="button"
                          key={key}
                          aria-label={"View " + key + " attendance"}
                          onClick={() => setSelectedDay(key)}
                          className={
                            "calendarDay " +
                            (selectedDay === key ? "selectedCalendar " : "")
                          }
                        >
                          <span>{d.getDate()}</span>
                          {status !== "none" && (
                            <em className={"statusDot " + status} />
                          )}
                        </button>
                      );
                    })}
                  </div>
                  {show("history.legend") && (
                    <div className="calendarLegend">
                      <span>
                        <i className="statusDot ontime" /> On time
                      </span>
                      <span>
                        <i className="statusDot early" /> Early left
                      </span>
                      <span>
                        <i className="statusDot overtime" /> Overtime
                      </span>
                      <span>
                        <i className="statusDot absent" /> Absent
                      </span>
                      <span>
                        <i className="statusDot leave" /> Leave
                      </span>
                      <span>
                        <i className="statusDot off" /> Off day
                      </span>
                    </div>
                  )}
                </Section>
              )}
              {show("history.events") && (
                <Section title="Attendance History">
                  {selectedDay ? (
                    <EmployeeAttendanceReport
                      sessions={sessions.filter(
                        (s) => dayKey(s.check_in) === selectedDay,
                      )}
                      now={now}
                      timeMode={timeMode}
                      breakPeriods={breakPeriods}
                      visibility={visibility}
                    />
                  ) : (
                    <p className="muted">
                      Select a date from the calendar to view attendance events.
                    </p>
                  )}
                </Section>
              )}
              <p className="timezoneNote">
                Overnight shifts belong to their check-in day. Recorded
                attendance and leave can be shown before account creation.
                Automatic absences begin no earlier than account creation and
                require configured work hours.
              </p>
            </>
          )}
          {page === "punch" && can("punch") && (
            <Section title="Clock In / Clock Out">
              <div className="punchPanel">
                <div className="liveTime">
                  {now
                    ? new Intl.DateTimeFormat("en-US", {
                        timeZone: zone,
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                        hour12: timeMode === "12",
                      }).format(now)
                    : "--:--"}
                </div>
                <p>Doha time · {now ? shortDate(now) : "—"}</p>
                {(punchAlert || envAlert) && (
                  <PunchAlertCard
                    alert={(punchAlert || envAlert) as PunchAlertInfo}
                    onClose={punchAlert ? () => setPunchAlert(null) : undefined}
                  />
                )}
                <div
                  className={
                    "punchHoldWrap" +
                    (holdEnabled ? " hasHold" : "") +
                    (holdProgress > 0 ? " isHolding" : "") +
                    (active?.break_started_at
                      ? " isBreak"
                      : active
                        ? " isOut"
                        : "")
                  }
                >
                  {holdEnabled && (
                    <svg
                      className="punchHoldRing"
                      viewBox="0 0 100 100"
                      aria-hidden="true"
                    >
                      <circle className="track" cx="50" cy="50" r="46" />
                      <circle
                        className="progress"
                        cx="50"
                        cy="50"
                        r="46"
                        style={{ strokeDashoffset: 289 - 289 * holdProgress }}
                      />
                    </svg>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={
                      holdEnabled
                        ? `Press and hold for ${holdSecs} seconds to ${active ? "check out" : "check in"}`
                        : active?.break_started_at
                          ? "End break"
                          : active
                            ? "Check out"
                            : "Check in"
                    }
                    onClick={() => {
                      if (!holdEnabled) void punch();
                    }}
                    onPointerDown={(e) => {
                      if (e.pointerType === "mouse" && e.button !== 0) return;
                      beginHold();
                    }}
                    onPointerUp={() => cancelHold(true)}
                    onPointerLeave={() => cancelHold(true)}
                    onPointerCancel={() => cancelHold(true)}
                    onKeyDown={(e) => {
                      if (holdEnabled && (e.key === " " || e.key === "Enter")) {
                        e.preventDefault();
                        if (!e.repeat) beginHold();
                      }
                    }}
                    onKeyUp={(e) => {
                      if (holdEnabled && (e.key === " " || e.key === "Enter"))
                        cancelHold(true);
                    }}
                    onContextMenu={(e) => e.preventDefault()}
                    className={
                      "bigPunch " +
                      (active?.break_started_at
                        ? "punchOnBreak"
                        : active
                          ? "punchOut"
                          : "")
                    }
                  >
                    {geoLoading ? (
                      <LoaderCircle className="spin" size={50} />
                    ) : (
                      <Fingerprint size={72} strokeWidth={1.6} />
                    )}
                  </button>
                </div>
                <div className="holdHint" aria-live="polite">
                  {geoLoading
                    ? "Verifying your location…"
                    : holdEnabled && holdProgress > 0
                      ? `Keep holding… ${Math.max(0, holdSecs * (1 - holdProgress)).toFixed(1)}s`
                      : holdEnabled
                        ? `Press and hold for ${holdSecs}s`
                        : ""}
                </div>
                <div className="punchActionLabel">
                  {active?.break_started_at
                    ? "BREAK"
                    : active
                      ? "CHECK OUT"
                      : "CHECK IN"}
                </div>
                <strong>
                  {active?.break_started_at
                    ? "You are on break — tap to end your break"
                    : active
                      ? "Your shift is in progress"
                      : "Ready for your next shift"}
                </strong>
                {show("punch.break") && (
                  <button
                    type="button"
                    className={
                      "secondary breakButton " +
                      (active?.break_started_at ? "breakIsActive" : "")
                    }
                    disabled={busy || !active}
                    onClick={() =>
                      void run(async () => {
                        const r = await api("break", {});
                        return (
                          (r.action === "break-start"
                            ? "Break started"
                            : "Break ended") +
                          " · " +
                          nowHM()
                        );
                      }, "Break saved")
                    }
                  >
                    <Coffee size={19} />
                    {active?.break_started_at ? "End Break" : "Start Break"}
                  </button>
                )}
                <p>
                  Breaks are deducted from net working hours. GPS is verified
                  for check-in and check-out.
                </p>
              </div>
            </Section>
          )}
          {page === "overtime-report" && can("overtime-report") && (
            <MonthlyAttendanceReport
              mode="overtime"
              isAdmin={!!isAdmin}
              staff={data.staff}
              branches={data.branches}
            />
          )}
          {page === "hours-report" && can("hours-report") && (
            <MonthlyAttendanceReport
              mode="summary"
              isAdmin={!!isAdmin}
              staff={data.staff}
              branches={data.branches}
            />
          )}
          {page === "reports" &&
            can("reports") &&
            (isAdmin ? (
              <>
                <MonthlyAttendanceReport
                  isAdmin={!!isAdmin}
                  staff={data.staff}
                  branches={data.branches}
                />
                <Section title="Workforce Attendance Overview">
                  <p className="muted">
                    Review all employees and choose the reporting period using
                    the monthly report above. The detailed sessions table below
                    includes all employees.
                  </p>
                </Section>
                <Section
                  title="Session Details"
                  action={
                    isAdmin ? (
                      <button
                        className="primary small"
                        onClick={async () => {
                          const v = await ask("Add missed attendance", [
                            {
                              key: "employeeId",
                              label: "Employee",
                              value: "",
                              options: [
                                { value: "", label: "Select employee" },
                                ...data.staff.map((e) => ({
                                  value: String(e.id),
                                  label: String(e.name),
                                })),
                              ],
                            },
                            {
                              key: "checkIn",
                              label: "Check in (local date and time)",
                              value: "",
                              type: "datetime-local",
                            },
                            {
                              key: "checkOut",
                              label: "Check out (local date and time)",
                              value: "",
                              type: "datetime-local",
                            },
                            {
                              key: "breakMinutes",
                              label: "Break minutes",
                              value: "0",
                              type: "number",
                            },
                            {
                              key: "reason",
                              label: "Reason for manual entry",
                              value: "",
                            },
                          ]);
                          if (v)
                            await run(
                              () => api("manual-attendance", v),
                              "Attendance added",
                            );
                        }}
                      >
                        <Plus size={16} /> Add Attendance
                      </button>
                    ) : undefined
                  }
                >
                  <AdminSessionsTable
                    sessions={data.sessions.filter(
                      (s) => s.role !== "admin" && s.role !== "display",
                    )}
                    now={now}
                    timeMode={timeMode}
                    settings={settings}
                  />
                </Section>
                <Section title="Session Locations">
                  <AdminLocationTable
                    sessions={data.sessions.filter(
                      (s) => s.role !== "admin" && s.role !== "display",
                    )}
                    timeMode={timeMode}
                  />
                </Section>
              </>
            ) : (
              <Section title="My Attendance Report">
                <div className="employeeReportMonth">
                  <label htmlFor="employee-report-month">Month</label>
                  <select
                    id="employee-report-month"
                    value={monthPrefix}
                    onChange={(e) => {
                      const [y, m] = e.target.value.split("-").map(Number);
                      setMonth(new Date(y, m - 1, 1));
                    }}
                  >
                    {Array.from({ length: 12 }, (_, i) => {
                      const d = new Date();
                      d.setDate(1);
                      d.setMonth(d.getMonth() - i);
                      const key = dayKey(d).slice(0, 7);
                      return (
                        <option value={key} key={key}>
                          {new Intl.DateTimeFormat("en-US", {
                            month: "long",
                            year: "numeric",
                          }).format(d)}
                        </option>
                      );
                    })}
                  </select>
                </div>
                <EmployeeDailyCards
                  sessions={visibleMonth}
                  now={now}
                  timeMode={timeMode}
                  visibility={visibility}
                />
              </Section>
            ))}
          {page === "profile" && (
            <>
              <Section title="My Profile">
                <div className="profileHeader">
                  <div className="avatarPicker">
                    <div className="avatarFrame">
                      <label
                        title="Change profile picture"
                        className={
                          "avatar" +
                          (show("profile.editPhoto") ? " clickableAvatar" : "")
                        }
                      >
                        {user.avatar ? (
                          <img src={user.avatar} alt="Profile" />
                        ) : (
                          String(user.name || "U")
                            .slice(0, 1)
                            .toUpperCase()
                        )}
                        <input
                          id="profilePhotoInput"
                          disabled={!show("profile.editPhoto")}
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          hidden
                          onChange={async (e) => {
                            const f = e.target.files?.[0];
                            e.target.value = "";
                            if (!f) return;
                            await run(async () => {
                              const r = await uploadAvatar(f);
                              setUser((prev: Row | null) => ({
                                ...prev,
                                ...r.user,
                              }));
                            }, "Photo updated");
                          }}
                        />
                      </label>
                      {show("profile.editPhoto") && (
                        <label
                          htmlFor="profilePhotoInput"
                          className="avatarEditBadge"
                          title="Change profile picture"
                        >
                          <Pencil size={13} />
                        </label>
                      )}
                    </div>
                    {show("profile.editPhoto") && (
                      <button
                        className="removeAvatar"
                        disabled={!user.avatar}
                        onClick={() =>
                          void run(async () => {
                            const r = await api("avatar-remove", {});
                            setUser((prev: Row | null) => ({
                              ...prev,
                              ...r.user,
                            }));
                          }, "Photo removed")
                        }
                      >
                        Remove photo
                      </button>
                    )}
                  </div>
                  <div>
                    <h2>{user.name}</h2>
                    <p>{user.email}</p>
                    <span className="pill">{user.role}</span>
                    {show("profile.editName") || show("profile.editEmail") ? (
                      <button
                        className="secondary small"
                        onClick={async () => {
                          const fields: {
                            key: string;
                            label: string;
                            value: string;
                            type?: string;
                          }[] = [];
                          if (show("profile.editName"))
                            fields.push({
                              key: "name",
                              label: "Full name",
                              value: String(user.name || ""),
                            });
                          if (show("profile.editEmail"))
                            fields.push({
                              key: "email",
                              label: "Email",
                              value: String(user.email || ""),
                              type: "email",
                            });
                          const v = await ask("Edit my details", fields);
                          if (v)
                            await run(async () => {
                              const r = await api("profile", v);
                              setUser((prev: Row | null) => ({
                                ...prev,
                                ...r.user,
                              }));
                            }, "Profile updated");
                        }}
                      >
                        <Pencil size={13} /> Edit my details
                      </button>
                    ) : (
                      <p className="muted">
                        Only an administrator can change your name and email.
                      </p>
                    )}
                  </div>
                </div>
              </Section>
              {show("profile.changePassword") && (
                <Section title="Security">
                  <button
                    className="secondary"
                    onClick={async () => {
                      const v = await ask("Change password", [
                        {
                          key: "password",
                          label: "New password (6+ characters)",
                          value: "",
                          type: "password",
                        },
                      ]);
                      if (v)
                        await run(
                          () => api("password", { password: v.password }),
                          "Password updated",
                        );
                    }}
                  >
                    Change Password
                  </button>
                </Section>
              )}
              <Section title="Account">
                <p>Status: Active</p>
                <p>Time zone: Asia/Qatar</p>
                <button className="secondary" onClick={logout}>
                  Sign out
                </button>
              </Section>
            </>
          )}
          {page === "employees" && isAdmin && employeeForm && (
            <EmployeeForm
              key={employeeForm.row?.id || "new"}
              row={
                employeeForm.row
                  ? data.staff.find((s) => s.id === employeeForm.row?.id) ||
                    employeeForm.row
                  : null
              }
              initialPassword={employeeForm.password}
              initialOffDays={
                employeeForm.row
                  ? offDaysOn(String(employeeForm.row.id), dayKey(new Date()))
                  : []
              }
              roles={roleChoices}
              showSalary={isFull}
              branches={data.branches}
              shifts={shifts.map((sh) => ({
                id: sh.id,
                name: `${sh.name} (${String(sh.start_time).slice(0, 5)}–${String(sh.end_time).slice(0, 5)})`,
              }))}
              busy={busy}
              onCancel={() => setEmployeeForm(null)}
              onSubmit={(v, original) =>
                void saveEmployeeForm(v, employeeForm.row, original)
              }
              onPhoto={(f) =>
                employeeForm.row &&
                void uploadEmployeePhoto(employeeForm.row, f)
              }
              onPhotoRemove={() =>
                employeeForm.row &&
                void run(
                  () =>
                    api("avatar-remove", { employeeId: employeeForm.row?.id }),
                  "Photo removed",
                )
              }
            />
          )}
          {page === "employees" && isAdmin && !employeeForm && (
            <Section title="Employee Overview">
              <div className="metricFour employeeCountCards">
                <div>
                  <Users color="#3279e8" />
                  <small>Total Employees</small>
                  <b>
                    {empStats?.total ??
                      data.staff.filter(
                        (e) => !["admin", "display"].includes(String(e.role)),
                      ).length}
                  </b>
                </div>
                <div>
                  <UserRound color="#00a66b" />
                  <small>Active Employees</small>
                  <b>
                    {empStats?.active ??
                      data.staff.filter(
                        (e) =>
                          !["admin", "display"].includes(String(e.role)) &&
                          e.status === "active",
                      ).length}
                  </b>
                </div>
                <div>
                  <Clock3 color="#f59e0b" />
                  <small>Pending Employees</small>
                  <b>
                    {empStats?.pending ??
                      data.staff.filter(
                        (e) =>
                          !["admin", "display"].includes(String(e.role)) &&
                          e.status === "pending",
                      ).length}
                  </b>
                </div>
              </div>
            </Section>
          )}
          {page === "employees" &&
            isAdmin &&
            !employeeForm &&
            can("employees") && (
              <Section
                title="Employee Management"
                action={
                  <button
                    className="primary small"
                    onClick={() => setEmployeeForm({ row: null, password: "" })}
                  >
                    <Plus size={16} /> Add employee
                  </button>
                }
              >
                <p className="muted">
                  Assign branches and shifts by name. Click the avatar to upload
                  a profile photo.
                </p>
                <div className="adminEmployeeList">
                  {data.staff.map((r) => (
                    <div className="adminEmployeeRow" key={r.id}>
                      <div className="adminPhotoWrap">
                        <label
                          className="adminPhoto"
                          title="Upload employee photo"
                        >
                          <input
                            id={"emp-photo-" + r.id}
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            hidden
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) void uploadEmployeePhoto(r, f);
                              e.target.value = "";
                            }}
                          />
                          {r.avatar ? (
                            <img src={r.avatar} alt="Employee" />
                          ) : (
                            <UserRound size={23} />
                          )}
                        </label>
                        <label
                          htmlFor={"emp-photo-" + r.id}
                          className="adminCamera"
                          title="Upload employee photo"
                        >
                          <Camera size={13} />
                        </label>
                      </div>
                      <div className="adminEmployeeDetails">
                        <strong>{r.name}</strong>
                        <small>{r.email}</small>
                        <small>
                          {data.branches.find((b) => b.id === r.branch_id)
                            ?.name || "Unassigned"}{" "}
                          ·{" "}
                          {shifts.find((sh) => sh.id === r.shift_id)?.name ||
                            "Flexible"}{" "}
                          · {r.required_daily_hours ?? 8} h/day
                        </small>
                        {(r.allow_outside_geofence ||
                          r.allow_multiple_devices ||
                          r.max_checkin_enabled) && (
                          <small className="employeeRuleTags">
                            {[
                              r.allow_outside_geofence &&
                                "Outside geofence allowed",
                              r.allow_multiple_devices && "Multiple devices",
                              r.max_checkin_enabled &&
                                `Max session ${Number(r.max_checkin_hours)} h`,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </small>
                        )}
                      </div>
                      <div className="rowActions">
                        <button
                          className="secondary small"
                          title="Edit employee"
                          onClick={() => void editEmployee(r)}
                        >
                          <Pencil size={16} />
                        </button>
                        <button
                          className={
                            r.status === "active"
                              ? "danger small"
                              : "primary small"
                          }
                          title={
                            r.status === "active" ? "Deactivate" : "Activate"
                          }
                          onClick={() => void toggleEmployee(r)}
                        >
                          {r.status === "active" ? (
                            <PowerOff size={16} />
                          ) : (
                            <Power size={16} />
                          )}
                        </button>
                        <button
                          className="danger small"
                          title={
                            r.id === user?.id
                              ? "You cannot delete your own account"
                              : "Delete Employee permanently"
                          }
                          disabled={r.id === user?.id}
                          onClick={() => void deleteEmployeePermanently(r)}
                        >
                          <Trash2 size={16} /> Delete Employee
                        </button>
                      </div>
                    </div>
                  ))}
                  {!data.staff.length && <p>No employees found.</p>}
                </div>
              </Section>
            )}
          {page === "branches" && isAdmin && can("branches") && (
            <Section
              title="Branch Management"
              action={
                <button
                  className="primary small"
                  onClick={async () => {
                    const v = await ask("Add branch", [
                      { key: "name", label: "Branch name", value: "" },
                    ]);
                    if (v) await run(() => api("branch", v), "Branch created");
                  }}
                >
                  <Plus size={16} /> Add branch
                </button>
              }
            >
              <div className="adminTileGrid">
                {data.branches.map((b) => (
                  <div className="adminTile" key={b.id}>
                    <div className="tileTop">
                      <Building2 size={22} />
                      <strong>{b.name}</strong>
                    </div>
                    <p>
                      {data.staff.filter((e) => e.branch_id === b.id).length}{" "}
                      assigned employees
                    </p>
                    <div className="rowActions">
                      <button
                        className="secondary small"
                        onClick={() =>
                          void edit("branch", b, [
                            {
                              key: "name",
                              label: "Branch name",
                              value: b.name,
                            },
                          ])
                        }
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        className="secondary small"
                        title="Assign employee"
                        onClick={async () => {
                          const v = await ask("Assign employee to " + b.name, [
                            {
                              key: "employeeId",
                              label: "Employee",
                              value: "",
                              options: [
                                { value: "", label: "Select employee" },
                                ...data.staff.map((e) => ({
                                  value: e.id,
                                  label: e.name,
                                })),
                              ],
                            },
                          ]);
                          if (v?.employeeId)
                            await run(
                              () =>
                                api("assign-employee", {
                                  employeeId: v.employeeId,
                                  branchId: b.id,
                                }),
                              "Branch assigned",
                            );
                        }}
                      >
                        <Users size={15} />
                      </button>
                      <button
                        className="danger small"
                        title="Delete"
                        onClick={() => void remove("branch", b)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                ))}{" "}
              </div>
            </Section>
          )}
          {page === "shifts" && isAdmin && can("shifts") && (
            <Section
              title="Shift Management"
              action={
                <button
                  className="primary small"
                  onClick={async () => {
                    const v = await ask("Add fixed shift", [
                      { key: "name", label: "Shift name", value: "" },
                      {
                        key: "startTime",
                        label: "Start time",
                        value: "09:00",
                        type: "time",
                      },
                      {
                        key: "endTime",
                        label: "End time",
                        value: "17:00",
                        type: "time",
                      },
                      {
                        key: "breakMinutes",
                        label: "Break minutes",
                        value: "0",
                        type: "number",
                      },
                    ]);
                    if (v) await run(() => api("shifts", v), "Shift created");
                  }}
                >
                  <Plus size={16} /> Add shift
                </button>
              }
            >
              <div className="adminTileGrid">
                {shifts.map((sh) => (
                  <div className="adminTile" key={sh.id}>
                    <div className="tileTop">
                      <Clock3 size={22} />
                      <strong>{sh.name}</strong>
                    </div>
                    <p>
                      {String(sh.start_time).slice(0, 5)} –{" "}
                      {String(sh.end_time).slice(0, 5)} · {sh.break_minutes} min
                      break
                    </p>
                    <p>
                      {data.staff.filter((e) => e.shift_id === sh.id).length}{" "}
                      employees
                    </p>
                    <div className="rowActions">
                      <button
                        className="secondary small"
                        title="Edit shift"
                        onClick={async () => {
                          const v = await ask("Edit shift", [
                            { key: "name", label: "Name", value: sh.name },
                            {
                              key: "startTime",
                              label: "Start",
                              value: String(sh.start_time).slice(0, 5),
                              type: "time",
                            },
                            {
                              key: "endTime",
                              label: "End",
                              value: String(sh.end_time).slice(0, 5),
                              type: "time",
                            },
                            {
                              key: "breakMinutes",
                              label: "Break minutes",
                              value: String(sh.break_minutes),
                              type: "number",
                            },
                          ]);
                          if (v)
                            await run(
                              () =>
                                api("shift-manage", {
                                  action: "edit",
                                  id: sh.id,
                                  ...v,
                                }),
                              "Shift updated",
                            );
                        }}
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        className="secondary small"
                        title="Assign employee"
                        onClick={async () => {
                          const v = await ask("Assign employee to " + sh.name, [
                            {
                              key: "employeeId",
                              label: "Employee",
                              value: "",
                              options: [
                                { value: "", label: "Select employee" },
                                ...data.staff.map((e) => ({
                                  value: e.id,
                                  label: e.name,
                                })),
                              ],
                            },
                          ]);
                          if (v?.employeeId)
                            await run(
                              () =>
                                api("assign-employee", {
                                  employeeId: v.employeeId,
                                  shiftId: sh.id,
                                }),
                              "Shift assigned",
                            );
                        }}
                      >
                        <Users size={15} />
                      </button>
                      <button
                        className="danger small"
                        title="Delete shift"
                        onClick={async () => {
                          const v = await ask("Delete shift?", [], true);
                          if (v)
                            await run(
                              () =>
                                api("shift-manage", {
                                  action: "delete",
                                  id: sh.id,
                                }),
                              "Shift deleted",
                            );
                        }}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                ))}
                {!shifts.length && <p>No shifts yet.</p>}
              </div>
            </Section>
          )}
          {page === "day-control" && isAdmin && can("day-control") && (
            <DayControl
              api={api}
              staff={data.staff}
              onChanged={() => void refresh()}
            />
          )}
          {page === "activity-log" && isAdmin && can("activity-log") && (
            <ActivityLog timeMode={timeMode} />
          )}
          {page === "devices" && isAdmin && can("devices") && (
            <DeviceSecurity
              timeMode={timeMode}
              refreshKey={data.version}
              isFull={isFull}
            />
          )}
          {page === "points" && can("points") && (
            <PointsPage
              api={api}
              isAdminView={isAdmin}
              isFull={isFull}
              staff={data.staff}
              branches={data.branches}
              version={data.version}
            />
          )}
          {page === "failed-attempts" && isAdmin && can("failed-attempts") && (
            <FailedAttempts
              timeMode={timeMode}
              refreshKey={data.version}
              canDelete={isFull}
            />
          )}
          {page === "geofences" && isAdmin && can("geofences") && (
            <>
              <Section title="Draw / Edit Geofence">
                <div className="fieldGrid">
                  <label>
                    Zone name
                    <input
                      value={form.fenceName || ""}
                      onChange={(e) =>
                        setForm((v) => ({ ...v, fenceName: e.target.value }))
                      }
                    />
                  </label>
                  <label>Assigned branch{opts(data.branches)}</label>
                </div>
                <MapEditor
                  selectedId={fence?.id || "new"}
                  initial={fence?.polygon || []}
                  onSave={(points) =>
                    void run(async () => {
                      if (fence)
                        await api("manage", {
                          kind: "geofence",
                          action: "edit",
                          id: fence.id,
                          name: form.fenceName,
                          branchId: form.branchId,
                          polygon: points,
                          active: fence.active,
                        });
                      else
                        await api("geofence", {
                          name: form.fenceName,
                          branchId: form.branchId,
                          polygon: points,
                        });
                      setFence(null);
                    }, "Boundary saved")
                  }
                />
                <button
                  className="secondary"
                  onClick={() => {
                    setFence(null);
                    setForm((v) => ({ ...v, fenceName: "", branchId: "" }));
                  }}
                >
                  New zone
                </button>
              </Section>
              <Section title="Saved Geofences">
                <DataTable
                  rows={data.fences}
                  cols={["public_id", "name", "branch_id", "active"]}
                  actions={(r) => (
                    <>
                      <button
                        className="secondary small"
                        onClick={() => {
                          setFence(r);
                          setForm((p) => ({
                            ...p,
                            fenceName: r.name,
                            branchId: r.branch_id,
                          }));
                        }}
                      >
                        <Pencil size={14} /> Edit
                      </button>
                      <button
                        className="danger small"
                        onClick={() => void remove("geofence", r)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </>
                  )}
                />
              </Section>
            </>
          )}
          {page === "requests" && can("requests") && (
            <Section
              title="Employee Requests"
              action={
                <button
                  className="primary small"
                  onClick={() => void request()}
                >
                  <Plus size={16} />
                  {user.role === "admin"
                    ? "Create Employee Request"
                    : "New Request"}
                </button>
              }
            >
              <p className="muted">
                {user.role === "admin"
                  ? "Create requests on behalf of an employee, or review requests submitted by employees and approve or reject them. Administrators cannot create personal requests."
                  : "Create and track your requests. Your administrator will review and respond to each request."}
              </p>
              <div className="requestFilters">
                {["all", "pending", "approved", "rejected", "cancelled"].map(
                  (st) => (
                    <button
                      key={st}
                      className={
                        (requestFilter === st ? "primary" : "secondary") +
                        " small"
                      }
                      onClick={() => setRequestFilter(st)}
                    >
                      {st === "all"
                        ? "All"
                        : st.charAt(0).toUpperCase() + st.slice(1)}
                    </button>
                  ),
                )}
              </div>
              <div className="requestCardGrid">
                {data.requests
                  .filter(
                    (r) =>
                      requestFilter === "all" ||
                      String(r.status) === requestFilter,
                  )
                  .map((r) => (
                    <article key={r.id} className="requestCard">
                      <div className="requestCardHead">
                        <strong>{r.kind}</strong>
                        <span className={"requestStatus " + String(r.status)}>
                          {r.status}
                        </span>
                      </div>
                      <small>
                        {r.public_id || "Request"}
                        {isAdmin ? " · " + r.name : ""}
                      </small>
                      <div className="requestDates">
                        <CalendarDays size={16} />
                        {r.start_date ? shortDate(r.start_date) : "—"} –{" "}
                        {r.end_date ? shortDate(r.end_date) : "—"}
                      </div>
                      <p>{r.note}</p>
                      <small>
                        Submitted {r.created_at ? shortDate(r.created_at) : "—"}
                      </small>
                      {!isAdmin && r.status === "pending" && (
                        <div className="rowActions">
                          <button
                            className="secondary small"
                            onClick={() =>
                              void run(
                                () => api("request-cancel", { id: r.id }),
                                "Request cancelled",
                              )
                            }
                          >
                            Cancel Request
                          </button>
                        </div>
                      )}
                      {isAdmin && (
                        <div className="rowActions">
                          {r.status === "pending" && (
                            <>
                              <button
                                className="primary small"
                                onClick={() =>
                                  void run(
                                    () =>
                                      api("review", {
                                        id: r.id,
                                        status: "approved",
                                      }),
                                    "Approved",
                                  )
                                }
                              >
                                <Check size={14} /> Approve
                              </button>
                              <button
                                className="danger small"
                                onClick={() =>
                                  void run(
                                    () =>
                                      api("review", {
                                        id: r.id,
                                        status: "rejected",
                                      }),
                                    "Rejected",
                                  )
                                }
                              >
                                Reject
                              </button>
                            </>
                          )}
                          <button
                            className="secondary small"
                            onClick={() =>
                              void edit("request", r, [
                                {
                                  key: "startDate",
                                  label: "Start date",
                                  value: String(r.start_date || "").slice(
                                    0,
                                    10,
                                  ),
                                  type: "date",
                                },
                                {
                                  key: "endDate",
                                  label: "End date",
                                  value: String(r.end_date || "").slice(0, 10),
                                  type: "date",
                                },
                                {
                                  key: "note",
                                  label: "Details",
                                  value: r.note,
                                },
                                {
                                  key: "status",
                                  label: "Status",
                                  value: r.status,
                                  options: [
                                    { value: "pending", label: "Pending" },
                                    { value: "approved", label: "Approved" },
                                    { value: "rejected", label: "Rejected" },
                                    { value: "cancelled", label: "Cancelled" },
                                  ],
                                },
                              ])
                            }
                          >
                            <Pencil size={14} /> Edit
                          </button>
                          <button
                            className="danger small"
                            onClick={() => void remove("request", r)}
                          >
                            <Trash2 size={14} /> Delete
                          </button>
                        </div>
                      )}
                    </article>
                  ))}
                {!data.requests.length && <p>No requests yet.</p>}
              </div>
            </Section>
          )}

          {page === "request-categories" &&
            isAdmin &&
            can("request-categories") && (
              <Section
                title="Request Categories"
                action={
                  <button
                    className="primary small"
                    onClick={async () => {
                      const v = await ask("New Category", [
                        { key: "name", label: "Category name", value: "" },
                      ]);
                      if (v)
                        await run(
                          () =>
                            api("request-categories", {
                              action: "create",
                              name: v.name,
                            }),
                          "Category created",
                        );
                    }}
                  >
                    <Plus size={16} /> Add Category
                  </button>
                }
              >
                <p className="muted">
                  Active categories are available for employee requests. Disable
                  categories to preserve existing records.
                </p>
                <DataTable
                  rows={categories}
                  cols={["public_id", "name", "active"]}
                  actions={(r) => (
                    <>
                      <button
                        className="secondary small"
                        onClick={async () => {
                          const v = await ask("Edit Category", [
                            {
                              key: "name",
                              label: "Category name",
                              value: r.name,
                            },
                          ]);
                          if (v)
                            await run(
                              () =>
                                api("request-categories", {
                                  action: "update",
                                  id: r.id,
                                  name: v.name,
                                  active: r.active,
                                }),
                              "Category updated",
                            );
                        }}
                      >
                        <Pencil size={14} /> Edit
                      </button>
                      <button
                        className="secondary small"
                        onClick={() =>
                          void run(
                            () =>
                              api("request-categories", {
                                action: "update",
                                id: r.id,
                                name: r.name,
                                active: !r.active,
                              }),
                            r.active ? "Category hidden" : "Category activated",
                          )
                        }
                      >
                        {r.active ? (
                          <PowerOff size={16} />
                        ) : (
                          <Power size={16} />
                        )}
                      </button>
                      <button
                        className="danger small"
                        onClick={async () => {
                          const v = await ask("Delete category?", [], true);
                          if (v)
                            await run(
                              () =>
                                api("request-categories", {
                                  action: "delete",
                                  id: r.id,
                                }),
                              "Category deleted",
                            );
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </>
                  )}
                />
              </Section>
            )}
          {page === "permissions" && isFull && can("permissions") && (
            <Section
              title="Roles & permissions"
              action={
                <>
                  <button
                    className="secondary small"
                    onClick={() =>
                      void api("roles").then((r) => {
                        setRoles(r.roles || []);
                        setAllowRegistration(r.allowRegistration !== false);
                      })
                    }
                  >
                    Refresh
                  </button>
                  <button
                    className="primary small"
                    onClick={async () => {
                      const v = await ask("New role", [
                        { key: "label", label: "Role name", value: "" },
                        {
                          key: "scope",
                          label: "Access level",
                          value: "self",
                          options: [
                            {
                              value: "self",
                              label: "Staff — sees only their own attendance",
                            },
                            {
                              value: "all",
                              label:
                                "Manager — sees all employees (no punching)",
                            },
                          ],
                        },
                      ]);
                      if (!v) return;
                      await run(
                        () =>
                          api("roles", {
                            action: "create",
                            label: v.label,
                            scope: v.scope,
                          }),
                        "Role created",
                      );
                      const x = await api("roles");
                      setRoles(x.roles || []);
                    }}
                  >
                    <Plus size={16} /> Add role
                  </button>
                </>
              }
            >
              <p className="muted">
                Choose which pages employees can access. Changes are enforced by
                the server for protected data. Admin management permissions
                remain protected.
              </p>
              <div className="registrationPermission">
                <label>
                  <input
                    type="checkbox"
                    checked={allowRegistration}
                    onChange={(e) => setAllowRegistration(e.target.checked)}
                  />{" "}
                  Allow new user registration from the Login page
                </label>
                <button
                  className="primary small"
                  onClick={() =>
                    void run(
                      () =>
                        api("roles", {
                          action: "toggle-registration",
                          enabled: allowRegistration,
                        }),
                      "Registration setting saved",
                    )
                  }
                >
                  Save Registration Setting
                </button>
                <small>
                  {allowRegistration
                    ? "The Register link is visible on the Login page."
                    : "Public registration is disabled and the Register link is hidden."}
                </small>
              </div>
              <button
                className="secondary small"
                onClick={() =>
                  void api("roles").then((r) => {
                    setRoles(r.roles || []);
                    setAllowRegistration(r.allowRegistration !== false);
                  })
                }
              >
                Load permissions
              </button>
              {roles
                .filter((r) => r.role !== "admin")
                .map((r) => (
                  <div key={r.role} className="roleBlock">
                    <div className="roleHead">
                      <h3>
                        {r.label || r.role}
                        {r.scope === "all" && (
                          <span className="rolePill">Manager access</span>
                        )}
                        {r.role === "display" && (
                          <span className="rolePill">Read only</span>
                        )}
                      </h3>
                      {!["employee", "display"].includes(r.role) && (
                        <button
                          className="danger small"
                          onClick={async () => {
                            const v = await ask(
                              'Delete role "' + (r.label || r.role) + '"?',
                              [],
                              true,
                            );
                            if (!v) return;
                            await run(
                              () =>
                                api("roles", {
                                  action: "delete",
                                  role: r.role,
                                }),
                              "Role deleted",
                            );
                            const x = await api("roles");
                            setRoles(x.roles || []);
                          }}
                        >
                          <Trash2 size={14} /> Delete role
                        </button>
                      )}
                    </div>
                    <label>
                      <input
                        type="checkbox"
                        checked={!!r.sidebar_enabled}
                        onChange={(e) =>
                          setRoles((old) =>
                            old.map((x) =>
                              x.role === r.role
                                ? { ...x, sidebar_enabled: e.target.checked }
                                : x,
                            ),
                          )
                        }
                      />{" "}
                      Enable sidebar
                    </label>
                    <div className="permissionGrid">
                      {[...nav, ...adminNav]
                        .filter((n) =>
                          r.role === "display"
                            ? n.id === "onsite"
                            : r.scope === "all"
                              ? !["permissions", "punch", "history"].includes(
                                  n.id,
                                )
                              : ![
                                  "employees",
                                  "branches",
                                  "shifts",
                                  "geofences",
                                  "failed-attempts",
                                  "devices",
                                  "activity-log",
                                  "day-control",
                                  "request-categories",
                                  "admin-messages",
                                  "settings",
                                  "permissions",
                                ].includes(n.id),
                        )
                        .map((n) => (
                          <label key={n.id}>
                            <input
                              type="checkbox"
                              checked={r.pages.includes(n.id)}
                              onChange={(e) =>
                                setRoles((old) =>
                                  old.map((x) =>
                                    x.role === r.role
                                      ? {
                                          ...x,
                                          pages: e.target.checked
                                            ? [...x.pages, n.id]
                                            : x.pages.filter(
                                                (p: string) => p !== n.id,
                                              ),
                                        }
                                      : x,
                                  ),
                                )
                              }
                            />
                            {n.label}
                          </label>
                        ))}
                    </div>
                    {r.role !== "display" && (
                      <VisibilitySettings
                        visibility={r.ui_visibility || {}}
                        onChange={(key, enabled) =>
                          setRoles((old) =>
                            old.map((x) =>
                              x.role === r.role
                                ? {
                                    ...x,
                                    ui_visibility: {
                                      ...(x.ui_visibility || {}),
                                      [key]: enabled,
                                    },
                                  }
                                : x,
                            ),
                          )
                        }
                      />
                    )}
                    <button
                      className="primary"
                      onClick={() =>
                        void run(
                          () =>
                            api("roles", {
                              role: r.role,
                              pages: r.pages,
                              sidebarEnabled: r.sidebar_enabled,
                              uiVisibility: r.ui_visibility || {},
                            }),
                          "Permissions saved",
                        )
                      }
                    >
                      Save {r.label || r.role} permissions
                    </button>
                  </div>
                ))}
            </Section>
          )}
          {page === "admin-messages" && isAdmin && can("admin-messages") && (
            <Announcements api={api} />
          )}
          {page === "settings" && isAdmin && can("settings") && (
            <Section title="Website Settings">
              <div className="fieldGrid">
                <label>
                  Site name
                  <input
                    value={
                      form.site_name ??
                      settings.site_name ??
                      "Attendance System"
                    }
                    onChange={(e) =>
                      setForm((p) => ({ ...p, site_name: e.target.value }))
                    }
                  />
                </label>
                <label>
                  Default language
                  <select value="en" disabled>
                    <option value="en">English</option>
                  </select>
                </label>
                <label>
                  Date format
                  <select
                    value={form.date_format ?? settings.date_format ?? "short"}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, date_format: e.target.value }))
                    }
                  >
                    <option value="short">30 Oct 2026</option>
                    <option value="numeric">30/10/2026</option>
                    <option value="long">30 October 2026</option>
                  </select>
                </label>
                <label>
                  Time format
                  <select
                    value={form.time_format ?? settings.time_format ?? "12"}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, time_format: e.target.value }))
                    }
                  >
                    <option value="12">12-hour (03:30 PM)</option>
                    <option value="24">24-hour (15:30)</option>
                  </select>
                </label>
                <label>
                  Hours format
                  <select
                    value={form.hours_format ?? settings.hours_format ?? "auto"}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, hours_format: e.target.value }))
                    }
                  >
                    <option value="auto">
                      Default (reports 9.7, clocks 09:42)
                    </option>
                    <option value="decimal">Decimal hours (9.7)</option>
                    <option value="hhmm">Hours:minutes (9:42)</option>
                  </select>
                </label>
                <label>
                  Early Leave Grace (minutes)
                  <input
                    type="number"
                    min="0"
                    max="240"
                    step="1"
                    value={
                      form.early_grace_minutes ??
                      settings.early_grace_minutes ??
                      0
                    }
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        early_grace_minutes: e.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  Overtime Grace (minutes)
                  <input
                    type="number"
                    min="0"
                    max="240"
                    step="1"
                    value={
                      form.overtime_grace_minutes ??
                      settings.overtime_grace_minutes ??
                      0
                    }
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        overtime_grace_minutes: e.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  Require press-and-hold for Check In / Check Out
                  <select
                    value={String(
                      form.punch_hold_enabled ??
                        settings.punch_hold_enabled ??
                        false,
                    )}
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        punch_hold_enabled: e.target.value === "true",
                      }))
                    }
                  >
                    <option value="false">Normal touch</option>
                    <option value="true">Press and hold</option>
                  </select>
                </label>
                <label>
                  Hold duration (seconds)
                  <input
                    type="number"
                    min="1"
                    max="15"
                    step="1"
                    disabled={
                      !(
                        form.punch_hold_enabled ??
                        settings.punch_hold_enabled ??
                        false
                      )
                    }
                    value={
                      form.punch_hold_seconds ??
                      settings.punch_hold_seconds ??
                      3
                    }
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        punch_hold_seconds: e.target.value,
                      }))
                    }
                  />
                </label>
                {(["logo", "icon"] as const).map((k) => (
                  <label key={k}>
                    {k === "logo" ? "Company logo" : "Website icon"}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        if (file.size > 150000) {
                          setError("Image must be under 150 KB");
                          return;
                        }
                        const reader = new FileReader();
                        reader.onload = () =>
                          setForm((p) => ({
                            ...p,
                            [k]: String(reader.result),
                          }));
                        reader.readAsDataURL(file);
                      }}
                    />
                  </label>
                ))}
              </div>
              <button
                className="primary"
                onClick={() =>
                  void run(
                    () =>
                      api("settings", {
                        site_name:
                          form.site_name ??
                          settings.site_name ??
                          "Attendance System",
                        logo: form.logo ?? settings.logo ?? "",
                        icon: form.icon ?? settings.icon ?? "",
                        language: "en",
                        date_format:
                          form.date_format ?? settings.date_format ?? "short",
                        time_format:
                          form.time_format ?? settings.time_format ?? "12",
                        hours_format:
                          form.hours_format ?? settings.hours_format ?? "auto",
                        early_grace_minutes: Number(
                          form.early_grace_minutes ??
                            settings.early_grace_minutes ??
                            0,
                        ),
                        overtime_grace_minutes: Number(
                          form.overtime_grace_minutes ??
                            settings.overtime_grace_minutes ??
                            0,
                        ),
                        punch_hold_enabled: Boolean(
                          form.punch_hold_enabled ??
                          settings.punch_hold_enabled ??
                          false,
                        ),
                        punch_hold_seconds: Math.min(
                          15,
                          Math.max(
                            1,
                            Number(
                              form.punch_hold_seconds ??
                                settings.punch_hold_seconds ??
                                3,
                            ),
                          ),
                        ),
                      }),
                    "Settings updated",
                  )
                }
              >
                Save Settings
              </button>
            </Section>
          )}
        </main>
        <nav className="mobileNav">
          {nav
            .filter(
              (n) =>
                can(n.id) &&
                n.id !== "onsite" &&
                n.id !== "requests" &&
                // Points is reached from its dashboard cards when those are shown.
                !(n.id === "points" && show("dashboard.points")),
            )
            .map((n) => (
              <button
                key={n.id}
                className={
                  (page === n.id ? "selected " : "") +
                  (n.id === "punch"
                    ? "punchNav " +
                      (active?.break_started_at
                        ? "punchNavBreak"
                        : active
                          ? "punchNavOut"
                          : "")
                    : "")
                }
                onClick={() => go(n.id)}
              >
                {n.id === "punch" && geoLoading ? (
                  <LoaderCircle className="spin" size={28} />
                ) : n.id === "punch" ? (
                  <Fingerprint size={28} />
                ) : (
                  <n.icon size={21} />
                )}
                {n.id !== "punch" && <small>{n.label}</small>}
              </button>
            ))}
        </nav>
      </div>
      {modal && (
        <div
          className="modalBackdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) dismiss(null);
          }}
        >
          <div className="dialog" role="dialog" aria-modal="true">
            <div className="sectionHead">
              <h3>{modal.title}</h3>
              <IconButton onClick={() => dismiss(null)}>
                <X />
              </IconButton>
            </div>
            {modal.message && (
              <p className="dialogWarning" role="alert">
                {modal.message}
              </p>
            )}
            {modal.fields.map((f) => (
              <label key={f.key}>
                {f.label}
                {f.type === "checkbox" ? (
                  <input
                    type="checkbox"
                    checked={
                      modalData[f.key] === "true" || modalData[f.key] === true
                    }
                    onChange={(e) =>
                      setModalData((p) => ({
                        ...p,
                        [f.key]: e.target.checked ? "true" : "false",
                      }))
                    }
                  />
                ) : f.options || f.key === "kind" ? (
                  <select
                    value={modalData[f.key] ?? ""}
                    onChange={(e) =>
                      setModalData((p) => ({ ...p, [f.key]: e.target.value }))
                    }
                  >
                    {(
                      f.options ||
                      categories
                        .filter((c) => c.active)
                        .map((c) => ({ value: c.name, label: c.name }))
                    ).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="pwField">
                    <input
                      type={
                        f.type === "password" && showPw[f.key]
                          ? "text"
                          : f.type || "text"
                      }
                      value={modalData[f.key] ?? ""}
                      onChange={(e) =>
                        setModalData((p) => ({ ...p, [f.key]: e.target.value }))
                      }
                    />
                    {f.type === "password" && (
                      <button
                        type="button"
                        className="pwEye"
                        title={
                          showPw[f.key] ? "Hide password" : "Show password"
                        }
                        onClick={() =>
                          setShowPw((p) => ({ ...p, [f.key]: !p[f.key] }))
                        }
                      >
                        {showPw[f.key] ? (
                          <EyeOff size={16} />
                        ) : (
                          <Eye size={16} />
                        )}
                      </button>
                    )}
                  </span>
                )}
              </label>
            ))}
            <div className="dialogFooter">
              <button className="secondary" onClick={() => dismiss(null)}>
                Cancel
              </button>
              <button
                className={modal.danger ? "danger" : "primary"}
                onClick={() => dismiss(modalData)}
              >
                {modal.danger
                  ? modal.confirmLabel || "Confirm Delete"
                  : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
function OnSiteWallboard({
  people,
  exited,
  now,
  siteName,
  signOut,
  fullscreen,
  toggleFullscreen,
}: {
  people: Row[];
  exited: Row[];
  now: Date | null;
  siteName: string;
  signOut: () => void | Promise<unknown>;
  fullscreen: boolean;
  toggleFullscreen: () => void;
}) {
  const [query, setQuery] = useState("");
  const [branch, setBranch] = useState("");
  const [showExited, setShowExited] = useState(true);
  const active = people.filter((p) => p.check_in && !p.check_out);
  const breaking = active.filter((p) => !!p.break_started_at);
  const branches = Array.from(
    new Set(active.map((p) => String(p.branch_name || "Unassigned"))),
  ).sort();
  const shown = active.filter(
    (p) =>
      (!branch || String(p.branch_name || "Unassigned") === branch) &&
      String(p.name || "")
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <section className={"wallboard " + (fullscreen ? "wallboardExpanded" : "")}>
      <div className="wallboardTop">
        <div className="wallboardHeading">
          <span className="wallboardEyebrow">LIVE ATTENDANCE · {siteName}</span>
          <h1>Who's On Site</h1>
          <p>Live status · Refreshes every 3 seconds</p>
        </div>
        <div className="wallboardControls">
          <input
            aria-label="Find employee"
            placeholder="Search employee"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            aria-label="Filter branch"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
          >
            <option value="">All branches</option>
            {branches.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
          <label>
            <input
              type="checkbox"
              checked={showExited}
              onChange={(e) => setShowExited(e.target.checked)}
            />{" "}
            Show exit summary
          </label>
        </div>
        <div className="wallboardActions">
          <span className="wallboardClock">
            {now
              ? new Intl.DateTimeFormat("en-GB", {
                  timeZone: "Asia/Qatar",
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false,
                }).format(now)
              : "--:--"}
          </span>
          <button className="wallboardAction" onClick={toggleFullscreen}>
            {fullscreen ? "Normal View" : "TV Mode"}
          </button>
          <button className="wallboardAction" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </div>
      <div className="wallboardMain">
        <div className="wallboardRosterPane">
          <div className="wallboardGrid">
            {shown.map((p) => (
              <article
                className={
                  "wallboardPerson " +
                  (p.break_started_at ? "isBreak" : "isWorking")
                }
                key={p.id}
              >
                <div className="wallboardPhoto">
                  {p.avatar ? (
                    <img alt="" src={String(p.avatar)} />
                  ) : (
                    <span>
                      {String(p.name || "?")
                        .slice(0, 1)
                        .toUpperCase()}
                    </span>
                  )}
                </div>
                <h2>{String(p.name || "Employee")}</h2>
                <p>{String(p.branch_name || "Unassigned")}</p>
                <span className="wallboardStatus">
                  {p.break_started_at ? "☕ ON BREAK" : "● CHECKED IN"}
                </span>
                <small>
                  In{" "}
                  {new Intl.DateTimeFormat("en-GB", {
                    timeZone: "Asia/Qatar",
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: true,
                  }).format(new Date(String(p.check_in)))}
                </small>
              </article>
            ))}
            {shown.length === 0 && (
              <p className="wallboardEmpty">
                No active check-ins match your search
              </p>
            )}
          </div>
          {showExited && (
            <div className="wallboardExited">
              <h2>
                Checked Out Today <span>{exited.length}</span>
              </h2>
              <div className="wallboardExitedGrid">
                {exited
                  .filter(
                    (p) =>
                      (!branch ||
                        String(p.branch_name || "Unassigned") === branch) &&
                      String(p.name || "")
                        .toLowerCase()
                        .includes(query.toLowerCase()),
                  )
                  .map((p) => (
                    <div className="exitedPerson" key={p.id}>
                      <div className="exitedPhoto">
                        {p.avatar ? (
                          <img src={String(p.avatar)} alt="" />
                        ) : (
                          String(p.name || "?").slice(0, 1)
                        )}
                      </div>
                      <div>
                        <strong>{String(p.name)}</strong>
                        <small>
                          {String(p.branch_name || "Unassigned")} · Out{" "}
                          {new Intl.DateTimeFormat("en-GB", {
                            timeZone: "Asia/Qatar",
                            hour: "2-digit",
                            minute: "2-digit",
                            hour12: true,
                          }).format(new Date(String(p.check_out)))}
                        </small>
                      </div>
                      <span>LEFT</span>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
        <aside className="wallboardMetrics">
          <article>
            <strong>{active.length}</strong>
            <span>Check In</span>
          </article>
          <article className="workingMetric">
            <strong>{exited.length}</strong>
            <span>Check Out</span>
          </article>
          <article className="breakMetric">
            <strong>{breaking.length}</strong>
            <span>Break</span>
          </article>
        </aside>
      </div>
      <p className="wallboardFooter">
        Status is based on punch and break records, not continuous GPS tracking.
      </p>
    </section>
  );
}
function Summary({
  present,
  absent,
  total,
  early = 0,
}: {
  present: number;
  absent: number;
  total: number;
  early?: number;
}) {
  return (
    <div className="summaryGrid">
      <div>
        <strong className="greenText">{present}</strong>
        <small>Present</small>
      </div>
      <div>
        <strong className="redText">{absent}</strong>
        <small>Absent</small>
      </div>
      <div>
        <strong className="orangeText">{early}</strong>
        <small>Early Left</small>
      </div>
      <div>
        <strong className="blueText">{fmtH(total, "clock")}</strong>
        <small>Total Hours</small>
      </div>
    </div>
  );
}
function KitchenStaffActivity({
  people,
  show,
}: {
  people: Row[];
  show: (key: string) => boolean;
}) {
  // The snapshot API already returns only active employees with an open attendance session.
  // Do not filter by p.status here: that field is intentionally omitted from the UI payload.
  const active = [...people].sort(
    (a, b) =>
      new Date(String(b.check_in)).getTime() -
      new Date(String(a.check_in)).getTime(),
  );
  return (
    <Section
      title={
        show("dashboard.kitchen.title") ? "Employees Currently in Kitchen" : ""
      }
    >
      {show("dashboard.kitchen.count") && (
        <div className="adminWorkforceMetrics kitchenActivityCount">
          <div>
            <small>Currently Checked In</small>
            <strong>{active.length}</strong>
          </div>
        </div>
      )}
      <div className="kitchenActivityList">
        {active.map((p) => (
          <div
            className="kitchenActivityItem"
            key={String(p.id) + "-" + String(p.check_in)}
          >
            {show("dashboard.kitchen.photo") && (
              <div className="kitchenActivityAvatar">
                {p.avatar ? (
                  <img
                    src={String(p.avatar)}
                    alt={String(p.name || "Employee")}
                  />
                ) : (
                  <span>
                    {String(p.name || "?")
                      .slice(0, 1)
                      .toUpperCase()}
                  </span>
                )}
              </div>
            )}
            <div className="kitchenActivityDetails">
              {show("dashboard.kitchen.name") && (
                <strong>{String(p.name || "Employee")}</strong>
              )}
              {show("dashboard.kitchen.branch") && (
                <small>{String(p.branch_name || "Currently on shift")}</small>
              )}
            </div>
            {show("dashboard.kitchen.status") && (
              <span
                className={
                  "kitchenActivityStatus " +
                  (p.break_started_at ? "onBreak" : "working")
                }
              >
                {p.break_started_at ? "On Break" : "Checked In"}
              </span>
            )}
            {(show("dashboard.kitchen.checkInLabel") ||
              show("dashboard.kitchen.checkInTime")) && (
              <div className="kitchenActivityTime">
                {show("dashboard.kitchen.checkInLabel") && (
                  <small>Check-in</small>
                )}
                {show("dashboard.kitchen.checkInTime") && (
                  <b>{stamp(p.check_in)}</b>
                )}
              </div>
            )}
          </div>
        ))}
        {!active.length && show("dashboard.kitchen.emptyMessage") && (
          <p className="muted">No employees are currently checked in.</p>
        )}
      </div>
    </Section>
  );
}
function Activity({
  sessions,
  timeMode,
}: {
  sessions: Row[];
  timeMode: string;
}) {
  return (
    <div className="activityList">
      {sessions
        .flatMap((s) =>
          [
            { id: s.id + "in", icon: "in", title: "Check In", at: s.check_in },
            {
              id: s.id + "out",
              icon: "out",
              title: "Check Out",
              at: s.missed_checkout ? null : s.check_out,
            },
          ].filter((x) => x.at),
        )
        .sort(
          (a, b) =>
            new Date(String(b.at)).getTime() - new Date(String(a.at)).getTime(),
        )
        .slice(0, 8)
        .map((item) => (
          <div className="activityItem" key={item.id}>
            <span
              className={"activityIcon " + (item.icon === "in" ? "on" : "off")}
            >
              <DoorOpen size={18} />
            </span>
            <div>
              <strong>{item.title}</strong>
              <small>{shortDate(item.at)}</small>
            </div>
            <b>{stamp(item.at, timeMode)}</b>
            <span className="activityLocation">
              <MapPin size={13} /> Office
            </span>
          </div>
        ))}
      {!sessions.length && <p className="muted">No recent activity.</p>}
    </div>
  );
}
