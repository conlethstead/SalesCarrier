import type { CSSProperties } from "react";
import type { CallEventRecord } from "../types";
import { isLegacyRecord } from "../types";

const REASON_PREVIEW = 100;

export function RecentTable({ rows }: { rows: CallEventRecord[] }) {
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
        <h2 style={{ fontSize: "0.95rem", color: "var(--muted)", marginBottom: "0.5rem" }}>
          Recent calls
        </h2>
        <p style={{ color: "var(--muted)", margin: 0 }}>Ingest events via POST /api/events</p>
      </div>
    );
  }

  return (
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
        <h2 style={{ fontSize: "0.95rem", color: "var(--muted)", margin: 0 }}>Recent calls</h2>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--muted)" }}>
              <th style={th}>Time</th>
              <th style={th}>Load ref</th>
              <th style={th}>MC</th>
              <th style={th}>Carrier</th>
              <th style={th}>Booking</th>
              <th style={th}>Decline</th>
              <th style={th}>Duration</th>
              <th style={th}>Counters</th>
              <th style={th}>Verified</th>
              <th style={th}>Sentiment</th>
              <th style={th}>Reasoning</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={rowKey(r)} style={{ borderTop: "1px solid var(--border)" }}>
                <td style={td}>{formatTime(r.received_at)}</td>
                {isLegacyRecord(r) ? (
                  <>
                    <td style={{ ...td, fontFamily: "var(--mono)", fontSize: "0.8rem" }}>{r.call_id}</td>
                    <td style={td}>—</td>
                    <td style={td}>—</td>
                    <td style={td}>{r.outcome}</td>
                    <td style={td}>—</td>
                    <td style={td}>—</td>
                    <td style={td}>{r.negotiation_rounds ?? "—"}</td>
                    <td style={td}>—</td>
                    <td style={td}>{r.sentiment}</td>
                    <td style={td} title={r.notes}>{preview(r.notes)}</td>
                  </>
                ) : (
                  <>
                    <td style={{ ...td, fontFamily: "var(--mono)", fontSize: "0.8rem" }}>
                      {r.reference_number}
                    </td>
                    <td style={td}>{r.mc_number ?? "—"}</td>
                    <td style={td}>{r.carrier_name ?? "—"}</td>
                    <td style={td}>{r.booking_decision ?? "—"}</td>
                    <td style={td}>{r.decline_reason?.trim() ? r.decline_reason : "—"}</td>
                    <td style={td}>{r.call_duration != null ? `${r.call_duration}s` : "—"}</td>
                    <td style={td}>{r.number_of_counteroffers ?? "—"}</td>
                    <td style={td}>{r.verified === undefined ? "—" : r.verified ? "yes" : "no"}</td>
                    <td style={td}>{r.sentiment_classification ?? "—"}</td>
                    <td style={td} title={r.sentiment_reasoning ?? undefined}>
                      {preview(r.sentiment_reasoning)}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function preview(s: string | undefined): string {
  if (!s?.trim()) return "—";
  const t = s.trim();
  return t.length <= REASON_PREVIEW ? t : `${t.slice(0, REASON_PREVIEW)}…`;
}

function rowKey(r: CallEventRecord): string {
  if (isLegacyRecord(r)) return `legacy-${r.call_id}-${r.received_at}`;
  return `new-${r.reference_number}-${r.received_at}`;
}

const th: CSSProperties = {
  padding: "0.65rem 1rem",
  fontWeight: 500,
  whiteSpace: "nowrap",
};

const td: CSSProperties = {
  padding: "0.65rem 1rem",
  verticalAlign: "top",
  maxWidth: "14rem",
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
