export const KIND_COLOR: Record<string, string> = { in: "#16a34a", out: "#2563eb", fail: "#dc2626" };
export const KIND_LABEL: Record<string, string> = { in: "Check-in", out: "Check-out", fail: "Failed attempt" };

export const fmtTime = (v: unknown) =>
  new Date(String(v)).toLocaleString("en-GB", {
    timeZone: "Asia/Qatar",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
