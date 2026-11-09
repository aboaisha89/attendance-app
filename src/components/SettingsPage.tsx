"use client";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Bell,
  Building2,
  CalendarDays,
  Clock,
  Database,
  Fingerprint,
  Globe,
  Info,
  Map as MapIcon,
  Palette,
  RefreshCw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  TriangleAlert,
  Undo2,
  Users,
} from "lucide-react";

type Row = Record<string, any>;
type Api = (path: string, payload?: Row) => Promise<Row>;
type Tab = "general" | "display" | "attendance" | "punch" | "access" | "data";

const TABS: { id: Tab; label: string; hint: string; icon: typeof Globe }[] = [
  { id: "general", label: "General", hint: "Name, logo and icon", icon: Palette },
  { id: "display", label: "Display formats", hint: "Date, time and hours", icon: Clock },
  { id: "attendance", label: "Attendance rules", hint: "Grace, GPS and pausing", icon: SlidersHorizontal },
  { id: "punch", label: "Punch button", hint: "Press-and-hold", icon: Fingerprint },
  { id: "access", label: "Access & security", hint: "Sign-up, roles, devices", icon: ShieldCheck },
  { id: "data", label: "Data & maintenance", hint: "Usage and cleanup", icon: Database },
];

const KEYS = [
  "site_name",
  "logo",
  "icon",
  "date_format",
  "time_format",
  "hours_format",
  "early_grace_minutes",
  "overtime_grace_minutes",
  "punch_hold_enabled",
  "punch_hold_seconds",
  "gps_max_accuracy_m",
  "default_required_hours",
  "punching_paused",
  "punching_paused_message",
] as const;

const fromSettings = (s: Row): Row => ({
  site_name: s.site_name ?? "Attendance System",
  logo: s.logo ?? "",
  icon: s.icon ?? "",
  date_format: s.date_format ?? "short",
  time_format: s.time_format ?? "12",
  hours_format: s.hours_format ?? "auto",
  early_grace_minutes: String(s.early_grace_minutes ?? 0),
  overtime_grace_minutes: String(s.overtime_grace_minutes ?? 0),
  punch_hold_enabled: s.punch_hold_enabled === true,
  punch_hold_seconds: String(s.punch_hold_seconds ?? 3),
  gps_max_accuracy_m: String(s.gps_max_accuracy_m ?? 150),
  default_required_hours: s.default_required_hours == null ? "" : String(Number(s.default_required_hours)),
  punching_paused: s.punching_paused === true,
  punching_paused_message: s.punching_paused_message ?? "",
});

const SHORTCUTS: { id: string; label: string; hint: string; icon: typeof Globe }[] = [
  { id: "branches", label: "Branches", hint: "Locations and teams", icon: Building2 },
  { id: "geofences", label: "Geofences", hint: "Allowed punch areas", icon: MapIcon },
  { id: "shifts", label: "Shifts", hint: "Working hours", icon: Clock },
  { id: "day-control", label: "Day Control", hint: "Off days and overrides", icon: CalendarDays },
  { id: "work-hours", label: "Special hours", hint: "Ramadan, short Fridays, repeating days", icon: CalendarDays },
  { id: "punch-map", label: "Punch map", hint: "Where employees punched", icon: MapIcon },
  { id: "request-categories", label: "Request categories", hint: "Leave and request types", icon: SlidersHorizontal },
  { id: "admin-messages", label: "Announcements", hint: "Messages to employees", icon: Bell },
  { id: "points", label: "Points rules", hint: "Rewards and penalties", icon: ShieldCheck },
];

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="setField">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

function Toggle({
  checked,
  onChange,
  title,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  title: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label className={"setToggle" + (disabled ? " disabled" : "")}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="setSwitch" aria-hidden="true" />
      <span className="setToggleText">
        <b>{title}</b>
        {hint && <small>{hint}</small>}
      </span>
    </label>
  );
}

