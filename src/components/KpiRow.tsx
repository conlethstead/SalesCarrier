import type { CSSProperties } from "react";
import type { MetricsSummary } from "../types";

const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;
const fmtSignedMoney = (n: number | null) =>
  n == null
    ? "—"
    : `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const fmtSec = (n: number | null) => (n == null ? "—" : `${n.toFixed(0)}s`);

const shell: CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "12px",
  padding: "0.85rem 1rem",
  minWidth: 0,
};

const labelLine: CSSProperties = {
  fontSize: "0.75rem",
  color: "var(--muted)",
  marginBottom: "0.3rem",
  lineHeight: 1.25,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const valueLine: CSSProperties = {
  fontSize: "1.2rem",
  fontWeight: 600,
  fontVariantNumeric: "tabular-nums",
  color: "var(--text)",
  lineHeight: 1.25,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

export function KpiRow({ summary }: { summary: MetricsSummary }) {
  const cards = [
    { label: "Total calls", value: String(summary.total_calls) },
    {
      label: "Failed verification rate",
      value: summary.total_calls === 0 ? "—" : fmtPct(summary.failed_verification_rate),
    },
    {
      label: "Loading error rate",
      value: summary.total_calls === 0 ? "—" : fmtPct(summary.loading_error_rate),
    },
    {
      label: "Top emotion step",
      value: summary.top_step_emotion == null ? "—" : summary.top_step_emotion,
    },
    { label: "Avg call duration", value: fmtSec(summary.avg_call_duration_seconds) },
    {
      label: "Avg counteroffers",
      value:
        summary.avg_counteroffers_per_call == null
          ? "—"
          : summary.avg_counteroffers_per_call.toFixed(1),
    },
    {
      label: "Avg agreed - listed",
      value: fmtSignedMoney(summary.avg_agreed_minus_listed_when_booked),
    },
  ];

  return (
    <div
      style={{
        width: "100%",
        overflowX: "auto",
        marginBottom: "1.5rem",
        WebkitOverflowScrolling: "touch",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, minmax(7.5rem, 1fr))",
          gap: "0.65rem",
          width: "100%",
          minWidth: "52.5rem",
        }}
      >
        {cards.map((c) => (
          <div key={c.label} style={shell} title={`${c.label}: ${c.value}`}>
            <div style={labelLine} title={c.label}>
              {c.label}
            </div>
            <div style={valueLine} title={String(c.value)}>
              {c.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
