"use client";
import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";

const SIZES = [10, 25, 50, 100, 0];

/**
 * Wraps any <table>: adds a search box, a column filter, a rows-per-page dropdown and paging.
 * Rows are shown/hidden after every render, so it works for every table without changing its code.
 */
export default function TableTools({
  children,
  defaultSize = 10,
}: {
  children: ReactNode;
  defaultSize?: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState("");
  const [size, setSize] = useState(defaultSize);
  const [page, setPage] = useState(0);
  const [col, setCol] = useState(-1);
  const [val, setVal] = useState("");
  const [meta, setMeta] = useState<{
    headers: string[];
    values: string[];
    total: number;
    all: number;
    pages: number;
  }>({ headers: [], values: [], total: 0, all: 0, pages: 1 });

  const apply = useCallback(() => {
    const table = box.current?.querySelector("table");
    const body = table?.tBodies[0];
    if (!table || !body) return;
    const head = table.tHead?.rows[table.tHead.rows.length - 1];
    const headers = Array.from(head?.cells || []).map(
      (c) => (c.textContent || "").trim() || "",
    );
    // A single full-width row is an "empty" message, not data.
    const rows = Array.from(body.rows).filter(
      (r) => !(r.cells.length === 1 && r.cells[0].colSpan > 1),
    );
    const needle = q.trim().toLowerCase();
    const matched = rows.filter((r) => {
      if (col >= 0 && val && (r.cells[col]?.textContent || "").trim() !== val)
        return false;
      return !needle || (r.textContent || "").toLowerCase().includes(needle);
    }, [q, size, page, col, val]);
  useEffect(() => {
    // Re-apply only when the table content really changes (React only touches the DOM when data changes).
    apply();
    const root = box.current;
    if (!root) return;
    let raf = 0;
    const obs = new MutationObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(apply);
    });
    obs.observe(root, { childList: true, subtree: true, characterData: true });
    return () => {
      obs.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [apply]);

  const per = size === 0 ? matched.length || 1 : size;
    const pages = Math.max(1, Math.ceil(matched.length / per));
    const cur = Math.min(page, pages - 1);
    const visible = new Set(matched.slice(cur * per, cur * per + per));
    rows.forEach((r) => {
      const show = visible.has(r);
      if (show && r.style.display === "none") r.style.display = "";
      else if (!show && r.style.display !== "none") r.style.display = "none";
    });
    const values =
      col >= 0
        ? Array.from(
            new Set(
              rows
                .map((r) => (r.cells[col]?.textContent || "").trim())
                .filter(Boolean),
            ),
          )
            .sort()
            .slice(0, 80)
        : [];
    const next = {
      headers,
      values,
      total: matched.length,
      all: rows.length,
      pages,
    };
    setMeta((m) => (JSON.stringify(m) === JSON.stringify(next) ? m : next));
    if (cur !== page) setPage(cur);
  });

  const per = size === 0 ? meta.total || 1 : size;
  const from = meta.total ? Math.min(page, meta.pages - 1) * per + 1 : 0;
  const to = Math.min(meta.total, from + per - 1);
  const filterCols = meta.headers
    .map((h, i) => ({ h, i }))
    .filter((x) => x.h)
    .slice(0, 14);

  return (
    <div className="ttWrap" ref={box}>
      <div className="ttBar">
        <span className="ttSearch">
          <Search size={14} />
          <input
            value={q}
            placeholder="Search in table…"
            onChange={(e) => {
              setQ(e.target.value);
              setPage(0);
            }}
          />
        </span>
        <select
          aria-label="Filter column"
          value={col}
          onChange={(e) => {
            setCol(Number(e.target.value));
            setVal("");
            setPage(0);
          }}
        >
          <option value={-1}>Filter: none</option>
          {filterCols.map((x) => (
            <option key={x.i} value={x.i}>
              {x.h}
            </option>
          ))}
        </select>
        {col >= 0 && (
          <select
            aria-label="Filter value"
            value={val}
            onChange={(e) => {
              setVal(e.target.value);
              setPage(0);
            }}
          >
            <option value="">Any value</option>
            {meta.values.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        )}
        <label className="ttSize">
          Rows
          <select
            value={size}
            onChange={(e) => {
              setSize(Number(e.target.value));
              setPage(0);
            }}
          >
            {SIZES.map((s) => (
              <option key={s} value={s}>
                {s === 0 ? "All" : s}
              </option>
            ))}
          </select>
        </label>
      </div>
      {children}
      {meta.all > 0 && (
        <div className="ttFoot">
          <span>
            {meta.total
              ? `Showing ${from}–${to} of ${meta.total}${meta.total !== meta.all ? ` (filtered from ${meta.all})` : ""}`
              : "No matching rows"}
          </span>
          {meta.pages > 1 && (
            <span className="ttPager">
              <button
                type="button"
                disabled={page <= 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                aria-label="Previous page"
              >
                <ChevronLeft size={16} />
              </button>
              <b>
                {Math.min(page, meta.pages - 1) + 1} / {meta.pages}
              </b>
              <button
                type="button"
                disabled={page >= meta.pages - 1}
                onClick={() => setPage((p) => Math.min(meta.pages - 1, p + 1))}
                aria-label="Next page"
              >
                <ChevronRight size={16} />
              </button>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
