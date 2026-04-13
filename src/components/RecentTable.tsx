import { Fragment, useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import type {
  CallEventRecord,
  MetricsEnvironmentFilter,
  RecentCallEntry,
  SupabaseLoadRow,
} from "../types";
import { isLegacyRecord, recordEnvironment } from "../types";
import { fetchAllCallsCsvBlob } from "../api";
import { recentCallEntriesToCsv } from "../../shared/callExportCsv";
import { counterofferCount } from "../../shared/metrics";

const LANE_PREVIEW = 48;
const LOAD_REF_PATTERN = /^[A-Z]{3}\d{5}$/;

type TableFilters = {
  timeFrom: string;
  timeTo: string;
  carrier: string;
  loadRef: string;
  lane: string;
  equipment: string;
  listedRate: string;
  agreedRate: string;
  outcome: string;
  sentiment: string;
};

const emptyFilters: TableFilters = {
  timeFrom: "",
  timeTo: "",
  carrier: "",
  loadRef: "",
  lane: "",
  equipment: "",
  listedRate: "",
  agreedRate: "",
  outcome: "",
  sentiment: "",
};

function toDatetimeLocalValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function rowReceivedMs(r: CallEventRecord): number {
  return new Date(r.received_at).getTime();
}

function matchesTimeWindow(r: CallEventRecord, timeFrom: string, timeTo: string): boolean {
  if (!timeFrom && !timeTo) return true;
  const t = rowReceivedMs(r);
  if (timeFrom) {
    const fromMs = new Date(timeFrom).getTime();
    if (!Number.isNaN(fromMs) && t < fromMs) return false;
  }
  if (timeTo) {
    const toMs = new Date(timeTo).getTime();
    if (!Number.isNaN(toMs) && t > toMs) return false;
  }
  return true;
}

function needleInHay(needle: string, haystack: string): boolean {
  const n = needle.trim().toLowerCase();
  if (!n) return true;
  return haystack.toLowerCase().includes(n);
}

function formatMoney(n: number): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

function laneFull(load: SupabaseLoadRow): string {
  return `${load.origin} → ${load.destination}`;
}

function lanePreview(load: SupabaseLoadRow): string {
  const t = laneFull(load);
  return t.length <= LANE_PREVIEW ? t : `${t.slice(0, LANE_PREVIEW)}…`;
}

/** Parse a leading numeric amount from workflow strings like "2050", "$2,050", "2050 USD". */
function parseMoneyishNumber(s: string): number | null {
  const cleaned = s.replace(/[$,\s]/g, "").replace(/usd/gi, "").trim();
  const m = cleaned.match(/^-?\d*\.?\d+/);
  if (!m) return null;
  const n = Number.parseFloat(m[0]);
  return Number.isNaN(n) ? null : n;
}

function humanizeOutcome(o: string): string {
  return o.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatBookingDecision(v: string | undefined): string {
  if (v === "yes") return "Yes";
  if (v === "no") return "No";
  return "—";
}

function environmentCellLabel(e: CallEventRecord): string {
  const x = recordEnvironment(e);
  return x.charAt(0).toUpperCase() + x.slice(1);
}

function environmentDetailLabel(e: CallEventRecord): string {
  return environmentCellLabel(e);
}

function formatAgreedRateCell(r: CallEventRecord): string {
  if (isLegacyRecord(r)) {
    return r.agreed_rate != null && Number.isFinite(r.agreed_rate) ? formatMoney(r.agreed_rate) : "—";
  }
  if (r.agreed_rate == null) return "—";
  const text = r.agreed_rate.trim();
  if (!text) return "—";
  const n = parseMoneyishNumber(text);
  if (n != null && n >= 0) return formatMoney(n);
  return text;
}

function recordString(rec: CallEventRecord, snake: string, camel: string): string {
  const o = rec as unknown as Record<string, unknown>;
  const v = o[snake] ?? o[camel];
  if (v == null) return "";
  return String(v).trim();
}

function sentimentClassificationText(r: CallEventRecord): string {
  if (isLegacyRecord(r)) return String(r.sentiment ?? "").trim();
  return recordString(r, "sentiment_classification", "sentimentClassification");
}

function filterCarrierText(row: RecentCallEntry): string {
  const r = row.event;
  if (isLegacyRecord(r)) return "";
  return (r.carrier_name ?? "").trim();
}

function filterLoadRefText(row: RecentCallEntry): string {
  const r = row.event;
  if (isLegacyRecord(r)) {
    return (r.load_id?.trim() || r.call_id || "").trim();
  }
  return r.reference_number?.trim() ?? "";
}

function filterLaneText(row: RecentCallEntry): string {
  const load = row.load;
  if (load) return laneFull(load);
  const r = row.event;
  if (!isLegacyRecord(r) && r.lane?.trim()) return r.lane.trim();
  return "";
}

function filterEquipmentText(row: RecentCallEntry): string {
  const load = row.load;
  const fromLoad = load?.equipment_type?.trim() ?? "";
  const r = row.event;
  if (!isLegacyRecord(r) && r.trailer?.trim()) {
    return [fromLoad, r.trailer.trim()].filter(Boolean).join(" ");
  }
  return fromLoad;
}

function filterListedRateText(row: RecentCallEntry): string {
  const r = row.event;
  const parts: string[] = [];
  if (row.load) {
    parts.push(String(row.load.loadboard_rate), formatMoney(row.load.loadboard_rate));
  }
  if (!isLegacyRecord(r) && r.listed_rate?.trim()) parts.push(r.listed_rate.trim());
  if (isLegacyRecord(r) && r.listed_rate != null && Number.isFinite(r.listed_rate)) {
    parts.push(String(r.listed_rate), formatMoney(r.listed_rate));
  }
  return parts.join(" ");
}

function filterAgreedRateText(row: RecentCallEntry): string {
  const r = row.event;
  const parts: string[] = [formatAgreedRateCell(r)];
  if (!isLegacyRecord(r) && r.agreed_rate?.trim()) parts.push(r.agreed_rate.trim());
  if (isLegacyRecord(r) && r.agreed_rate != null && Number.isFinite(r.agreed_rate)) {
    parts.push(String(r.agreed_rate));
  }
  return parts.join(" ");
}

function filterOutcomeText(row: RecentCallEntry): string {
  const r = row.event;
  if (isLegacyRecord(r)) return humanizeOutcome(r.outcome);
  return formatBookingDecision(r.booking_decision);
}

function filterSentimentText(row: RecentCallEntry): string {
  const r = row.event;
  if (isLegacyRecord(r)) return String(r.sentiment ?? "");
  return sentimentClassificationText(r);
}

function rowMatchesFilters(row: RecentCallEntry, f: TableFilters): boolean {
  const r = row.event;
  if (!matchesTimeWindow(r, f.timeFrom, f.timeTo)) return false;
  if (!needleInHay(f.carrier, filterCarrierText(row))) return false;
  if (!needleInHay(f.loadRef, filterLoadRefText(row))) return false;
  if (!needleInHay(f.lane, filterLaneText(row))) return false;
  if (!needleInHay(f.equipment, filterEquipmentText(row))) return false;
  if (!needleInHay(f.listedRate, filterListedRateText(row))) return false;
  if (!needleInHay(f.agreedRate, filterAgreedRateText(row))) return false;
  if (!needleInHay(f.outcome, filterOutcomeText(row))) return false;
  if (!needleInHay(f.sentiment, filterSentimentText(row))) return false;
  return true;
}

function triggerBrowserDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function RecentTable({
  rows,
  environmentFilter = "all",
}: {
  rows: RecentCallEntry[];
  /** Matches dashboard environment filter (used for “CSV all calls”). */
  environmentFilter?: MetricsEnvironmentFilter;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [filters, setFilters] = useState<TableFilters>(emptyFilters);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [exportAllBusy, setExportAllBusy] = useState(false);

  const filteredRows = useMemo(
    () => rows.filter((row) => rowMatchesFilters(row, filters)),
    [rows, filters]
  );

  const downloadFilteredCsv = useCallback(() => {
    const csv = recentCallEntriesToCsv(filteredRows);
    const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
    const stamp = new Date().toISOString().slice(0, 10);
    triggerBrowserDownload(blob, `carrier-calls-filtered-${stamp}.csv`);
  }, [filteredRows]);

  const downloadAllCsv = useCallback(async () => {
    setExportAllBusy(true);
    try {
      const blob = await fetchAllCallsCsvBlob(environmentFilter);
      const stamp = new Date().toISOString().slice(0, 10);
      const suffix = environmentFilter === "all" ? "all" : environmentFilter;
      triggerBrowserDownload(blob, `carrier-calls-${suffix}-${stamp}.csv`);
    } finally {
      setExportAllBusy(false);
    }
  }, [environmentFilter]);

  const setFilter = <K extends keyof TableFilters>(key: K, value: TableFilters[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const applyPresetHours = (hours: number) => {
    const to = new Date();
    const from = new Date(to.getTime() - hours * 3600 * 1000);
    setFilters((prev) => ({
      ...prev,
      timeFrom: toDatetimeLocalValue(from),
      timeTo: toDatetimeLocalValue(to),
    }));
  };

  const clearFilters = () => setFilters(emptyFilters);
  const filtersActive = useMemo(
    () => Object.values(filters).some((v) => String(v).trim() !== ""),
    [filters]
  );

  useEffect(() => {
    if (!filtersOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFiltersOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filtersOpen]);

  if (rows.length === 0) {
    return (
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "12px",
          padding: "1.1rem",
        }}
      >
        <h2 style={{ fontSize: "0.95rem", color: "var(--text)", marginBottom: "0.5rem" }}>
          Recent calls
        </h2>
        <p style={{ color: "var(--muted)", margin: 0 }}>Ingest events via POST /api/events</p>
      </div>
    );
  }

  return (
    <>
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "12px",
        padding: "0",
        overflow: "hidden",
      }}
    >
      <div style={{ padding: "1rem 1.15rem", borderBottom: "1px solid var(--border)" }}>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "0.75rem",
          }}
        >
          <h2 style={{ fontSize: "0.95rem", color: "var(--text)", margin: 0 }}>Recent calls</h2>
          <div style={{ display: "flex", alignItems: "center", gap: "0.65rem", flexWrap: "wrap" }}>
            <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
              Showing {filteredRows.length} of {rows.length}
            </span>
            <button
              type="button"
              onClick={() => void downloadAllCsv()}
              disabled={exportAllBusy}
              style={exportBtn}
              title="Download every stored call (not limited to the recent window in the table)"
            >
              {exportAllBusy ? "Preparing…" : "CSV (all calls)"}
            </button>
            <button
              type="button"
              onClick={downloadFilteredCsv}
              disabled={exportAllBusy || filteredRows.length === 0}
              style={exportBtn}
              title="Uses the same rows as the table after filters (still only the recent window loaded in the dashboard)"
            >
              CSV (filtered)
            </button>
            <button
              type="button"
              onClick={() => setFiltersOpen(true)}
              style={filterTriggerBtn}
              aria-expanded={filtersOpen}
              aria-haspopup="dialog"
            >
              Filters
              {filtersActive ? (
                <span style={filterActiveBadge} aria-hidden>
                  Active
                </span>
              ) : null}
            </button>
          </div>
        </div>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--muted)" }}>
              <th style={th}>Time</th>
              <th style={th}>Carrier</th>
              <th style={th}>Load ref</th>
              <th style={th}>Lane</th>
              <th style={th}>Equipment</th>
              <th style={th}>Listed rate</th>
              <th style={th}>Agreed rate</th>
              <th style={th}>Outcome</th>
              <th style={th}>Sentiment</th>
              <th style={th}>Env</th>
              <th style={{ ...th, width: "3.5rem" }} aria-label="Details" />
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 ? (
              <tr>
                <td
                  colSpan={12}
                  style={{
                    padding: "1.5rem 1rem",
                    color: "var(--muted)",
                    textAlign: "center",
                  }}
                >
                  No calls match the current filters.
                </td>
              </tr>
            ) : (
              filteredRows.map((row, rowIndex) => {
              const r = row.event;
              const key = rowKey(row, rowIndex);
              const expanded = !!open[key];
              const load = row.load;
              const mismatchMessage = loadMismatchMessage(row);
              return (
                <Fragment key={key}>
                  <tr style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={td}>{formatTime(r.received_at)}</td>
                    {isLegacyRecord(r) ? (
                      <>
                        <td style={td}>—</td>
                        <td style={{ ...td, fontFamily: "var(--mono)", fontSize: "0.8rem" }}>
                          <div>{r.load_id?.trim() || r.call_id}</div>
                          {mismatchMessage && <div style={rowError}>{mismatchMessage}</div>}
                        </td>
                        <td style={td} title={load ? laneFull(load) : undefined}>
                          {load ? lanePreview(load) : "—"}
                        </td>
                        <td style={td}>{load?.equipment_type ?? "—"}</td>
                        <td style={td}>{load ? formatMoney(load.loadboard_rate) : "—"}</td>
                        <td style={td}>{formatAgreedRateCell(r)}</td>
                        <td style={td}>{humanizeOutcome(r.outcome)}</td>
                        <td style={td}>
                          <div>{r.sentiment}</div>
                        </td>
                        <td style={{ ...td, color: "var(--muted)", fontSize: "0.8rem" }}>
                          {environmentCellLabel(r)}
                        </td>
                      </>
                    ) : (
                      <>
                        <td style={td}>{r.carrier_name?.trim() ? r.carrier_name : "—"}</td>
                        <td style={{ ...td, fontFamily: "var(--mono)", fontSize: "0.8rem" }}>
                          <div>{r.reference_number?.trim() || "—"}</div>
                          {mismatchMessage && <div style={rowError}>{mismatchMessage}</div>}
                        </td>
                        <td style={td} title={load ? laneFull(load) : undefined}>
                          {load ? lanePreview(load) : "—"}
                        </td>
                        <td style={td}>{load?.equipment_type ?? "—"}</td>
                        <td style={td}>{load ? formatMoney(load.loadboard_rate) : "—"}</td>
                        <td style={td}>{formatAgreedRateCell(r)}</td>
                        <td style={td}>{formatBookingDecision(r.booking_decision)}</td>
                        <td style={td}>{sentimentCell(r)}</td>
                        <td style={{ ...td, color: "var(--muted)", fontSize: "0.8rem" }}>
                          {environmentCellLabel(r)}
                        </td>
                      </>
                    )}
                    <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                      <button
                        type="button"
                        onClick={() => setOpen((prev) => ({ ...prev, [key]: !prev[key] }))}
                        aria-expanded={expanded}
                        style={expandBtn}
                      >
                        {expanded ? "Hide" : "Details"}
                      </button>
                    </td>
                  </tr>
                  {expanded && (
                    <tr style={{ borderTop: "none", background: "var(--surface2)" }}>
                      <td colSpan={12} style={{ padding: "0.85rem 1rem 1rem", verticalAlign: "top" }}>
                        {row.load ? (
                          <>
                            <div style={sectionTitle}>Load</div>
                            <div style={detailGrid}>
                              {loadDetailRows(row.load).map(({ label, value }, i) => (
                                <Fragment key={`${i}-${label}`}>
                                  <div style={detailLabel}>{label}</div>
                                  <div style={detailValue}>{value}</div>
                                </Fragment>
                              ))}
                            </div>
                          </>
                        ) : mismatchMessage ? (
                          <div style={detailError}>{mismatchMessage}</div>
                        ) : (
                          <div style={{ ...sectionTitle, marginBottom: "0.35rem" }}>
                            Load: none in payload (send <code style={codeInline}>load[]</code> with{" "}
                            <code style={codeInline}>load_id</code> matching{" "}
                            <code style={codeInline}>reference_number</code>, e.g.{" "}
                            <code style={codeInline}>ABC12345</code>)
                          </div>
                        )}
                        <div style={{ ...sectionTitle, marginTop: "0.85rem" }}>Call / assistant</div>
                        <div style={detailGrid}>
                          {eventDetailRows(r).map(({ label, value }, i) => (
                            <Fragment key={`${i}-${label}`}>
                              <div style={detailLabel}>{label}</div>
                              <div style={detailValue}>{value}</div>
                            </Fragment>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })
            )}
          </tbody>
        </table>
      </div>
    </div>

    {filtersOpen ? (
      <div
        style={modalBackdrop}
        onClick={() => setFiltersOpen(false)}
        role="presentation"
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="recent-calls-filter-title"
          style={modalPanel}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={modalHeader}>
            <h3 id="recent-calls-filter-title" style={modalTitle}>
              Filter recent calls
            </h3>
            <button type="button" onClick={() => setFiltersOpen(false)} style={modalCloseBtn}>
              Close
            </button>
          </div>
          <p style={modalHint}>
            Filters apply as you type. Time range uses each row&apos;s received time.
          </p>
          <div className="recent-filters-modal-grid" style={filterGrid}>
            <div>
              <div style={filterLabel}>Time from</div>
              <input
                type="datetime-local"
                value={filters.timeFrom}
                onChange={(e) => setFilter("timeFrom", e.target.value)}
                style={filterInput}
              />
            </div>
            <div>
              <div style={filterLabel}>Time to</div>
              <input
                type="datetime-local"
                value={filters.timeTo}
                onChange={(e) => setFilter("timeTo", e.target.value)}
                style={filterInput}
              />
            </div>
            <div style={{ gridColumn: "1 / -1", display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
              <button type="button" style={presetBtn} onClick={() => applyPresetHours(24)}>
                Last 24h
              </button>
              <button type="button" style={presetBtn} onClick={() => applyPresetHours(24 * 7)}>
                Last 7d
              </button>
              <button type="button" style={presetBtn} onClick={() => applyPresetHours(24 * 30)}>
                Last 30d
              </button>
              <button
                type="button"
                style={presetBtn}
                onClick={() => setFilters((prev) => ({ ...prev, timeFrom: "", timeTo: "" }))}
              >
                Clear time range
              </button>
            </div>
            <div>
              <div style={filterLabel}>Carrier</div>
              <input
                type="search"
                value={filters.carrier}
                onChange={(e) => setFilter("carrier", e.target.value)}
                placeholder="Contains…"
                style={filterInput}
              />
            </div>
            <div>
              <div style={filterLabel}>Load ref</div>
              <input
                type="search"
                value={filters.loadRef}
                onChange={(e) => setFilter("loadRef", e.target.value)}
                placeholder="Contains…"
                style={filterInput}
              />
            </div>
            <div>
              <div style={filterLabel}>Lane</div>
              <input
                type="search"
                value={filters.lane}
                onChange={(e) => setFilter("lane", e.target.value)}
                placeholder="Origin, destination…"
                style={filterInput}
              />
            </div>
            <div>
              <div style={filterLabel}>Equipment</div>
              <input
                type="search"
                value={filters.equipment}
                onChange={(e) => setFilter("equipment", e.target.value)}
                placeholder="Contains…"
                style={filterInput}
              />
            </div>
            <div>
              <div style={filterLabel}>Listed rate</div>
              <input
                type="search"
                value={filters.listedRate}
                onChange={(e) => setFilter("listedRate", e.target.value)}
                placeholder="$ or number…"
                style={filterInput}
              />
            </div>
            <div>
              <div style={filterLabel}>Agreed rate</div>
              <input
                type="search"
                value={filters.agreedRate}
                onChange={(e) => setFilter("agreedRate", e.target.value)}
                placeholder="$ or number…"
                style={filterInput}
              />
            </div>
            <div>
              <div style={filterLabel}>Outcome</div>
              <input
                type="search"
                value={filters.outcome}
                onChange={(e) => setFilter("outcome", e.target.value)}
                placeholder="Yes, no, booked…"
                style={filterInput}
              />
            </div>
            <div>
              <div style={filterLabel}>Sentiment</div>
              <input
                type="search"
                value={filters.sentiment}
                onChange={(e) => setFilter("sentiment", e.target.value)}
                placeholder="Contains…"
                style={filterInput}
              />
            </div>
            <div
              style={{
                gridColumn: "1 / -1",
                display: "flex",
                flexWrap: "wrap",
                gap: "0.5rem",
                justifyContent: "flex-end",
                marginTop: "0.25rem",
                paddingTop: "0.85rem",
                borderTop: "1px solid var(--border)",
              }}
            >
              <button
                type="button"
                disabled={!filtersActive}
                onClick={clearFilters}
                style={{
                  ...presetBtn,
                  opacity: filtersActive ? 1 : 0.45,
                  cursor: filtersActive ? "pointer" : "not-allowed",
                }}
              >
                Clear all
              </button>
              <button type="button" onClick={() => setFiltersOpen(false)} style={modalDoneBtn}>
                Done
              </button>
            </div>
          </div>
        </div>
      </div>
    ) : null}
    </>
  );
}

function loadDetailRows(load: SupabaseLoadRow): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  const push = (label: string, v: unknown) => {
    if (v == null || v === "") return;
    if (typeof v === "number" && Number.isFinite(v)) {
      out.push({ label, value: String(v) });
      return;
    }
    const s = String(v).trim();
    if (!s) return;
    out.push({ label, value: s });
  };
  push("Load ID", load.load_id);
  push("Origin", load.origin);
  push("Destination", load.destination);
  push("Pickup", load.pickup_datetime);
  push("Delivery", load.delivery_datetime);
  push("Equipment type", load.equipment_type);
  out.push({ label: "Listed rate", value: formatMoney(load.loadboard_rate) });
  push("Commodity", load.commodity_type);
  push("Weight", load.weight);
  push("Pieces", load.num_of_pieces);
  push("Miles", load.miles);
  push("Dimensions", load.dimensions);
  push("Notes", load.notes);
  push("Created at", load.created_at);
  return out;
}

function eventDetailRows(r: CallEventRecord): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  const push = (label: string, v: unknown) => {
    if (v == null || v === "") return;
    if (typeof v === "boolean") {
      out.push({ label, value: v ? "yes" : "no" });
      return;
    }
    if (typeof v === "number" && Number.isFinite(v)) {
      out.push({ label, value: String(v) });
      return;
    }
    const s = String(v).trim();
    if (!s) return;
    out.push({ label, value: s });
  };

  if (isLegacyRecord(r)) {
    push("Call ID", r.call_id);
    push("Load ID", r.load_id);
    push("Outcome", humanizeOutcome(r.outcome));
    push("Sentiment", r.sentiment);
    push("Agreed rate", r.agreed_rate);
    push("Listed rate", r.listed_rate);
    push("Negotiation rounds", r.negotiation_rounds);
    push("Notes", r.notes);
    push("Occurred at", r.occurred_at);
    push("Received at", r.received_at);
    out.push({ label: "Environment", value: environmentDetailLabel(r) });
    return out;
  }

  push("Reference number", r.reference_number);
  push("MC number", r.mc_number);
  push("Carrier name", r.carrier_name);
  if (r.booking_decision) push("Booking decision", r.booking_decision);
  push("Decline reason", r.decline_reason);
  push("Agreed rate (USD)", r.agreed_rate);
  push("Call duration (s)", r.call_duration);
  const co = counterofferCount(r);
  if (co != null) push("Counteroffers", co);
  push("Verified", r.verified);
  push("Sentiment classification", r.sentiment_classification);
  push("Sentiment reasoning", r.sentiment_reasoning);
  push("Trailer / equipment", r.trailer);
  push("Lane", r.lane);
  push("Listed rate (assistant)", r.listed_rate);
  push("How load was found", r.how_load_was_found);
  push("Occurred at", r.occurred_at);
  push("Received at", r.received_at);
  out.push({ label: "Environment", value: environmentDetailLabel(r) });
  return out;
}

function sentimentReasoningText(r: CallEventRecord): string {
  if (isLegacyRecord(r)) return "";
  return recordString(r, "sentiment_reasoning", "sentimentReasoning");
}

function sentimentCell(r: CallEventRecord): JSX.Element {
  const label = sentimentClassificationText(r);
  return (
    <div>
      <div>{label || "—"}</div>
    </div>
  );
}

function normalizedLoadRef(r: CallEventRecord): string | null {
  const raw = isLegacyRecord(r)
    ? r.load_id?.trim() || ""
    : r.reference_number?.trim() ?? "";
  const id = raw.toUpperCase();
  return LOAD_REF_PATTERN.test(id) ? id : null;
}

function loadMismatchMessage(row: RecentCallEntry): string | null {
  if (row.load) return null;
  const id = normalizedLoadRef(row.event);
  if (!id) return null;
  return `No load in payload matches reference ${id}.`;
}

function rowKey(row: RecentCallEntry, index: number): string {
  const r = row.event;
  if (isLegacyRecord(r)) return `legacy-${r.call_id}-${r.received_at}`;
  const ref = r.reference_number?.trim();
  if (ref) return `new-${ref}-${r.received_at}`;
  return `new-i${index}-${r.received_at}`;
}

const modalBackdrop: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 1000,
  background: "rgba(0, 0, 0, 0.55)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "1rem",
};

const modalPanel: CSSProperties = {
  width: "100%",
  maxWidth: "min(52rem, calc(100vw - 2rem))",
  maxHeight: "min(90vh, 40rem)",
  overflow: "auto",
  overflowX: "hidden",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "12px",
  padding: "1.15rem 1.2rem 1.2rem",
  boxShadow: "0 16px 48px rgba(0, 0, 0, 0.45)",
};

const modalHeader: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "0.75rem",
  marginBottom: "0.35rem",
};

const modalTitle: CSSProperties = {
  margin: 0,
  fontSize: "1rem",
  fontWeight: 600,
  color: "var(--text)",
};

const modalCloseBtn: CSSProperties = {
  background: "transparent",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  color: "var(--muted)",
  cursor: "pointer",
  fontSize: "0.8rem",
  padding: "0.35rem 0.65rem",
  fontFamily: "var(--font)",
  flexShrink: 0,
};

const modalHint: CSSProperties = {
  margin: "0 0 0.85rem",
  fontSize: "0.78rem",
  color: "var(--muted)",
  lineHeight: 1.35,
};

const filterGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
  gap: "0.65rem 1rem",
  alignItems: "end",
};

const exportBtn: CSSProperties = {
  background: "var(--surface2)",
  border: "1px solid var(--border)",
  borderRadius: "8px",
  color: "var(--text)",
  cursor: "pointer",
  fontSize: "0.8rem",
  fontWeight: 500,
  padding: "0.4rem 0.75rem",
  fontFamily: "var(--font)",
};

const filterTriggerBtn: CSSProperties = {
  ...exportBtn,
  display: "inline-flex",
  alignItems: "center",
  gap: "0.4rem",
};

const filterActiveBadge: CSSProperties = {
  fontSize: "0.65rem",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "var(--booked-accent)",
  background: "rgba(20, 133, 79, 0.2)",
  borderRadius: "4px",
  padding: "0.12rem 0.35rem",
};

const modalDoneBtn: CSSProperties = {
  background: "var(--surface2)",
  border: "1px solid var(--border)",
  borderRadius: "8px",
  color: "var(--text)",
  cursor: "pointer",
  fontSize: "0.85rem",
  fontWeight: 500,
  padding: "0.45rem 1rem",
  fontFamily: "var(--font)",
};

const filterLabel: CSSProperties = {
  fontSize: "0.68rem",
  color: "var(--muted)",
  marginBottom: "0.25rem",
  fontWeight: 500,
};

const filterInput: CSSProperties = {
  width: "100%",
  minWidth: 0,
  maxWidth: "100%",
  boxSizing: "border-box",
  fontSize: "0.8rem",
  padding: "0.35rem 0.45rem",
  borderRadius: "6px",
  border: "1px solid var(--border)",
  background: "var(--surface2)",
  color: "var(--text)",
  fontFamily: "var(--font)",
};

const presetBtn: CSSProperties = {
  background: "var(--surface2)",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  color: "var(--text)",
  cursor: "pointer",
  fontSize: "0.72rem",
  padding: "0.3rem 0.55rem",
  fontFamily: "var(--font)",
};

const th: CSSProperties = {
  padding: "0.65rem 1rem",
  fontWeight: 500,
  whiteSpace: "nowrap",
};

const td: CSSProperties = {
  padding: "0.65rem 1rem",
  verticalAlign: "top",
  maxWidth: "12rem",
};

const expandBtn: CSSProperties = {
  background: "transparent",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  color: "var(--text)",
  cursor: "pointer",
  fontSize: "0.75rem",
  lineHeight: 1,
  padding: "0.25rem 0.45rem",
};

const sectionTitle: CSSProperties = {
  fontSize: "0.75rem",
  color: "var(--muted)",
  fontWeight: 600,
  marginBottom: "0.5rem",
};

const detailGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(7rem, 11rem) 1fr",
  gap: "0.35rem 1rem",
  fontSize: "0.82rem",
  alignItems: "start",
};

const detailLabel: CSSProperties = {
  color: "var(--muted)",
  fontWeight: 500,
};

const detailValue: CSSProperties = {
  wordBreak: "break-word",
  fontFamily: "var(--mono)",
  fontSize: "0.78rem",
};

const rowError: CSSProperties = {
  marginTop: "0.3rem",
  color: "var(--danger)",
  fontFamily: "var(--font)",
  fontSize: "0.72rem",
  lineHeight: 1.25,
};

const detailError: CSSProperties = {
  ...sectionTitle,
  color: "var(--danger)",
  marginBottom: "0.35rem",
};

const codeInline: CSSProperties = {
  fontFamily: "var(--mono)",
  fontSize: "0.78em",
};

function formatTime(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
