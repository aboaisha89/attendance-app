export type AnnouncementKind = "notice" | "warning" | "urgent" | "emergency";
export const ANNOUNCEMENT_KINDS: { value: AnnouncementKind; label: string; hint: string; color: string; bg: string }[] = [
  { value: "notice", label: "Notice", hint: "General information", color: "#1d7fd1", bg: "#e8f3fc" },
  { value: "warning", label: "Warning", hint: "Needs attention", color: "#b45309", bg: "#fff4dc" },
  { value: "urgent", label: "Urgent", hint: "Action required soon", color: "#c2410c", bg: "#ffe8d9" },
  { value: "emergency", label: "Emergency", hint: "Critical — act immediately", color: "#b91c1c", bg: "#fde2e2" },
];
export const kindMeta = (k: unknown) =>
  ANNOUNCEMENT_KINDS.find((x) => x.value === k) || ANNOUNCEMENT_KINDS[0];