export default function SettingsPage({
  settings,
  api,
  refresh,
  go,
  can,
  isFull,
  allowRegistration,
  onRegistrationChange,
}: {
  settings: Row;
  api: Api;
  refresh: () => Promise<unknown> | void;
  go: (page: string) => void;
  can: (page: string) => boolean;
  isFull: boolean;
  allowRegistration: boolean;
  onRegistrationChange: (v: boolean) => void;
}) {
  const base = useMemo(() => fromSettings(settings), [settings]);
  const [draft, setDraft] = useState<Row>(base);
  const [tab, setTab] = useState<Tab>("general");
  const [saving, setSaving] = useState(false);
  const dirty = KEYS.some((k) => String(draft[k]) !== String(base[k]));

  // Pick up server changes only while nothing is being edited.
  useEffect(() => {
    if (!dirty) setDraft(base);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);

  const set = (k: string, v: unknown) => setDraft((d) => ({ ...d, [k]: v }));
  const text = (k: string) => String(draft[k] ?? "");

  const pickImage = (k: "logo" | "icon", file?: File) => {
    if (!file) return;
    if (file.size > 150000) return toast.error("Image must be under 150 KB");
    const reader = new FileReader();
    reader.onload = () => set(k, String(reader.result));
    reader.readAsDataURL(file);
  };

  const save = async () => {
    const int = (k: string) => Number(draft[k]);
    const checks: [boolean, string][] = [
      [!String(draft.site_name).trim(), "Enter the site name"],
      [![int("early_grace_minutes"), int("overtime_grace_minutes")].every((n) => Number.isInteger(n) && n >= 0 && n <= 240), "Grace periods must be 0–240 minutes"],
      [!(Number.isInteger(int("punch_hold_seconds")) && int("punch_hold_seconds") >= 1 && int("punch_hold_seconds") <= 15), "Hold duration must be 1–15 seconds"],
      [!(Number.isInteger(int("gps_max_accuracy_m")) && int("gps_max_accuracy_m") >= 20 && int("gps_max_accuracy_m") <= 1000), "GPS accuracy limit must be 20–1000 meters"],
      [
        text("default_required_hours").trim() !== "" &&
          !(Number(draft.default_required_hours) >= 0.5 && Number(draft.default_required_hours) <= 24),
        "Default daily hours must be 0.5–24",
      ],
    ];
    const bad = checks.find(([b]) => b);
    if (bad) return toast.error(bad[1]);
    setSaving(true);
    try {
      await api("settings", {
        site_name: String(draft.site_name).trim(),
        logo: draft.logo,
        icon: draft.icon,
        language: "en",
        date_format: draft.date_format,
        time_format: draft.time_format,
        hours_format: draft.hours_format,
        early_grace_minutes: int("early_grace_minutes"),
        overtime_grace_minutes: int("overtime_grace_minutes"),
        punch_hold_enabled: draft.punch_hold_enabled === true,
        punch_hold_seconds: int("punch_hold_seconds"),
        gps_max_accuracy_m: int("gps_max_accuracy_m"),
        default_required_hours: text("default_required_hours").trim() === "" ? null : Number(draft.default_required_hours),
        punching_paused: draft.punching_paused === true,
        punching_paused_message: text("punching_paused_message").trim(),
      });
      toast.success("Settings updated");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save settings");
    } finally {
      setSaving(false);
    }
  };

  // ---- live preview of the display formats ----
  const preview = useMemo(() => {
    const d = new Date();
    const dateOpts: Intl.DateTimeFormatOptions =
      draft.date_format === "numeric"
        ? { day: "2-digit", month: "2-digit", year: "numeric" }
        : draft.date_format === "long"
          ? { day: "numeric", month: "long", year: "numeric" }
          : { day: "numeric", month: "short", year: "numeric" };
    const date = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Qatar", ...dateOpts }).format(d);
    const time = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Qatar",
      hour: "2-digit",
      minute: "2-digit",
      hour12: draft.time_format !== "24",
    }).format(d);
    const hours = draft.hours_format === "hhmm" ? "9:42" : "9.7";
    return { date, time, hours };
  }, [draft.date_format, draft.time_format, draft.hours_format]);

  // ---- data & maintenance ----
  const [info, setInfo] = useState<Row | null>(null);
  const loadInfo = () =>
    api("system-info")
      .then(setInfo)
      .catch(() => setInfo(null));
  useEffect(() => {
    if (tab === "data" && isFull) void loadInfo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, isFull]);
  const [days, setDays] = useState("365");
  const [targets, setTargets] = useState<Record<string, boolean>>({ activity: true, failures: true, notifications: true });
  const [preview2, setPreview2] = useState<Row | null>(null);
  const [cleaning, setCleaning] = useState(false);
  const picked = Object.keys(targets).filter((k) => targets[k]);
  const runCleanup = async (dryRun: boolean) => {
    setCleaning(true);
    try {
      const r = await api("data-cleanup", { days: Number(days), targets: picked, dryRun });
      if (dryRun) setPreview2(r.deleted);
      else {
        toast.success("Old records deleted");
        setPreview2(null);
        void loadInfo();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Cleanup failed");
    } finally {
      setCleaning(false);
    }
  };
  const LABELS: Record<string, string> = {
    activity: "activity log entries",
    failures: "failed attempts",
    notifications: "read notifications",
  };

  const saveRegistration = async () => {
    try {
      await api("roles", { action: "toggle-registration", enabled: allowRegistration });
      toast.success("Registration setting saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    }
  };

  return (
    <div className="setLayout">
      <nav className="setTabs" aria-label="Settings sections">
        {TABS.filter((t) => isFull || !["access", "data"].includes(t.id)).map((t) => (
          <button
            key={t.id}
            type="button"
            className={"setTab" + (tab === t.id ? " active" : "")}
            onClick={() => setTab(t.id)}
          >
            <t.icon size={18} />
            <span>
              <b>{t.label}</b>
              <small>{t.hint}</small>
            </span>
          </button>
        ))}
      </nav>

      <div className="setBody">
        {tab === "general" && (
          <section className="uiCard">
            <header className="sectionHead">
              <h3>General</h3>
            </header>
            <div className="setGrid">
              <Field label="Site name" hint="Shown in the header, login page and browser tab">
                <input value={text("site_name")} maxLength={70} onChange={(e) => set("site_name", e.target.value)} />
              </Field>
              <Field label="Default language" hint="More languages can be added later">
                <select value="en" disabled>
                  <option value="en">English</option>
                </select>
              </Field>
              <Field label="Time zone" hint="Attendance days follow Qatar time for everyone">
                <input value="Asia/Qatar (UTC+3)" disabled />
              </Field>
            </div>
            <div className="setImages">
              {(["logo", "icon"] as const).map((k) => (
                <div key={k} className="setImage">
                  <div className="setImagePreview">
                    {draft[k] ? <img src={String(draft[k])} alt="" /> : <Globe size={26} />}
                  </div>
                  <div>
                    <b>{k === "logo" ? "Company logo" : "Website icon"}</b>
                    <small>PNG, JPEG or WebP under 150 KB</small>
                    <div className="setImageActions">
                      <label className="secondary small setFileBtn">
                        Choose file
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          onChange={(e) => {
                            pickImage(k, e.target.files?.[0]);
                            e.target.value = "";
                          }}
                        />
                      </label>
                      {!!draft[k] && (
                        <button type="button" className="secondary small" onClick={() => set(k, "")}>
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <h4 className="setSub">Manage more</h4>
            <div className="setShortcuts">
              {SHORTCUTS.filter((s) => can(s.id)).map((s) => (
                <button key={s.id} type="button" className="setShortcut" onClick={() => go(s.id)}>
                  <s.icon size={18} />
                  <span>
                    <b>{s.label}</b>
                    <small>{s.hint}</small>
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        {tab === "display" && (
          <section className="uiCard">
            <header className="sectionHead">
              <h3>Display formats</h3>
            </header>
            <div className="setGrid">
              <Field label="Date format">
                <select value={text("date_format")} onChange={(e) => set("date_format", e.target.value)}>
                  <option value="short">30 Oct 2026</option>
                  <option value="numeric">30/10/2026</option>
                  <option value="long">30 October 2026</option>
                </select>
              </Field>
              <Field label="Time format">
                <select value={text("time_format")} onChange={(e) => set("time_format", e.target.value)}>
                  <option value="12">12-hour (03:30 PM)</option>
                  <option value="24">24-hour (15:30)</option>
                </select>
              </Field>
              <Field label="Hours format">
                <select value={text("hours_format")} onChange={(e) => set("hours_format", e.target.value)}>
                  <option value="auto">Default (reports 9.7, clocks 09:42)</option>
                  <option value="decimal">Decimal hours (9.7)</option>
                  <option value="hhmm">Hours:minutes (9:42)</option>
                </select>
              </Field>
            </div>
            <div className="setPreview">
              <Info size={15} /> Preview: <b>{preview.date}</b> · <b>{preview.time}</b> · <b>{preview.hours} h</b>
            </div>
          </section>
        )}

        {tab === "attendance" && (
          <section className="uiCard">
            <header className="sectionHead">
              <h3>Attendance rules</h3>
            </header>
            <div className="setGrid">
              <Field label="Early leave grace (minutes)" hint="Leaving this much early is not counted as early leave">
                <input type="number" min="0" max="240" step="1" value={text("early_grace_minutes")} onChange={(e) => set("early_grace_minutes", e.target.value)} />
              </Field>
              <Field label="Overtime grace (minutes)" hint="Extra time below this is not counted as overtime">
                <input type="number" min="0" max="240" step="1" value={text("overtime_grace_minutes")} onChange={(e) => set("overtime_grace_minutes", e.target.value)} />
              </Field>
              <Field label="Maximum GPS error (meters)" hint="Punches with a weaker GPS signal are rejected. Default 150; lower is stricter.">
                <input type="number" min="20" max="1000" step="10" value={text("gps_max_accuracy_m")} onChange={(e) => set("gps_max_accuracy_m", e.target.value)} />
              </Field>
              <Field label="Default daily hours for new employees" hint="Pre-fills the employee form. Leave empty for none.">
                <input type="number" min="0.5" max="24" step="0.5" placeholder="e.g. 8" value={text("default_required_hours")} onChange={(e) => set("default_required_hours", e.target.value)} />
              </Field>
            </div>
            <div className={"setCallout" + (draft.punching_paused ? " warn" : "")}>
              <Toggle
                checked={draft.punching_paused === true}
                onChange={(v) => set("punching_paused", v)}
                title="Pause check in / check out"
                hint="Use during maintenance or holidays. Employees see your message and cannot punch; administrators are not affected."
              />
              {draft.punching_paused === true && (
                <>
                  <Field label="Message shown to employees">
                    <input
                      value={text("punching_paused_message")}
                      maxLength={200}
                      placeholder="Punching is paused until further notice."
                      onChange={(e) => set("punching_paused_message", e.target.value)}
                    />
                  </Field>
                  <p className="setWarn">
                    <TriangleAlert size={15} /> Remember to turn this off and save when you are done.
                  </p>
                </>
              )}
            </div>
          </section>
        )}

        {tab === "punch" && (
          <section className="uiCard">
            <header className="sectionHead">
              <h3>Punch button</h3>
            </header>
            <Toggle
              checked={draft.punch_hold_enabled === true}
              onChange={(v) => set("punch_hold_enabled", v)}
              title="Require press-and-hold"
              hint="Employees keep pressing until the ring around the button is full. This avoids accidental punches."
            />
            <div className="setGrid">
              <Field label="Hold duration (seconds)" hint="1 to 15 seconds">
                <input
                  type="number"
                  min="1"
                  max="15"
                  step="1"
                  disabled={draft.punch_hold_enabled !== true}
                  value={text("punch_hold_seconds")}
                  onChange={(e) => set("punch_hold_seconds", e.target.value)}
                />
              </Field>
            </div>
          </section>
        )}

        {tab === "access" && isFull && (
          <section className="uiCard">
            <header className="sectionHead">
              <h3>Access &amp; security</h3>
            </header>
            <div className="setCallout">
              <Toggle
                checked={allowRegistration}
                onChange={onRegistrationChange}
                title="Allow new user registration"
                hint={allowRegistration ? "The Register link is visible on the login page." : "Public registration is off and the Register link is hidden."}
              />
              <button type="button" className="primary small" onClick={saveRegistration}>
                Save registration setting
              </button>
            </div>
            <h4 className="setSub">Related pages</h4>
            <div className="setShortcuts">
              {[
                { id: "roles", label: "Roles", hint: "Create roles and see their users", icon: Users },
                { id: "permissions", label: "Permissions", hint: "Pages and cards per role", icon: ShieldCheck },
                { id: "devices", label: "Device Security", hint: "Registered devices", icon: Fingerprint },
                { id: "activity-log", label: "Activity Log", hint: "Who changed what", icon: Clock },
                { id: "failed-attempts", label: "Failed Attempts", hint: "Rejected punches", icon: TriangleAlert },
              ]
                .filter((s) => can(s.id))
                .map((s) => (
                  <button key={s.id} type="button" className="setShortcut" onClick={() => go(s.id)}>
                    <s.icon size={18} />
                    <span>
                      <b>{s.label}</b>
                      <small>{s.hint}</small>
                    </span>
                  </button>
                ))}
            </div>
          </section>
        )}

        {tab === "data" && isFull && (
          <section className="uiCard">
            <header className="sectionHead">
              <h3>Data &amp; maintenance</h3>
              <button type="button" className="secondary small" onClick={() => void loadInfo()}>
                <RefreshCw size={14} /> Refresh
              </button>
            </header>
            <div className="setStats">
              {[
                ["Employees", info?.employees],
                ["Active", info?.active_employees],
                ["Attendance records", info?.sessions],
                ["Activity log", info?.activity],
                ["Failed attempts", info?.failures],
                ["Read notifications", info?.notifications],
              ].map(([label, value]) => (
                <div key={String(label)} className="setStat">
                  <small>{label}</small>
                  <b>{value == null ? "—" : Number(value).toLocaleString("en-US")}</b>
                </div>
              ))}
            </div>
            <h4 className="setSub">Clean up old records</h4>
            <p className="setHelp">
              Keeps the database small. Attendance records, employees and points are never deleted here. Preview first, then confirm.
            </p>
            <div className="setGrid">
              <Field label="Delete records older than">
                <select
                  value={days}
                  onChange={(e) => {
                    setDays(e.target.value);
                    setPreview2(null);
                  }}
                >
                  <option value="90">90 days</option>
                  <option value="180">6 months</option>
                  <option value="365">1 year</option>
                  <option value="730">2 years</option>
                </select>
              </Field>
            </div>
            <div className="setChecks">
              {Object.keys(LABELS).map((k) => (
                <label key={k}>
                  <input
                    type="checkbox"
                    checked={!!targets[k]}
                    onChange={(e) => {
                      setTargets((t) => ({ ...t, [k]: e.target.checked }));
                      setPreview2(null);
                    }}
                  />{" "}
                  {LABELS[k][0].toUpperCase() + LABELS[k].slice(1)}
                </label>
              ))}
            </div>
            <div className="setCleanActions">
              <button type="button" className="secondary" disabled={cleaning || !picked.length} onClick={() => void runCleanup(true)}>
                Preview
              </button>
              {preview2 && (
                <button
                  type="button"
                  className="danger"
                  disabled={cleaning || (Object.values(preview2) as number[]).every((n) => !Number(n))}
                  onClick={() => {
                    const lines = Object.entries(preview2)
                      .map(([k, n]) => `${n} ${LABELS[k]}`)
                      .join("\n");
                    if (window.confirm(`Permanently delete:\n${lines}\n\nThis cannot be undone.`)) void runCleanup(false);
                  }}
                >
                  <Trash2 size={15} /> Delete{" "}
                  {(Object.values(preview2) as number[])
                    .reduce((a: number, n: number) => a + Number(n), 0)
                    .toLocaleString("en-US")}{" "}
                  records
                </button>
              )}
            </div>
            {preview2 && (
              <p className="setHelp">
                Found: {Object.entries(preview2).map(([k, n]) => `${n} ${LABELS[k]}`).join(" · ")}
              </p>
            )}
          </section>
        )}

        {dirty && (
          <div className="setSaveBar" role="status">
            <span>You have unsaved changes</span>
            <div>
              <button type="button" className="secondary" disabled={saving} onClick={() => setDraft(base)}>
                <Undo2 size={15} /> Discard
              </button>
              <button type="button" className="primary" disabled={saving} onClick={() => void save()}>
                <Save size={15} /> {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
