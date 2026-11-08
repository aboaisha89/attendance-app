"use client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  MapPinOff,
  MapPinned,
  ShieldAlert,
  TimerOff,
  Satellite,
  WifiOff,
  Building2,
  Smartphone,
  Coffee,
  Lock,
  TriangleAlert,
  CircleAlert,
  LocateOff,
  CircleCheck,
  X,
  Pause,
} from "lucide-react";

export type PunchAlertKind = "error" | "warning" | "info";
export type PunchAlertInfo = {
  code: string;
  kind: PunchAlertKind;
  title: string;
  message: string;
  steps?: string[];
};

/** Thrown by getPunchPosition() so the UI can tell exactly why GPS failed. */
export class PunchGeoError extends Error {
  geoCode: "permission_denied" | "gps_off" | "gps_timeout" | "geo_unsupported" | "insecure_context";
  constructor(geoCode: PunchGeoError["geoCode"]) {
    super(geoCode);
    this.geoCode = geoCode;
  }
}

export const PUNCH_ALERTS: Record<string, PunchAlertInfo> = {
  gps_off: {
    code: "gps_off",
    kind: "error",
    title: "GPS is turned off",
    message:
      "We couldn't get your location. Location Services look switched off, or there is no GPS signal.",
    steps: [
      "Turn on Location / GPS from your phone's quick settings",
      "Choose “High accuracy” mode if your phone asks",
      "Then press and hold the button again",
    ],
  },
  permission_denied: {
    code: "permission_denied",
    kind: "error",
    title: "Location access is blocked",
    message:
      "Attendance needs your location to verify that you are at work. This browser is blocking it.",
    steps: [
      "Tap the lock / site-settings icon next to the address bar",
      "Set Location to “Allow”",
      "Reload the page and try again",
    ],
  },
  gps_timeout: {
    code: "gps_timeout",
    kind: "warning",
    title: "Location request timed out",
    message: "Your device took too long to find your position.",
    steps: [
      "Move to an open area or next to a window",
      "Make sure GPS is on and you have a signal",
      "Try again",
    ],
  },
  geo_unsupported: {
    code: "geo_unsupported",
    kind: "error",
    title: "Location isn't supported",
    message: "This browser or device can't provide your location.",
    steps: ["Use an up-to-date Chrome, Safari or Edge browser"],
  },
  insecure_context: {
    code: "insecure_context",
    kind: "error",
    title: "Secure connection required",
    message: "Your browser only shares location on secure (HTTPS) pages.",
    steps: ["Open the app using its https:// address"],
  },
  weak_signal: {
    code: "weak_signal",
    kind: "warning",
    title: "Weak GPS signal",
    message: "Your location isn't accurate enough to verify attendance.",
    steps: [
      "Move outdoors or next to a window",
      "Turn on precise / high-accuracy location",
      "Wait a few seconds, then try again",
    ],
  },
  outside_zone: {
    code: "outside_zone",
    kind: "error",
    title: "You're outside the allowed area",
    message: "You must be inside your work zone to check in or out.",
    steps: ["Move inside your workplace zone", "Then press and hold the button again"],
  },
  no_branch: {
    code: "no_branch",
    kind: "warning",
    title: "No branch assigned",
    message:
      "Your administrator needs to assign you to a branch before you can punch.",
  },
  no_zone: {
    code: "no_zone",
    kind: "warning",
    title: "No active work zone",
    message:
      "There is no active location zone for your branch. Please contact your administrator.",
  },
  on_break: {
    code: "on_break",
    kind: "warning",
    title: "You're on a break",
    message: "End your break first, then check out.",
  },
  already_active: {
    code: "already_active",
    kind: "info",
    title: "You're already checked in",
    message: "An active session already exists for you. Refresh the page to see it.",
  },
  device_blocked: {
    code: "device_blocked",
    kind: "error",
    title: "This device isn't registered",
    message:
      "Your account is linked to another device. Your administrator has been notified.",
    steps: ["Ask your administrator to reset your device"],
  },
  network: {
    code: "network",
    kind: "error",
    title: "No internet connection",
    message: "We couldn't reach the server. Check your connection and try again.",
  },
  paused: {
    code: "paused",
    kind: "warning",
    title: "Punching is paused",
    message: "Your administrator has temporarily paused check in and check out.",
  },
  outside_allowed: {
    code: "outside_allowed",
    kind: "warning",
    title: "Saved — outside the work zone",
    message:
      "Your attendance was recorded, but you were outside the zone (allowed for your account).",
  },
  generic: {
    code: "generic",
    kind: "error",
    title: "Couldn't save your attendance",
    message: "Something went wrong. Please try again.",
  },
};

const ICONS: Record<string, typeof MapPinOff> = {
  gps_off: LocateOff,
  permission_denied: ShieldAlert,
  gps_timeout: TimerOff,
  geo_unsupported: LocateOff,
  insecure_context: Lock,
  weak_signal: Satellite,
  outside_zone: MapPinOff,
  no_branch: Building2,
  no_zone: MapPinned,
  on_break: Coffee,
  already_active: CircleCheck,
  device_blocked: Smartphone,
  network: WifiOff,
  outside_allowed: MapPinOff,
  paused: Pause,
  generic: TriangleAlert,
};

