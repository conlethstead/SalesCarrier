import type { CallEventRecord, RecentCallEntry, SupabaseLoadRow } from "./metrics.js";
import { counterofferCount, isLegacyRecord, sentimentFromWorkflowPayload } from "./metrics.js";

/** RFC 4180-style field escaping for one cell. */
export function escapeCsvCell(value: string): string {
  const s = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
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

function agreedRateText(r: CallEventRecord): string {
  if (isLegacyRecord(r)) {
    return r.agreed_rate != null && Number.isFinite(r.agreed_rate) ? formatMoney(r.agreed_rate) : "";
  }
  const t = r.agreed_rate?.trim() ?? "";
  return t;
}

function listedRateText(row: RecentCallEntry): string {
  if (row.load) return formatMoney(row.load.loadboard_rate);
  const r = row.event;
  if (isLegacyRecord(r)) {
    return r.listed_rate != null && Number.isFinite(r.listed_rate) ? formatMoney(r.listed_rate) : "";
  }
  return r.listed_rate?.trim() ?? "";
}

function equipmentText(row: RecentCallEntry): string {
  const load = row.load;
  const fromLoad = load?.equipment_type?.trim() ?? "";
  const r = row.event;
  if (!isLegacyRecord(r) && r.trailer?.trim()) {
    return [fromLoad, r.trailer.trim()].filter(Boolean).join(" ");
  }
  return fromLoad;
}

function laneText(row: RecentCallEntry): string {
  if (row.load) return laneFull(row.load);
  const r = row.event;
  if (!isLegacyRecord(r) && r.lane?.trim()) return r.lane.trim();
  return "";
}

function sentimentText(r: CallEventRecord): string {
  if (isLegacyRecord(r)) return r.sentiment;
  const raw = r.sentiment_classification?.trim() ?? "";
  if (raw) return raw;
  return sentimentFromWorkflowPayload(r);
}

function outcomeText(r: CallEventRecord): string {
  if (isLegacyRecord(r)) return r.outcome.replace(/_/g, " ");
  const d = r.booking_decision;
  if (d === "yes") return "booked yes";
  if (d === "no") return "booked no";
  return "";
}

const HUMAN_HEADER = [
  "received_at",
  "occurred_at",
  "record_type",
  "carrier_name",
  "mc_number",
  "reference_number",
  "call_id_legacy",
  "load_id_legacy",
  "lane",
  "equipment",
  "listed_rate",
  "agreed_rate",
  "booking_decision",
  "outcome_legacy",
  "sentiment",
  "verified",
  "call_duration_s",
  "counteroffers",
  "decline_reason",
  "load_origin",
  "load_destination",
  "load_commodity",
  "load_weight",
  "load_notes",
] as const;

/** One row per call for spreadsheets (matches dashboard table columns + common load fields). */
export function recentCallEntriesToCsv(entries: RecentCallEntry[]): string {
  const lines: string[] = [HUMAN_HEADER.map((h) => escapeCsvCell(h)).join(",")];
  for (const row of entries) {
    const r = row.event;
    const load = row.load;
    const cells: string[] = [
      r.received_at,
      r.occurred_at ?? "",
      isLegacyRecord(r) ? "legacy" : "workflow",
      isLegacyRecord(r) ? "" : (r.carrier_name?.trim() ?? ""),
      isLegacyRecord(r) ? "" : String(r.mc_number ?? "").trim(),
      isLegacyRecord(r) ? "" : r.reference_number.trim(),
      isLegacyRecord(r) ? r.call_id : "",
      isLegacyRecord(r) ? (r.load_id?.trim() ?? "") : "",
      laneText(row),
      equipmentText(row),
      listedRateText(row),
      agreedRateText(r),
      isLegacyRecord(r) ? "" : (r.booking_decision ?? ""),
      isLegacyRecord(r) ? r.outcome : "",
      sentimentText(r),
      isLegacyRecord(r) ? "" : (r.verified === undefined ? "" : r.verified ? "yes" : "no"),
      isLegacyRecord(r) || r.call_duration == null ? "" : String(r.call_duration),
      isLegacyRecord(r)
        ? r.negotiation_rounds != null && Number.isFinite(r.negotiation_rounds)
          ? String(r.negotiation_rounds)
          : ""
        : (() => {
            const n = counterofferCount(r);
            return n != null ? String(n) : "";
          })(),
      isLegacyRecord(r) ? "" : (r.decline_reason?.trim() ?? ""),
      load?.origin ?? "",
      load?.destination ?? "",
      load?.commodity_type ?? "",
      load?.weight != null ? String(load.weight) : "",
      load?.notes?.trim() ?? "",
    ];
    lines.push(cells.map(escapeCsvCell).join(","));
  }
  return lines.join("\r\n");
}
