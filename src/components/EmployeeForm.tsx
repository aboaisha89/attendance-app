"use client";
import { useRef, useState } from "react";
import {
  ArrowLeft,
  Building2,
  Camera,
  Clock3,
  Eye,
  EyeOff,
  Lock,
  Mail,
  ShieldCheck,
  User,
  UserCog,
  Activity,
} from "lucide-react";

import { WEEK_ORDER, WEEKDAY_NAMES } from "../lib/offdays";

type Row = Record<string, any>;
type Props = {
  row: Row | null;
  initialPassword: string;
  initialOffDays: number[];
  roles: { value: string; label: string }[];
  branches: Row[];
  shifts: Row[];
  busy: boolean;
  onCancel: () => void;
  onSubmit: (values: Row, original: string) => void;
  onPhoto: (file: File) => void;
  onPhotoRemove: () => void;
};

const roleHint = (v: string) =>
  v === "admin"
    ? "Full system & management privileges"
    : v === "employee"
      ? "Standard user access for shifts"
      : v === "display"
        ? "On-site attendance display screen"
        : "Custom role access";
const statuses = [
  { value: "active", label: "Active", dot: "#16a34a" },
  { value: "pending", label: "Pending", dot: "#f59e0b" },
  { value: "suspended", label: "Suspended", dot: "#ef4444" },
];
const initials = (n: string) =>
  n
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((x) => x[0]?.toUpperCase())
    .join("") || "?";

function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={"efSwitch" + (on ? " on" : "")}
      onClick={() => onChange(!on)}
    >
      <span />
    </button>
  );
}