export function PunchIcon({ code, size = 22 }: { code: string; size?: number }) {
  const Icon = ICONS[code] || CircleAlert;
  return <Icon size={size} strokeWidth={2} aria-hidden="true" />;
}

/** Ask the browser for a precise position, with a precise reason when it fails. */
export function getPunchPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (typeof window !== "undefined" && window.isSecureContext === false)
      return reject(new PunchGeoError("insecure_context"));
    if (typeof navigator === "undefined" || !navigator.geolocation)
      return reject(new PunchGeoError("geo_unsupported"));
    navigator.geolocation.getCurrentPosition(
      resolve,
      (err) =>
        reject(
          new PunchGeoError(
            err.code === 1
              ? "permission_denied"
              : err.code === 3
                ? "gps_timeout"
                : "gps_off",
          ),
        ),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  });
}

type ApiError = Error & { code?: string; meta?: Record<string, any>; status?: number };

/** Turn any error thrown while punching into a friendly, icon-ready alert. */
export function classifyPunchError(e: unknown): PunchAlertInfo {
  if (e instanceof PunchGeoError) return PUNCH_ALERTS[e.geoCode];
  const err = (e || {}) as ApiError;
  const message = e instanceof Error ? e.message : String(e || "");
  const meta = err.meta || {};
  switch (err.code) {
    case "GPS_INVALID":
      return PUNCH_ALERTS.gps_off;
    case "LOW_ACCURACY":
      return {
        ...PUNCH_ALERTS.weak_signal,
        message: `Your GPS accuracy is ${Math.round(Number(meta.accuracy) || 0)} m, but at most ${Math.round(Number(meta.max) || 150)} m is allowed.`,
      };
    case "OUTSIDE_ZONE":
      return { ...PUNCH_ALERTS.outside_zone, message: message || PUNCH_ALERTS.outside_zone.message };
    case "NO_BRANCH":
      return PUNCH_ALERTS.no_branch;
    case "NO_ZONE":
      return PUNCH_ALERTS.no_zone;
    case "ON_BREAK":
      return PUNCH_ALERTS.on_break;
    case "ACTIVE_SESSION":
      return PUNCH_ALERTS.already_active;
    case "PUNCH_PAUSED":
      return { ...PUNCH_ALERTS.paused, message: message || PUNCH_ALERTS.paused.message };
  }
  if (e instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(message))
    return PUNCH_ALERTS.network;
  if (/another device|not registered/i.test(message)) return PUNCH_ALERTS.device_blocked;
  return { ...PUNCH_ALERTS.generic, message: message || PUNCH_ALERTS.generic.message };
}

/** Toast with the matching icon. */
export function punchToast(info: PunchAlertInfo) {
  const opts = {
    description: info.message,
    icon: <PunchIcon code={info.code} size={20} />,
    duration: 6500,
    id: "punch-alert",
  };
  if (info.kind === "error") toast.error(info.title, opts);
  else if (info.kind === "warning") toast.warning(info.title, opts);
  else toast.info(info.title, opts);
}

/** Persistent card shown on the punch page. */
export function PunchAlertCard({
  alert,
  onClose,
}: {
  alert: PunchAlertInfo;
  onClose?: () => void;
}) {
  return (
    <div className={"punchAlert " + alert.kind} role="alert">
      <span className="paIcon">
        <PunchIcon code={alert.code} size={22} />
      </span>
      <div className="paBody">
        <strong>{alert.title}</strong>
        <p>{alert.message}</p>
        {alert.steps && alert.steps.length > 0 && (
          <ol className="paSteps">
            {alert.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        )}
      </div>
      {onClose && (
        <button
          type="button"
          className="paClose"
          onClick={onClose}
          aria-label="Dismiss"
        >
          <X size={16} />
        </button>
      )}
    </div>
  );
}

/**
 * Warns up-front (before the employee even presses the button) when location
 * can't work: blocked permission, unsupported browser, or a non-HTTPS page.
 */
export function usePunchEnvironmentAlert(enabled: boolean): PunchAlertInfo | null {
  const [permission, setPermission] = useState<string>("unknown");
  const [insecure, setInsecure] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    setInsecure(window.isSecureContext === false);
    setUnsupported(!navigator.geolocation);
    let status: PermissionStatus | null = null;
    let dead = false;
    const update = () => {
      if (status && !dead) setPermission(status.state);
    };
    navigator.permissions
      ?.query({ name: "geolocation" as PermissionName })
      .then((s) => {
        status = s;
        update();
        s.onchange = update;
      })
      .catch(() => {});
    return () => {
      dead = true;
      if (status) status.onchange = null;
    };
  }, [enabled]);
  if (!enabled) return null;
  if (insecure) return PUNCH_ALERTS.insecure_context;
  if (unsupported) return PUNCH_ALERTS.geo_unsupported;
  if (permission === "denied") return PUNCH_ALERTS.permission_denied;
  return null;
}
