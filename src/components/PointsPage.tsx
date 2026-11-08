"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Download,
  FileSpreadsheet,
  Info,
  Printer,
  RefreshCw,
  Scale,
  Settings2,
  Trash2,
  X,
} from "lucide-react";

type Row = Record<string, any>;
type Api = (path: string, payload?: Row) => Promise<Row>;
type PType = "green" | "red" | "black";

const TYPE_LABEL: Record<PType, string> = {
  green: "Green · Overtime",
  red: "Red · Late / early leave",
  black: "Black · Absence & penalties",
};
const SHORT: Record<PType, string> = { green: "Green", red: "Red", black: "Black" };

const qatarToday = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Qatar",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const pad = (n: number) => String(n).padStart(2, "0");
const lastDayOf = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

type PeriodKey = "month" | "lastMonth" | "quarter" | "custom";
function periodFor(key: PeriodKey, today: string) {
  const [y, m] = today.split("-").map(Number);
  if (key === "lastMonth") {
    const py = m === 1 ? y - 1 : y;
    const pm = m === 1 ? 12 : m - 1;
    return { from: `${py}-${pad(pm)}-01`, to: `${py}-${pad(pm)}-${pad(lastDayOf(py, pm))}` };
  }
  if (key === "quarter") {
    const qs = Math.floor((m - 1) / 3) * 3 + 1;
    const qe = qs + 2;
    return { from: `${y}-${pad(qs)}-01`, to: `${y}-${pad(qe)}-${pad(lastDayOf(y, qe))}` };
  }
  return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(lastDayOf(y, m))}` };
}

const money = (n: number | null | undefined, cur: string) =>
  n == null || !Number.isFinite(n)
    ? "—"
    : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " " + cur;
const fmtMin = (m: number) => {
  const r = Math.max(0, Math.round(m));
  return r >= 60 ? `${Math.floor(r / 60)}h ${pad(r % 60)}m` : `${r}m`;
};
const dmy = (d: string) => (d ? d.slice(8, 10) + "/" + d.slice(5, 7) + "/" + d.slice(0, 4) : "");
const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);

/* ------------------------------------------------------------------ */
/* Dashboard cards (employee dashboard only)                           */
/* ------------------------------------------------------------------ */
export function PointsCards({
  api,
  version,
  onOpen,
  canOpen,
}: {
  api: Api;
  version: number;
  onOpen: () => void;
  canOpen: boolean;
}) {
  const [d, setD] = useState<Row | null>(null);
  useEffect(() => {
    let live = true;
    api("points?self=1&summary=1")
      .then((r) => live && setD(r))
      .catch(() => live && setD(null));
    return () => {
      live = false;
    };
  }, [api, version]);
  if (!d || d.enabled !== true || !d.balance) return null;
  const b = d.balance as Record<PType, number>;
  const cards: { t: PType; title: string; sub: string }[] = [
    {
      t: "green",
      title: "Green points",
      sub: `Overtime · ${fmtMin(d.greenBucketMinutes || 0)} of ${fmtMin(d.greenPerPointMinutes || 0)} to the next`,
    },
    {
      t: "red",
      title: "Red points",
      sub: `Late / early leave · ${b.red} of ${d.redToBlackAt} before a black point`,
    },
    { t: "black", title: "Black points", sub: "Absence & penalties" },
  ];
  return (
    <div className="ptsCards" role="group" aria-label="Points">
      {cards.map((c) => (
        <button
          key={c.t}
          type="button"
          className={"ptsCard " + c.t}
          onClick={canOpen ? onOpen : undefined}
          disabled={!canOpen}
        >
          <span className="ptsDot" />
          <small>{c.title}</small>
          <b>{b[c.t]}</b>
          <em>{c.sub}</em>
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Shared pieces                                                       */
/* ------------------------------------------------------------------ */
function PeriodBar({
  value,
  onChange,
}: {
  value: { key: PeriodKey; from: string; to: string };
  onChange: (v: { key: PeriodKey; from: string; to: string }) => void;
}) {
  const today = qatarToday();
  const quick: [PeriodKey, string][] = [
    ["month", "This month"],
    ["lastMonth", "Last month"],
    ["quarter", "This quarter"],
  ];
  return (
    <div className="ptsPeriod">
      <div className="ptsQuick">
        {quick.map(([k, label]) => (
          <button
            key={k}
            type="button"
            className={"secondary small" + (value.key === k ? " active" : "")}
            onClick={() => onChange({ key: k, ...periodFor(k, today) })}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          className={"secondary small" + (value.key === "custom" ? " active" : "")}
          onClick={() => onChange({ ...value, key: "custom" })}
        >
          Custom
        </button>
      </div>
      <label>
        From
        <input
          type="date"
          value={value.from}
          onChange={(e) => onChange({ key: "custom", from: e.target.value, to: value.to })}
        />
      </label>
      <label>
        To
        <input
          type="date"
          value={value.to}
          onChange={(e) => onChange({ key: "custom", from: value.from, to: e.target.value })}
        />
      </label>
    </div>
  );
}

function Chip({ t, children }: { t: PType; children: React.ReactNode }) {
  return <span className={"ptsChip " + t}>{children}</span>;
}

function EventsTable({ events }: { events: Row[] }) {
  if (!events.length) return <p className="ptsEmpty">No points in this period.</p>;
  return (
    <div className="dataScroll">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Colour</th>
            <th>Points</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e, i) => (
            <tr key={i}>
              <td>{dmy(e.date)}</td>
              <td>
                <Chip t={e.type}>{SHORT[e.type as PType]}</Chip>
              </td>
              <td className={e.points < 0 ? "ptsNeg" : "ptsPos"}>
                {e.points > 0 ? "+" : ""}
                {e.points}
              </td>
              <td>{e.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SettlementsList({
  items,
  onDelete,
}: {
  items: Row[];
  onDelete?: (id: string) => void;
}) {
  if (!items.length) return null;
  return (
    <div className="ptsSettled">
      <h4>Settlements</h4>
      {items.map((s) => (
        <div key={s.id} className="ptsSettleRow">
          <span>
            {dmy(String(s.settled_on).slice(0, 10))} ·{" "}
            {s.kind === "green_black"
              ? `${s.count} green cancelled ${s.count} black`
              : `${s.count} green cancelled ${s.red_points} red`}
            {s.note ? ` · ${s.note}` : ""}
          </span>
          {onDelete && (
            <button
              type="button"
              className="secondary small"
              aria-label="Remove settlement"
              onClick={() => onDelete(String(s.id))}
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

const HOW_IT_WORKS = (
  <ul className="ptsHow">
    <li>
      <Chip t="green">Green</Chip> Overtime. Enough extra hours to equal your full workday earns 1 green point.
    </li>
    <li>
      <Chip t="red">Red</Chip> Late arrival or leaving early. Every hour short earns 1 red point (after the grace period).
    </li>
    <li>
      <Chip t="black">Black</Chip> A full day of absence, or red points that add up to a full workday.
    </li>
    <li>1 green point can cancel 1 black point, or a workday&apos;s worth of red points.</li>
  </ul>
);

/* ------------------------------------------------------------------ */
/* Employee view                                                       */
/* ------------------------------------------------------------------ */
function PointsSelf({ api, version }: { api: Api; version: number }) {
  const today = qatarToday();
  const [period, setPeriod] = useState<{ key: PeriodKey; from: string; to: string }>({
    key: "month",
    ...periodFor("month", today),
  });
  const [type, setType] = useState("all");
  const [d, setD] = useState<Row | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let live = true;
    setErr("");
    api(`points?self=1&from=${period.from}&to=${period.to}&type=${type}`)
      .then((r) => live && setD(r))
      .catch((e) => live && setErr(e instanceof Error ? e.message : "Could not load points"));
    return () => {
      live = false;
    };
  }, [api, period.from, period.to, type, version]);

  if (err) return <p className="ptsEmpty">{err}</p>;
  if (!d) return <p className="ptsEmpty">Loading…</p>;
  if (d.enabled !== true) return <p className="ptsEmpty">Points are not enabled yet.</p>;
  const b = d.balance as Record<PType, number>;
  const t = d.totals as Row;
  return (
    <>
      <section className="uiCard">
        <header className="sectionHead">
          <h3>My points balance</h3>
        </header>
        <div className="ptsCards big">
          {(["green", "red", "black"] as PType[]).map((k) => (
            <div key={k} className={"ptsCard static " + k}>
              <span className="ptsDot" />
              <small>{TYPE_LABEL[k]}</small>
              <b>{b[k]}</b>
              <em>
                {k === "red"
                  ? `${b.red} of ${d.redToBlackAt} before a black point`
                  : k === "green"
                    ? `${fmtMin(d.greenBucketMinutes || 0)} of ${fmtMin(d.greenPerPointMinutes || 0)} to the next`
                    : "Current balance"}
              </em>
            </div>
          ))}
        </div>
        <details className="ptsDetails">
          <summary>
            <Info size={14} /> How points work
          </summary>
          {HOW_IT_WORKS}
        </details>
      </section>
      <section className="uiCard">
        <header className="sectionHead">
          <h3>Points history</h3>
        </header>
        <div className="ptsFilters">
          <PeriodBar value={period} onChange={setPeriod} />
          <label>
            Colour
            <select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="all">All</option>
              <option value="green">Green only</option>
              <option value="red">Red only</option>
              <option value="black">Black only</option>
            </select>
          </label>
        </div>
        <p className="ptsSummaryLine">
          This period: <Chip t="green">+{t.greenEarned}</Chip> <Chip t="red">+{t.redEarned}</Chip>{" "}
          <Chip t="black">+{t.blackAbsent + t.blackConverted}</Chip>
        </p>
        <EventsTable events={d.events || []} />
        <SettlementsList items={d.settlements || []} />
      </section>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Administrator view                                                  */
/* ------------------------------------------------------------------ */
function download(name: string, content: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function PointsAdmin({
  api,
  isFull,
  staff,
  branches,
  version,
}: {
  api: Api;
  isFull: boolean;
  staff: Row[];
  branches: Row[];
  version: number;
}) {
  const today = qatarToday();
  const [tab, setTab] = useState<"report" | "rules">("report");
  const [period, setPeriod] = useState<{ key: PeriodKey; from: string; to: string }>({
    key: "month",
    ...periodFor("month", today),
  });
  const [employee, setEmployee] = useState("");
  const [branch, setBranch] = useState("");
  const [type, setType] = useState("all");
  const [data, setData] = useState<Row | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const [openId, setOpenId] = useState("");
  const reload = () => setTick((n) => n + 1);

  useEffect(() => {
    let live = true;
    setErr("");
    const q = new URLSearchParams({ from: period.from, to: period.to, type });
    if (employee) q.set("employee", employee);
    if (branch) q.set("branch", branch);
    api("points?" + q.toString())
      .then((r) => live && setData(r))
      .catch((e) => live && setErr(e instanceof Error ? e.message : "Could not load points"));
    return () => {
      live = false;
    };
  }, [api, period.from, period.to, employee, branch, type, tick, version]);

  const cfg = (data?.config || {}) as Row;
  const cur = String(cfg.currency || "QAR");
  const rows: Row[] = data?.rows || [];
  const show = (t: PType) => type === "all" || type === t;

  const totals = useMemo(() => {
    const s = { g: 0, r: 0, b: 0, bonus: 0, ded: 0, net: 0, missing: 0 };
    for (const r of rows) {
      s.g += r.totals.netGreen;
      s.r += r.totals.netRed;
      s.b += r.totals.netBlack;
      if (r.amounts.net == null) s.missing++;
      else {
        s.bonus += r.amounts.bonus;
        s.ded += r.amounts.deduction;
        s.net += r.amounts.net;
      }
    }
    return s;
  }, [rows]);

  const autoSettle = async () => {
    const ids = rows.filter((r) => r.balance.green > 0).map((r) => String(r.id));
    if (!ids.length) return toast.info("No listed employee has green points to settle");
    if (
      !window.confirm(
        `Settle automatically for ${ids.length} employee(s)?\nGreen points will cancel black points first, then red points.`,
      )
    )
      return;
    setBusy(true);
    try {
      const r = await api("points", { action: "auto-settle", employeeIds: ids });
      toast.success(
        r.employees
          ? `Settled ${r.employees} employee(s): ${r.againstBlack} against black, ${r.againstRed} against red`
          : "Nothing to settle",
      );
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Settlement failed");
    } finally {
      setBusy(false);
    }
  };

  const tableCols = () => {
    const cols = ["Employee", "Branch"];
    if (show("green")) cols.push("Green (net)", "Green earned");
    if (show("red")) cols.push("Red (net)", "Red earned");
    if (show("black")) cols.push("Black (net)", "Black earned");
    cols.push("Settled", `Bonus (${cur})`, `Deduction (${cur})`, `Net (${cur})`);
    return cols;
  };
  const tableData = () =>
    rows.map((r) => {
      const t = r.totals;
      const out: (string | number)[] = [r.name, r.branch_name || ""];
      if (show("green")) out.push(t.netGreen, t.greenEarned);
      if (show("red")) out.push(t.netRed, t.redEarned);
      if (show("black")) out.push(t.netBlack, t.blackAbsent + t.blackConverted);
      out.push(
        `G→B ${t.blackCancelled} · G→R ${t.redCancelled}`,
        r.amounts.bonus == null ? "" : r.amounts.bonus.toFixed(2),
        r.amounts.deduction == null ? "" : r.amounts.deduction.toFixed(2),
        r.amounts.net == null ? "" : r.amounts.net.toFixed(2),
      );
      return out;
    });
  const title = `Employee Points ${dmy(period.from)} – ${dmy(period.to)}`;

  const exportExcel = () => {
    if (!rows.length) return toast.info("Nothing to export");
    const head = tableCols()
      .map((c) => {
        const bg = c.startsWith("Green") ? "#16a34a" : c.startsWith("Red") ? "#dc2626" : c.startsWith("Black") ? "#111827" : "#334155";
        return `<th style="background:${bg};color:#fff;border:1px solid #999;padding:6px">${esc(c)}</th>`;
      })
      .join("");
    const body = tableData()
      .map((r) => "<tr>" + r.map((c) => `<td style="border:1px solid #bbb;padding:5px">${esc(c)}</td>`).join("") + "</tr>")
      .join("");
    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"></head><body><h3>${esc(title)}</h3><table>${"<tr>" + head + "</tr>"}${body}</table></body></html>`;
    download(`points-${period.from}-to-${period.to}.xls`, "\uFEFF" + html, "application/vnd.ms-excel;charset=utf-8");
  };
  const exportPdf = () => {
    if (!rows.length) return toast.info("Nothing to export");
    const w = window.open("", "_blank");
    if (!w) return toast.error("Allow pop-ups to export the PDF");
    const head = tableCols().map((c) => `<th>${esc(c)}</th>`).join("");
    const body = tableData()
      .map((r) => "<tr>" + r.map((c) => `<td>${esc(c)}</td>`).join("") + "</tr>")
      .join("");
    w.document.write(
      `<html><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{font-family:Arial,sans-serif;padding:24px;color:#111}h2{margin:0 0 4px}p{margin:0 0 14px;color:#555;font-size:13px}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #bbb;padding:6px 8px;text-align:left}th{background:#f1f5f9}@page{size:landscape;margin:12mm}</style></head><body><h2>${esc(title)}</h2><p>Net points are earned points minus conversions and settlements in this period.</p><table><tr>${head}</tr>${body}</table><script>window.onload=function(){window.print()}<\/script></body></html>`,
    );
    w.document.close();
  };

  return (
    <>
      <div className="ptsTabs">
        <button type="button" className={tab === "report" ? "active" : ""} onClick={() => setTab("report")}>
          Points report
        </button>
        {isFull && (
          <button type="button" className={tab === "rules" ? "active" : ""} onClick={() => setTab("rules")}>
            <Settings2 size={15} /> Rules &amp; pricing
          </button>
        )}
      </div>

      {tab === "rules" && isFull ? (
        <PointsRules api={api} data={data} onSaved={reload} />
      ) : (
        <section className="uiCard">
          <header className="sectionHead">
            <h3>Points report</h3>
            <div className="actions">
              <button type="button" className="secondary small" onClick={reload}>
                <RefreshCw size={14} /> Refresh
              </button>
              <button type="button" className="secondary small" onClick={exportExcel}>
                <FileSpreadsheet size={14} /> Excel
              </button>
              <button type="button" className="secondary small" onClick={exportPdf}>
                <Printer size={14} /> PDF
              </button>
              {isFull && (
                <button type="button" className="primary small" disabled={busy} onClick={autoSettle}>
                  <Scale size={14} /> Auto-settle
                </button>
              )}
            </div>
          </header>

          {data && data.enabled === false ? (
            <p className="ptsEmpty">
              Points are turned off.{" "}
              {isFull ? "Open “Rules & pricing” to enable them." : "Ask an administrator to enable them."}
            </p>
          ) : (
            <>
              <div className="ptsFilters">
                <PeriodBar value={period} onChange={setPeriod} />
                <label>
                  Employee
                  <select value={employee} onChange={(e) => setEmployee(e.target.value)}>
                    <option value="">All employees</option>
                    {staff
                      .filter((s) => !["admin", "display"].includes(String(s.role)))
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Branch
                  <select value={branch} onChange={(e) => setBranch(e.target.value)}>
                    <option value="">All branches</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Points type
                  <select value={type} onChange={(e) => setType(e.target.value)}>
                    <option value="all">All</option>
                    <option value="green">Green only</option>
                    <option value="red">Red only</option>
                    <option value="black">Black only</option>
                  </select>
                </label>
              </div>
              {err && <p className="ptsEmpty">{err}</p>}
              {!data && !err && <p className="ptsEmpty">Loading…</p>}
              {data && !data.startDate && (
                <p className="ptsEmpty">Set a start date in “Rules &amp; pricing” first.</p>
              )}
              {data && data.startDate && (
                <>
                  <div className="ptsTiles">
                    {show("green") && (
                      <div className="ptsTile green">
                        <small>Green (net)</small>
                        <b>{totals.g}</b>
                      </div>
                    )}
                    {show("red") && (
                      <div className="ptsTile red">
                        <small>Red (net)</small>
                        <b>{totals.r}</b>
                      </div>
                    )}
                    {show("black") && (
                      <div className="ptsTile black">
                        <small>Black (net)</small>
                        <b>{totals.b}</b>
                      </div>
                    )}
                    {isFull && (
                      <div className="ptsTile money">
                        <small>Net amount</small>
                        <b className={totals.net < 0 ? "ptsNeg" : ""}>{money(totals.net, cur)}</b>
                        <em>
                          +{money(totals.bonus, cur)} / −{money(totals.ded, cur)}
                        </em>
                      </div>
                    )}
                  </div>
                  {totals.missing > 0 && isFull && (
                    <p className="ptsNote">
                      {totals.missing} employee(s) have no {cfg.payBasis === "basic" ? "basic salary" : "salary"} set, so
                      their amounts are not included.
                    </p>
                  )}
                  <div className="dataScroll">
                    <table className="ptsTable">
                      <thead>
                        <tr>
                          <th>Employee</th>
                          {show("green") && <th className="g">Green</th>}
                          {show("red") && <th className="r">Red</th>}
                          {show("black") && <th className="k">Black</th>}
                          <th>Settled</th>
                          {isFull && <th>Amount ({cur})</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r) => {
                          const t = r.totals;
                          return (
                            <tr key={r.id} className="ptsRow" onClick={() => setOpenId(String(r.id))}>
                              <td>
                                <b>{r.name}</b>
                                <small className="ptsSub">
                                  {r.branch_name || "No branch"} · now{" "}
                                  <Chip t="green">{r.balance.green}</Chip> <Chip t="red">{r.balance.red}</Chip>{" "}
                                  <Chip t="black">{r.balance.black}</Chip>
                                </small>
                              </td>
                              {show("green") && (
                                <td>
                                  <b>{t.netGreen}</b>
                                  <small className="ptsSub">
                                    earned {t.greenEarned}
                                    {t.greenManual ? ` · manual ${t.greenManual > 0 ? "+" : ""}${t.greenManual}` : ""}
                                  </small>
                                </td>
                              )}
                              {show("red") && (
                                <td>
                                  <b>{t.netRed}</b>
                                  <small className="ptsSub">
                                    earned {t.redEarned}
                                    {t.redManual ? ` · manual ${t.redManual > 0 ? "+" : ""}${t.redManual}` : ""}
                                  </small>
                                </td>
                              )}
                              {show("black") && (
                                <td>
                                  <b>{t.netBlack}</b>
                                  <small className="ptsSub">
                                    absent {t.blackAbsent} · from red {t.blackConverted}
                                    {t.blackManual ? ` · manual ${t.blackManual > 0 ? "+" : ""}${t.blackManual}` : ""}
                                  </small>
                                </td>
                              )}
                              <td>
                                <small>
                                  🟢→⚫ {t.blackCancelled}
                                  <br />
                                  🟢→🔴 {t.redCancelled}
                                </small>
                              </td>
                              {isFull && (
                                <td>
                                  {r.amounts.net == null ? (
                                    <small className="ptsSub">Set salary in the employee profile</small>
                                  ) : (
                                    <>
                                      <b className={r.amounts.net < 0 ? "ptsNeg" : "ptsPos"}>
                                        {money(r.amounts.net, cur)}
                                      </b>
                                      <small className="ptsSub">
                                        +{money(r.amounts.bonus, cur)} / −{money(r.amounts.deduction, cur)}
                                      </small>
                                    </>
                                  )}
                                </td>
                              )}
                            </tr>
                          );
                        })}
                        {!rows.length && (
                          <tr>
                            <td colSpan={6} className="ptsEmpty">
                              No employees found.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <p className="ptsNote">
                    Click an employee to see every point, or to settle (green cancels black or red). Net = earned − converted − settled
                    inside the selected period.
                  </p>
                </>
              )}
            </>
          )}
        </section>
      )}

      {openId && (
        <PointsDetail
          api={api}
          id={openId}
          isFull={isFull}
          period={period}
          type={type}
          currency={cur}
          row={rows.find((r) => String(r.id) === openId)}
          onClose={() => setOpenId("")}
          onChanged={reload}
        />
      )}
    </>
  );
}