export default function EmployeeForm(p: Props) {
  const r = p.row;
  const isEdit = !!r;
  const [v, setV] = useState<Row>(() => ({
    name: r?.name ?? "",
    email: r?.email ?? "",
    password: p.initialPassword,
    role: r?.role ?? "employee",
    status: r?.status ?? "active",
    branchId: r?.branch_id ?? "",
    shiftId: r?.shift_id ?? "",
    requiredDailyHours:
      r?.required_daily_hours == null ? "" : String(r.required_daily_hours),
    variableOvernightShift: !!r?.variable_overnight_shift,
    allowOutsideGeofence: !!r?.allow_outside_geofence,
    allowMultipleDevices: !!r?.allow_multiple_devices,
    maxCheckinEnabled: !!r?.max_checkin_enabled,
    maxCheckinHours:
      r?.max_checkin_hours == null ? "15" : String(Number(r.max_checkin_hours)),
    offDays: p.initialOffDays,
  }));
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const set = (k: string, val: unknown) => setV((o) => ({ ...o, [k]: val }));

  const submit = () => {
    const name = String(v.name).trim();
    if (name.length < 2) return setErr("Full name is required");
    if (!/^\S+@\S+\.\S+$/.test(String(v.email).trim()))
      return setErr("Enter a valid email address");
    if (!isEdit && String(v.password).length < 6)
      return setErr("Password must be at least 6 characters");
    if (isEdit && v.password && String(v.password).length < 6)
      return setErr("Password must be at least 6 characters");
    if (v.maxCheckinEnabled) {
      const h = Number(v.maxCheckinHours);
      if (!Number.isFinite(h) || h <= 0 || h > 72)
        return setErr("Maximum Check-in Duration must be between 0.5 and 72 hours");
    }
    setErr("");
    p.onSubmit({ ...v, name, email: String(v.email).trim() }, p.initialPassword);
  };

  const created = r?.created_at
    ? new Date(r.created_at).toLocaleDateString("en-GB", {
        month: "long",
        year: "numeric",
      })
    : "";

  return (
    <div className="efPage">
      <button type="button" className="efBack" onClick={p.onCancel}>
        <ArrowLeft size={16} /> Back to employees
      </button>

      <section className="efCard efHeader">
        <div className="efAvatarWrap">
          <div className="efAvatar">
            {r?.avatar ? <img src={r.avatar} alt="" /> : initials(String(v.name))}
          </div>
          {isEdit && (
            <button
              type="button"
              className="efCam"
              title="Change avatar"
              onClick={() => file.current?.click()}
            >
              <Camera size={13} />
            </button>
          )}
        </div>
        <div>
          <h2>{String(v.name).trim() || "New employee"}</h2>
          <p>
            {isEdit
              ? `ID: ${r?.public_id || "—"}${created ? " • Added " + created : ""}`
              : "Fill in the details below to create the account"}
          </p>
          {isEdit ? (
            <div className="efLinks">
              <button type="button" onClick={() => file.current?.click()}>
                Change Avatar
              </button>
              <i>•</i>
              <button
                type="button"
                className="danger"
                disabled={!r?.avatar}
                onClick={p.onPhotoRemove}
              >
                Remove
              </button>
            </div>
          ) : (
            <p className="efHint">A photo can be added after the account is created.</p>
          )}
          <input
            ref={file}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) p.onPhoto(f);
              e.target.value = "";
            }}
          />
        </div>
      </section>

      <div className="efGrid">
        <div className="efCol">
          <section className="efCard">
            <h3>
              <User size={16} /> Basic Information
            </h3>
            <label className="efLabel">
              Full Name <b>*</b>
              <span className="efInput">
                <input
                  value={v.name}
                  onChange={(e) => set("name", e.target.value)}
                  autoComplete="off"
                />
              </span>
            </label>
            <label className="efLabel">
              Email Address <b>*</b>
              <span className="efInput">
                <Mail size={15} />
                <input
                  type="email"
                  value={v.email}
                  onChange={(e) => set("email", e.target.value)}
                  autoComplete="off"
                />
              </span>
            </label>
            <label className="efLabel">
              Password {!isEdit && <b>*</b>}
              <span className="efInput">
                <Lock size={15} />
                <input
                  type={showPw ? "text" : "password"}
                  value={v.password}
                  onChange={(e) => set("password", e.target.value)}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  className="efEye"
                  title={showPw ? "Hide password" : "Show password"}
                  onClick={() => setShowPw((s) => !s)}
                >
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </span>
              <small>
                {isEdit
                  ? "Change it to set a new password; the employee must update it at next sign-in."
                  : "The employee must change it at first sign-in."}
              </small>
            </label>
          </section>

          <section className="efCard">
            <h3>
              <Clock3 size={16} /> Work Parameters &amp; Hours
            </h3>
            <div className="efTwo">
              <label className="efLabel">
                Required Daily Hours
                <span className="efInput">
                  <input
                    type="number"
                    min="0"
                    max="24"
                    step="0.25"
                    placeholder="e.g. 8"
                    value={v.requiredDailyHours}
                    onChange={(e) => set("requiredDailyHours", e.target.value)}
                  />
                </span>
                <small>Leave blank = no target</small>
              </label>
              <label className="efLabel">
                Assigned Shift
                <span className="efInput">
                  <select
                    value={v.shiftId}
                    onChange={(e) => set("shiftId", e.target.value)}
                  >
                    <option value="">Flexible schedule (no fixed shift)</option>
                    {p.shifts.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </span>
              </label>
            </div>
            <label className="efCheck">
              <input
                type="checkbox"
                checked={v.variableOvernightShift}
                onChange={(e) => set("variableOvernightShift", e.target.checked)}
              />
              <span>
                <b>Variable / Overnight Shift</b>
                <small>(May finish check-out on the next calendar day)</small>
              </span>
            </label>
          </section>

          <section className="efCard">
            <h3>
              <Clock3 size={16} /> Weekly Off Days
            </h3>
            <div className="dcChips">
              {WEEK_ORDER.map((d) => (
                <button
                  key={d}
                  type="button"
                  className={
                    "dcChip" + ((v.offDays as number[]).includes(d) ? " on" : "")
                  }
                  onClick={() =>
                    set(
                      "offDays",
                      (v.offDays as number[]).includes(d)
                        ? (v.offDays as number[]).filter((x) => x !== d)
                        : [...(v.offDays as number[]), d],
                    )
                  }
                >
                  {WEEKDAY_NAMES[d]}
                </button>
              ))}
            </div>
            <small className="efHint">
              No absence is counted on these days unless the employee checks
              in. {isEdit && "Changes apply from today; earlier days are not affected (use Day Control for past dates)."}
            </small>
          </section>

          <section className="efCard">
            <h3>
              <ShieldCheck size={16} /> Location &amp; Security Settings
            </h3>
            <div className="efRow">
              <div>
                <b>Allow Check-in/Check-out Outside Geofence</b>
                <small>Permit employee to mark attendance outside designated GPS boundary.</small>
              </div>
              <Toggle
                on={v.allowOutsideGeofence}
                onChange={(x) => set("allowOutsideGeofence", x)}
                label="Allow outside geofence"
              />
            </div>
            <div className="efRow">
              <div>
                <b>Allow Multiple Devices</b>
                <small>Off = restricted to one primary registered device only.</small>
              </div>
              <Toggle
                on={v.allowMultipleDevices}
                onChange={(x) => set("allowMultipleDevices", x)}
                label="Allow multiple devices"
              />
            </div>
            <div className="efRow">
              <div>
                <b>Enable Maximum Check-in Duration</b>
                <small>A session left open past this limit is recorded as Absent (no hours counted).</small>
              </div>
              <Toggle
                on={v.maxCheckinEnabled}
                onChange={(x) => set("maxCheckinEnabled", x)}
                label="Enable maximum check-in duration"
              />
            </div>
            {v.maxCheckinEnabled && (
              <label className="efLabel efIndent">
                Maximum Check-in Duration (Hours)
                <span className="efInput">
                  <input
                    type="number"
                    min="0.5"
                    max="72"
                    step="0.5"
                    value={v.maxCheckinHours}
                    onChange={(e) => set("maxCheckinHours", e.target.value)}
                  />
                </span>
              </label>
            )}
          </section>
        </div>

        <div className="efCol">
          <section className="efCard">
            <h3>
              <UserCog size={16} /> Role Access
            </h3>
            <div className="efChoices">
              {p.roles.map((o) => (
                <label
                  key={o.value}
                  className={"efChoice" + (v.role === o.value ? " sel" : "")}
                >
                  <input
                    type="radio"
                    name="role"
                    checked={v.role === o.value}
                    onChange={() => set("role", o.value)}
                  />
                  <span>
                    <b>{o.label}</b>
                    <small>{roleHint(o.value)}</small>
                  </span>
                </label>
              ))}
            </div>
          </section>

          <section className="efCard">
            <h3>
              <Activity size={16} /> Account Status
            </h3>
            <div className="efChoices">
              {statuses.map((o) => (
                <label
                  key={o.value}
                  className={"efChoice" + (v.status === o.value ? " sel" : "")}
                >
                  <input
                    type="radio"
                    name="status"
                    checked={v.status === o.value}
                    onChange={() => set("status", o.value)}
                  />
                  <span>
                    <b>{o.label}</b>
                  </span>
                  <i className="efDot" style={{ background: o.dot }} />
                </label>
              ))}
            </div>
          </section>

          <section className="efCard">
            <h3>
              <Building2 size={16} /> Assigned Branch
            </h3>
            <div className="efChoices">
              <label className={"efChoice" + (!v.branchId ? " sel" : "")}>
                <input
                  type="radio"
                  name="branch"
                  checked={!v.branchId}
                  onChange={() => set("branchId", "")}
                />
                <span>
                  <b>Unassigned</b>
                </span>
              </label>
              {p.branches.map((b) => (
                <label
                  key={b.id}
                  className={"efChoice" + (v.branchId === b.id ? " sel" : "")}
                >
                  <input
                    type="radio"
                    name="branch"
                    checked={v.branchId === b.id}
                    onChange={() => set("branchId", b.id)}
                  />
                  <span>
                    <b>{b.name}</b>
                    {b.address && <small>{b.address}</small>}
                  </span>
                </label>
              ))}
            </div>
          </section>
        </div>
      </div>

      {err && <p className="efError">{err}</p>}
      <div className="efFooter">
        <button type="button" className="secondary" onClick={p.onCancel}>
          Cancel
        </button>
        <button type="button" className="primary" disabled={p.busy} onClick={submit}>
          {p.busy ? "Saving…" : isEdit ? "Save Changes" : "Create Employee"}
        </button>
      </div>
    </div>
  );
}
