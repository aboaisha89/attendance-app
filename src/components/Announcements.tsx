"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Bell,
  Clock3,
  Eye,
  OctagonAlert,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Siren,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import TableTools from "./TableTools";
import { ANNOUNCEMENT_KINDS, kindMeta } from "../lib/announcement-kinds";

type Row = Record<string, any>;

export function KindIcon({ kind, size = 18 }: { kind: unknown; size?: number }) {
  const k = String(kind);
  if (k === "warning") return <TriangleAlert size={size} />;
  if (k === "urgent") return <OctagonAlert size={size} />;
  if (k === "emergency") return <Siren size={size} />;
  return <Bell size={size} />;
}

const QATAR_OFFSET_MS = 3 * 3600 * 1000;
const fmt = (v: unknown) =>
  v
    ? new Date(String(v)).toLocaleString("en-GB", {
        timeZone: "Asia/Qatar",
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
const toLocalInput = (v: unknown) =>
  new Date(new Date(String(v)).getTime() + QATAR_OFFSET_MS).toISOString().slice(0, 16);
const defaultLocal = () =>
  new Date(Date.now() + 3600 * 1000 + QATAR_OFFSET_MS).toISOString().slice(0, 16);
const localToIso = (local: string) => new Date(local + ":00+03:00").toISOString();

type Props = { api: (path: string, payload?: Row) => Promise<Row> };

export default function Announcements({ api }: Props) {
  const [list, setList] = useState<Row[]>([]);
  const [people, setPeople] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [composer, setComposer] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [kind, setKind] = useState("notice");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [everyone, setEveryone] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [find, setFind] = useState("");
  const [when, setWhen] = useState<"now" | "schedule">("now");
  const [sendAt, setSendAt] = useState(defaultLocal());
  const [detail, setDetail] = useState<Row | null>(null);
  const [resend, setResend] = useState<Row | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api("admin-messages");
      setList(r.messages || []);
      setPeople(r.people || []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Unable to load announcements");
    }
  }, [api]);
  useEffect(() => {
    void load();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 30000);
    return () => clearInterval(id);
  }, [load]);

  const reset = () => {
    setComposer(false);
    setEditing(null);
    setKind("notice");
    setTitle("");
    setMessage("");
    setEveryone(true);
    setSelected([]);
    setFind("");
    setWhen("now");
    setSendAt(defaultLocal());
  };
  const openNew = () => {
    reset();
    setComposer(true);
  };
  const openEdit = (m: Row) => {
    setEditing(m);
    setComposer(true);
    setKind(String(m.kind || "notice"));
    setTitle(String(m.title));
    setMessage(String(m.body));
    const aud = (m.audience || {}) as Row;
    setEveryone(m.audience ? aud.everyone === true : true);
    setSelected(((aud.employeeIds as string[]) || []).map(String));
    setWhen("schedule");
    setSendAt(m.scheduled_for ? toLocalInput(m.scheduled_for) : defaultLocal());
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const call = async (payload: Row, ok: string) => {
    setBusy(true);
    try {
      const r = await api("admin-messages", payload);
      toast.success(ok);
      await load();
      return r;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    const base = {
      title,
      message,
      kind,
      everyone,
      employeeIds: selected,
      sendAt: when === "schedule" ? localToIso(sendAt) : undefined,
    };
    const r = editing
      ? await call({ ...base, action: "update", id: editing.id, sendAt: editing.status === "scheduled" ? localToIso(sendAt) : undefined }, "Announcement updated")
      : await call(base, when === "schedule" ? "Announcement scheduled" : "Announcement sent");
    if (r) reset();
  };

  const openDetail = async (m: Row) => {
    try {
      const r = await api("admin-messages", { action: "detail", id: m.id });
      setDetail({ ...m, recipientsList: r.recipients || [] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const visiblePeople = useMemo(
    () =>
      people.filter(
        (p) =>
          !find ||
          (String(p.name) + " " + String(p.email)).toLowerCase().includes(find.toLowerCase()),
      ),
    [people, find],
  );
  const sentLocked = editing && editing.status !== "scheduled";

  return (
    <div className="annPage">
      <section className="efCard">
        <div className="annHead">
          <h3>
            <Bell size={16} /> Announcements
          </h3>
          <div className="annHeadBtns">
            <button type="button" className="secondary small" onClick={() => void load()}>
              <RefreshCw size={14} /> Refresh
            </button>
            {!composer && (
              <button type="button" className="primary small" onClick={openNew}>
                <Plus size={14} /> New announcement
              </button>
            )}
          </div>
        </div>
        <p className="muted">
          Messages appear in a confirmation pop-up and in the notification bell. Each employee must confirm they have
          read it. Scheduled messages are sent automatically at their time.
        </p>
      </section>

      {composer && (
        <section className="efCard">
          <h3>{editing ? "Edit announcement" : "New announcement"}</h3>
          <div className="annKinds">
            {ANNOUNCEMENT_KINDS.map((k) => (
              <button
                key={k.value}
                type="button"
                className={"annKind" + (kind === k.value ? " on" : "")}
                style={kind === k.value ? { borderColor: k.color, background: k.bg, color: k.color } : undefined}
                onClick={() => setKind(k.value)}
              >
                <KindIcon kind={k.value} size={20} />
                <b>{k.label}</b>
                <small>{k.hint}</small>
              </button>
            ))}
          </div>
          <label className="efLabel">
            Title
            <span className="efInput">
              <input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
            </span>
          </label>
          <label className="efLabel">
            Message
            <span className="efInput">
              <textarea value={message} maxLength={3000} rows={4} onChange={(e) => setMessage(e.target.value)} />
            </span>
          </label>

          {!sentLocked && (
            <>
              <label className="efCheck">
                <input type="checkbox" checked={everyone} onChange={(e) => setEveryone(e.target.checked)} />
                <span>
                  <b>Send to all active employees</b>
                </span>
              </label>
              {!everyone && (
                <div className="dcPick">
                  <div className="dcPickBar">
                    <span className="efInput">
                      <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Search employees" />
                    </span>
                    <button type="button" className="secondary small" onClick={() => setSelected((s) => Array.from(new Set([...s, ...visiblePeople.map((p) => String(p.id))])))}>
                      Select all{find ? " (filtered)" : ""}
                    </button>
                    <button type="button" className="secondary small" onClick={() => setSelected([])}>
                      Clear
                    </button>
                    <b>{selected.length} selected</b>
                  </div>
                  <div className="dcPickList">
                    {visiblePeople.map((p) => (
                      <label key={p.id}>
                        <input
                          type="checkbox"
                          checked={selected.includes(String(p.id))}
                          onChange={(e) =>
                            setSelected((old) =>
                              e.target.checked ? [...old, String(p.id)] : old.filter((x) => x !== String(p.id)),
                            )
                          }
                        />
                        {p.name} <small className="muted">{p.email}</small>
                      </label>
                    ))}
                  </div>
                </div>
              )}
              {!editing && (
                <div className="annWhen">
                  <button type="button" className={"dcChip" + (when === "now" ? " on" : "")} onClick={() => setWhen("now")}>
                    <Send size={13} /> Send now
                  </button>
                  <button type="button" className={"dcChip" + (when === "schedule" ? " on" : "")} onClick={() => setWhen("schedule")}>
                    <Clock3 size={13} /> Schedule
                  </button>
                </div>
              )}
              {(when === "schedule" || editing?.status === "scheduled") && (
                <label className="efLabel">
                  Send at (Qatar time)
                  <span className="efInput">
                    <input type="datetime-local" value={sendAt} onChange={(e) => setSendAt(e.target.value)} />
                  </span>
                </label>
              )}
            </>
          )}
          {sentLocked && (
            <p className="muted">
              This message was already sent. You can correct its title, text and type; recipients who have not read it yet
              will see the corrected version. Use Resend to notify people again.
            </p>
          )}
          <div className="efFooter" style={{ position: "static", background: "none" }}>
            <button type="button" className="secondary" onClick={reset}>
              Cancel
            </button>
            <button
              type="button"
              className="primary"
              disabled={busy || title.trim().length < 3 || message.trim().length < 3}
              onClick={() => void submit()}
            >
              {editing ? "Save changes" : when === "schedule" ? "Schedule announcement" : "Send announcement"}
            </button>
          </div>
        </section>
      )}

      <section className="efCard">
        <h3>Messages</h3>
        {list.length === 0 ? (
          <p className="muted">No announcements yet.</p>
        ) : (
          <TableTools>
            <div className="dataScroll">
              <table>
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Title</th>
                    <th>Audience</th>
                    <th>Status</th>
                    <th>Date / Send time</th>
                    <th>Read</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((m) => {
                    const km = kindMeta(m.kind);
                    const aud = (m.audience || {}) as Row;
                    return (
                      <tr key={m.id}>
                        <td>
                          <span className="annTag" style={{ color: km.color, background: km.bg }}>
                            <KindIcon kind={m.kind} size={14} />
                            {km.label}
                          </span>
                        </td>
                        <td>
                          <b>{m.title}</b>
                          <small className="annSnippet">{String(m.body).slice(0, 90)}{String(m.body).length > 90 ? "…" : ""}</small>
                        </td>
                        <td>{m.audience ? (aud.everyone ? "All employees" : `${(aud.employeeIds || []).length} selected`) : `${m.recipients} employees`}</td>
                        <td>
                          <span className={"dcTag " + (m.status === "scheduled" ? "leave" : "worked")}>
                            {m.status === "scheduled" ? "Scheduled" : "Sent"}
                          </span>
                          {m.resend_count > 0 && <small className="muted"> · resent {m.resend_count}×</small>}
                        </td>
                        <td>
                          {m.status === "scheduled" ? fmt(m.scheduled_for) : fmt(m.sent_at || m.created_at)}
                          {m.updated_at && <small className="annSnippet">edited {fmt(m.updated_at)}</small>}
                        </td>
                        <td>
                          {m.status === "scheduled" ? "—" : (
                            <span className="annRead">
                              <i style={{ width: `${m.recipients ? Math.round((m.acknowledged / m.recipients) * 100) : 0}%` }} />
                              <b>{m.acknowledged} / {m.recipients}</b>
                            </span>
                          )}
                        </td>
                        <td>
                          <div className="rowActions">
                            <button type="button" className="secondary small" title="View delivery & read log" onClick={() => void openDetail(m)}>
                              <Eye size={14} />
                            </button>
                            <button type="button" className="secondary small" title="Edit" onClick={() => openEdit(m)}>
                              <Pencil size={14} />
                            </button>
                            {m.status === "scheduled" ? (
                              <button type="button" className="primary small" title="Send now" disabled={busy} onClick={() => void call({ action: "send-now", id: m.id }, "Announcement sent")}>
                                <Send size={14} />
                              </button>
                            ) : (
                              <button type="button" className="secondary small" title="Resend" onClick={() => setResend(m)}>
                                <Send size={14} />
                              </button>
                            )}
                            <button
                              type="button"
                              className="danger small"
                              title="Delete"
                              disabled={busy}
                              onClick={() => {
                                if (window.confirm(`Delete "${m.title}"? Its read log and bell notifications will be removed.`))
                                  void call({ action: "delete", id: m.id }, "Announcement deleted");
                              }}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </TableTools>
        )}
      </section>

      {detail && (
        <div className="modalBackdrop" onClick={() => setDetail(null)}>
          <section className="dialog annDetail" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="annHead">
              <h3>
                <span className="annTag" style={{ color: kindMeta(detail.kind).color, background: kindMeta(detail.kind).bg }}>
                  <KindIcon kind={detail.kind} size={14} />
                  {kindMeta(detail.kind).label}
                </span>{" "}
                {detail.title}
              </h3>
              <button type="button" className="secondary small" onClick={() => setDetail(null)} aria-label="Close">
                <X size={14} />
              </button>
            </div>
            <p className="annBody">{detail.body}</p>
            <p className="muted">
              {detail.status === "scheduled" ? `Scheduled for ${fmt(detail.scheduled_for)}` : `Sent ${fmt(detail.sent_at || detail.created_at)}`}
              {detail.created_by_name ? ` · by ${detail.created_by_name}` : ""}
              {detail.status !== "scheduled" ? ` · ${detail.acknowledged} of ${detail.recipients} have read it` : ""}
            </p>
            {detail.status === "scheduled" ? (
              <p className="muted">Recipients are determined when the message is sent.</p>
            ) : (
              <TableTools defaultSize={25}>
                <div className="dataScroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Employee</th>
                        <th>Email</th>
                        <th>Status</th>
                        <th>Read at</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(detail.recipientsList as Row[]).map((r) => (
                        <tr key={r.id}>
                          <td>
                            {r.name} <small className="muted">{r.public_id}</small>
                          </td>
                          <td>{r.email}</td>
                          <td>
                            <span className={"dcTag " + (r.acknowledged_at ? "worked" : "absent")}>
                              {r.acknowledged_at ? "Read" : "Not read yet"}
                            </span>
                          </td>
                          <td>{fmt(r.acknowledged_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </TableTools>
            )}
          </section>
        </div>
      )}

      {resend && (
        <div className="modalBackdrop" onClick={() => setResend(null)}>
          <section className="dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h3>Resend “{resend.title}”</h3>
            <p className="muted">
              {resend.recipients - resend.acknowledged} of {resend.recipients} employees have not read it yet.
            </p>
            <div className="annResendOpts">
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={async () => {
                  const r = await call({ action: "resend", id: resend.id, mode: "unread" }, "Reminder sent");
                  if (r) setResend(null);
                }}
              >
                Remind unread only
              </button>
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={async () => {
                  const r = await call({ action: "resend", id: resend.id, mode: "all" }, "Announcement resent to everyone");
                  if (r) setResend(null);
                }}
              >
                Resend to everyone (everyone must confirm again)
              </button>
            </div>
            <button type="button" className="secondary small" onClick={() => setResend(null)}>
              Cancel
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
