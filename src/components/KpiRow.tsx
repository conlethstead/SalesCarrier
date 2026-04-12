import type { MetricsSummary } from "../types";

const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;
const fmtMoney = (n: number | null) =>
  n == null ? "—" : `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const fmtSec = (n: number | null) => (n == null ? "—" : `${n.toFixed(0)}s`);

export function KpiRow({ summary }: { summary: MetricsSummary }) {
  const cards = [
    { label: "Total calls", value: String(summary.total_calls) },
    { label: "Booked", value: String(summary.booked_count) },
    { label: "Booking rate", value: fmtPct(summary.booking_rate) },
    { label: "Avg call duration", value: fmtSec(summary.avg_call_duration_seconds) },
    {
      label: "Avg counteroffers (when >0)",
      value:
        summary.avg_negotiation_rounds_when_negotiated == null
          ? "—"
          : summary.avg_negotiation_rounds_when_negotiated.toFixed(1),
    },
    {
      label: "Avg agreed rate (legacy rows)",
      value: fmtMoney(summary.avg_agreed_rate_when_booked),
    },
  ];

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
        gap: "0.75rem",
        marginBottom: "1.5rem",
      }}
    >
      {cards.map((c) => (
        <div
          key={c.label}
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "12px",
            padding: "1rem 1.1rem",
          }}
        >
          <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginBottom: "0.35rem" }}>
            {c.label}
          </div>
          <div style={{ fontSize: "1.35rem", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
            {c.value}
          </div>
        </div>
      ))}
    </div>
  );
}
