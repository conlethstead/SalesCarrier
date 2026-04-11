import type { CSSProperties } from "react";
import type { CallEventRecord } from "../types";

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
              <th style={th}>Call ID</th>
              <th style={th}>Outcome</th>
              <th style={th}>Sentiment</th>
              <th style={th}>Load</th>
              <th style={th}>Agreed $</th>
              <th style={th}>Rounds</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.call_id}-${r.received_at}`} style={{ borderTop: "1px solid var(--border)" }}>
                <td style={td}>{formatTime(r.received_at)}</td>
                <td style={{ ...td, fontFamily: "var(--mono)", fontSize: "0.8rem" }}>{r.call_id}</td>
                <td style={td}>{r.outcome}</td>
                <td style={td}>{r.sentiment}</td>
                <td style={td}>{r.load_id ?? "—"}</td>
                <td style={td}>
                  {r.agreed_rate != null ? `$${r.agreed_rate.toLocaleString()}` : "—"}
                </td>
                <td style={td}>{r.negotiation_rounds ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const th: CSSProperties = {
  padding: "0.65rem 1rem",
  fontWeight: 500,
  whiteSpace: "nowrap",
};

const td: CSSProperties = {
  padding: "0.65rem 1rem",
  verticalAlign: "top",
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
