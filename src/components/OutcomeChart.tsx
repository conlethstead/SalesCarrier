import type { CSSProperties } from "react";
import {
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import type { CallOutcome, MetricsSummary } from "../types";

const OUTCOME_ORDER: CallOutcome[] = [
  "booked",
  "declined",
  "negotiated_no_deal",
  "no_match",
  "failed_verification",
  "abandoned",
];

const OUTCOME_COLORS: Record<CallOutcome, string> = {
  booked: "var(--booked-accent)",
  declined: "var(--declined-accent)",
  negotiated_no_deal: "var(--negotiated-accent)",
  no_match: "#a0a0a0",
  failed_verification: "#fdba74",
  abandoned: "#c4b5fd",
};

const LABELS: Record<string, string> = {
  booked: "Booked",
  declined: "Declined",
  no_match: "No match",
  failed_verification: "Failed verification",
  abandoned: "Abandoned",
  negotiated_no_deal: "Negotiated, no deal",
};

export function OutcomeChart({ summary }: { summary: MetricsSummary }) {
  const data = OUTCOME_ORDER.filter((key) => (summary.by_outcome[key] ?? 0) > 0).map((key) => ({
    name: LABELS[key] ?? key,
    value: summary.by_outcome[key],
    color: OUTCOME_COLORS[key],
  }));

  if (data.length === 0) {
    return (
      <div style={panel}>
        <h2 style={h2}>Outcomes</h2>
        <p style={{ color: "var(--muted)", margin: 0 }}>No data yet.</p>
      </div>
    );
  }

  return (
    <div style={panel}>
      <h2 style={h2}>Outcomes</h2>
      <div style={{ width: "100%", height: 260 }}>
        <ResponsiveContainer>
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={56}
              outerRadius={88}
              paddingAngle={2}
            >
              {data.map((d, i) => (
                <Cell key={i} fill={d.color} stroke="transparent" />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                background: "var(--surface2)",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                color: "var(--text)",
              }}
              labelStyle={{ color: "var(--text)" }}
              itemStyle={{ color: "var(--text)" }}
            />
            <Legend wrapperStyle={{ color: "var(--muted)", fontSize: "12px" }} />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

const panel: CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "12px",
  padding: "1.1rem 1.15rem",
};

const h2: CSSProperties = {
  fontSize: "0.95rem",
  marginBottom: "0.75rem",
  color: "var(--text)",
  fontWeight: 600,
};