function PointsDetail({
  api,
  id,
  isFull,
  period,
  type,
  currency,
  row,
  onClose,
  onChanged,
}: {
  api: Api;
  id: string;
  isFull: boolean;
  period: { from: string; to: string };
  type: string;
  currency: string;
  row?: Row;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [d, setD] = useState<Row | null>(null);
  const [err, setErr] = useState("");
  const [kind, setKind] = useState("green_black");
  const [count, setCount] = useState("1");
  const [note, setNote] = useState("");
  const [adjType, setAdjType] = useState<PType>("green");
  const [adjDir, setAdjDir] = useState<"add" | "remove">("add");
  const [adjCount, setAdjCount] = useState("1");
  const [adjReason, setAdjReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    api(`points?detail=${id}&from=${period.from}&to=${period.to}&type=${type}`)
      .then((r) => live && setD(r))
      .catch((e) => live && setErr(e instanceof Error ? e.message : "Could not load details"));
    return () => {
      live = false;
    };
  }, [api, id, period.from, period.to, type, tick]);

  const b = (d?.balance || { green: 0, red: 0, black: 0 }) as Record<PType, number>;
  const settle = async () => {
    setBusy(true);
    try {
      await api("points", { action: "settle", employeeId: id, kind, count: Number(count), note });
      toast.success("Settlement saved");
      setNote("");
      setTick((n) => n + 1);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Settlement failed");
    } finally {
      setBusy(false);
    }
  };
  const adjust = async () => {
    const n = Math.floor(Number(adjCount));
    if (!Number.isFinite(n) || n < 1) return toast.error("Enter a number of points");
    setBusy(true);
    try {
      await api("points", {
        action: "adjust",
        employeeId: id,
        type: adjType,
        points: adjDir === "add" ? n : -n,
        reason: adjReason,
      });
      toast.success(adjDir === "add" ? "Points added" : "Points removed");
      setAdjReason("");
      setTick((x) => x + 1);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };
  const removeAdjustment = async (aid: string) => {
    if (!window.confirm("Remove this manual adjustment?")) return;
    try {
      await api("points", { action: "delete-adjustment", id: aid });
      setTick((x) => x + 1);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove");
    }
  };
  const remove = async (sid: string) => {
    if (!window.confirm("Remove this settlement? The cancelled points will return.")) return;
    try {
      await api("points", { action: "delete-settlement", id: sid });
      setTick((n) => n + 1);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove");
    }
  };
  return (
    <div className="ptsModal" onClick={onClose}>
      <div className="ptsPanel" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <header>
          <h3>{row?.name || "Employee"} — points</h3>
          <button type="button" className="secondary small" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>
        {err && <p className="ptsEmpty">{err}</p>}
        {!d && !err && <p className="ptsEmpty">Loading…</p>}
        {d && (
          <>
            <div className="ptsCards big">
              {(["green", "red", "black"] as PType[]).map((k) => (
                <div key={k} className={"ptsCard static " + k}>
                  <span className="ptsDot" />
                  <small>{SHORT[k]} balance</small>
                  <b>{b[k]}</b>
                </div>
              ))}
            </div>
            {isFull && row?.rates && (
              <p className="ptsNote">
                One point is worth: green {money(row.rates.green, currency)} · red {money(row.rates.red, currency)} · black{" "}
                {money(row.rates.black, currency)}
              </p>
            )}
            {isFull && (
              <div className="ptsSettleForm ptsAdjustForm">
                <h4>Add or remove points (reward / penalty)</h4>
                <select value={adjDir} onChange={(e) => setAdjDir(e.target.value as "add" | "remove")}>
                  <option value="add">Add points</option>
                  <option value="remove">Remove points</option>
                </select>
                <select value={adjType} onChange={(e) => setAdjType(e.target.value as PType)}>
                  <option value="green">Green (reward)</option>
                  <option value="red">Red (penalty)</option>
                  <option value="black">Black (penalty)</option>
                </select>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={adjCount}
                  onChange={(e) => setAdjCount(e.target.value)}
                  aria-label="Number of points"
                />
                <input
                  placeholder="Reason (shown to the employee)"
                  value={adjReason}
                  onChange={(e) => setAdjReason(e.target.value)}
                  maxLength={200}
                />
                <button type="button" className="primary" disabled={busy} onClick={adjust}>
                  {adjDir === "add" ? "Add" : "Remove"} {adjType} points
                </button>
                <small>
                  Adding green rewards the employee; adding red or black is a penalty. Removing points forgives or cancels them. Amounts follow
                  the pricing rules.
                </small>
              </div>
            )}
            {isFull && (
              <div className="ptsSettleForm">
                <h4>Settle (muqasa)</h4>
                <select value={kind} onChange={(e) => setKind(e.target.value)}>
                  <option value="green_black">Green cancels Black (1 : 1)</option>
                  <option value="green_red">Green cancels Red ({d.redToBlackAt} red each)</option>
                </select>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={count}
                  onChange={(e) => setCount(e.target.value)}
                  aria-label="Number of green points"
                />
                <input placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
                <button type="button" className="primary" disabled={busy || b.green < 1} onClick={settle}>
                  <Scale size={15} /> Settle
                </button>
                {b.green < 1 && <small>No green points available to settle.</small>}
              </div>
            )}
            <h4>Points in this period</h4>
            <EventsTable events={d.events || []} />
            <SettlementsList items={d.settlements || []} onDelete={isFull ? remove : undefined} />
            {(d.adjustments || []).length > 0 && (
              <div className="ptsSettled">
                <h4>Manual adjustments</h4>
                {(d.adjustments as Row[]).map((a) => (
                  <div key={a.id} className="ptsSettleRow">
                    <span>
                      {dmy(String(a.adjusted_on).slice(0, 10))} · <Chip t={a.type}>{SHORT[a.type as PType]}</Chip>{" "}
                      {a.points > 0 ? "+" : ""}
                      {a.points}
                      {a.reason ? ` · ${a.reason}` : ""}
                    </span>
                    {isFull && (
                      <button
                        type="button"
                        className="secondary small"
                        aria-label="Remove adjustment"
                        onClick={() => removeAdjustment(String(a.id))}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Rules & pricing (administrator)                                     */
/* ------------------------------------------------------------------ */
function PointsRules({ api, data, onSaved }: { api: Api; data: Row | null; onSaved: () => void }) {
  const [enabled, setEnabled] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [c, setC] = useState<Row>({});
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!data || loaded) return;
    setEnabled(data.enabled === true);
    setStartDate(String(data.startDate || ""));
    setC({ ...(data.config || {}) });
    setLoaded(true);
  }, [data, loaded]);
  const set = (k: string, v: unknown) => setC((o) => ({ ...o, [k]: v }));
  const save = async () => {
    setBusy(true);
    try {
      const r = await api("points", { action: "save-config", enabled, startDate: startDate || null, config: c });
      setStartDate(String(r.startDate || ""));
      toast.success("Points rules saved");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };
  if (!loaded) return <p className="ptsEmpty">Loading…</p>;
  const numIn = (k: string, label: string, hint?: string, step = "1") => (
    <label className="ptsField">
      {label}
      <input type="number" min="0" step={step} value={c[k] ?? ""} onChange={(e) => set(k, e.target.value)} />
      {hint && <small>{hint}</small>}
    </label>
  );
  return (
    <section className="uiCard ptsRules">
      <header className="sectionHead">
        <h3>Rules &amp; pricing</h3>
        <button type="button" className="primary" disabled={busy} onClick={save}>
          Save rules
        </button>
      </header>

      <div className="ptsBlock">
        <h4>General</h4>
        <label className="ptsCheck">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Enable the points system
          (adds the Points page and dashboard cards)
        </label>
        <label className="ptsField">
          Count points from
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          <small>Attendance before this date is ignored. Changing it recalculates everything.</small>
        </label>
      </div>

      <div className="ptsBlock green">
        <h4>🟢 Green points — overtime</h4>
        <label className="ptsField">
          Calculation
          <select value={c.greenMode} onChange={(e) => set("greenMode", e.target.value)}>
            <option value="dynamic">Dynamic: 1 point per employee workday of overtime</option>
            <option value="fixed">Fixed: 1 point per set number of overtime hours</option>
          </select>
        </label>
        {c.greenMode === "fixed" && numIn("greenFixedHours", "Overtime hours per green point", "e.g. 2 or 4", "0.25")}
        {numIn("greenGraceMinutes", "Overtime grace (minutes)", "Overtime within this is ignored")}
      </div>

      <div className="ptsBlock red">
        <h4>🔴 Red points — late / early leave</h4>
        {numIn("redUnitMinutes", "Minutes of shortfall per red point", "60 = every hour", "5")}
        {numIn("redGraceMinutes", "Grace period (minutes)", "e.g. 15 — small delays are forgiven")}
        <label className="ptsField">
          When the grace is exceeded
          <select value={c.graceMode} onChange={(e) => set("graceMode", e.target.value)}>
            <option value="deduct">Ignore only the grace minutes (count the excess)</option>
            <option value="threshold">Count the whole shortfall once exceeded</option>
          </select>
        </label>
      </div>

      <div className="ptsBlock black">
        <h4>⚫ Black points — absence &amp; conversion</h4>
        <p className="ptsNote">A full-day absence without leave is 1 black point automatically.</p>
        <label className="ptsField">
          Red points that become 1 black
          <select value={c.redToBlackMode} onChange={(e) => set("redToBlackMode", e.target.value)}>
            <option value="workday">Equal to the employee&apos;s daily working hours (8h = 8 red)</option>
            <option value="fixed">A fixed number</option>
          </select>
        </label>
        {c.redToBlackMode === "fixed" && numIn("redToBlackFixed", "Red points per black point")}
      </div>

      <div className="ptsBlock">
        <h4>💰 Pricing</h4>
        <label className="ptsField">
          Calculate wages from
          <select value={c.payBasis} onChange={(e) => set("payBasis", e.target.value)}>
            <option value="salary">Salary</option>
            <option value="basic">Basic salary</option>
          </select>
          <small>Set both fields in each employee&apos;s profile.</small>
        </label>
        {numIn("daysPerMonth", "Days in a pay month", "Daily wage = salary ÷ this number")}
        {numIn("defaultDailyHours", "Daily hours when an employee has none", "Hourly wage = daily wage ÷ employee hours", "0.5")}
        <label className="ptsField">
          Currency
          <input value={c.currency ?? ""} maxLength={8} onChange={(e) => set("currency", e.target.value)} />
        </label>
        <div className="ptsPriceGrid">
          <label className="ptsField">
            🟢 Green is worth
            <select value={c.greenValueMode} onChange={(e) => set("greenValueMode", e.target.value)}>
              <option value="day">One day&apos;s wage</option>
              <option value="fixed">A fixed amount</option>
            </select>
            {c.greenValueMode === "fixed" && (
              <input type="number" min="0" step="0.01" value={c.greenFixedAmount ?? ""} onChange={(e) => set("greenFixedAmount", e.target.value)} />
            )}
          </label>
          <label className="ptsField">
            🔴 Red costs
            <select value={c.redValueMode} onChange={(e) => set("redValueMode", e.target.value)}>
              <option value="hour">One hour&apos;s wage</option>
              <option value="fixed">A fixed amount</option>
            </select>
            {c.redValueMode === "fixed" && (
              <input type="number" min="0" step="0.01" value={c.redFixedAmount ?? ""} onChange={(e) => set("redFixedAmount", e.target.value)} />
            )}
          </label>
          <label className="ptsField">
            ⚫ Black costs
            <select value={c.blackValueMode} onChange={(e) => set("blackValueMode", e.target.value)}>
              <option value="day">One day&apos;s wage</option>
              <option value="fixed">A fixed amount</option>
            </select>
            {c.blackValueMode === "fixed" && (
              <input type="number" min="0" step="0.01" value={c.blackFixedAmount ?? ""} onChange={(e) => set("blackFixedAmount", e.target.value)} />
            )}
          </label>
        </div>
      </div>
      <p className="ptsNote">
        <Download size={13} /> Points are calculated from attendance, leaves and weekly off days, so they update automatically when records
        change. Only settlements are stored.
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Page entry                                                          */
/* ------------------------------------------------------------------ */
export default function PointsPage({
  api,
  isAdminView,
  isFull,
  staff,
  branches,
  version,
}: {
  api: Api;
  isAdminView: boolean;
  isFull: boolean;
  staff: Row[];
  branches: Row[];
  version: number;
}) {
  const stable = useCallback((p: string, payload?: Row) => api(p, payload), [api]);
  return isAdminView ? (
    <PointsAdmin api={stable} isFull={isFull} staff={staff} branches={branches} version={version} />
  ) : (
    <PointsSelf api={stable} version={version} />
  );
}
