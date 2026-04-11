import type { CSSProperties } from "react";
import {
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import type { MetricsSummary } from "../types";

const COLORS = ["#34d399", "#60a5fa", "#fbbf24", "#f87171", "#a78bfa", "#94a3b8"];

const LABELS: Record<string, string> = {
  booked: "Booked",
  declined: "Declined",
  no_match: "No match",
  failed_verification: "Failed verification",
  abandoned: "Abandoned",
  negotiated_no_deal: "Negotiated, no deal",
};

export function OutcomeChart({ summary }: { summary: MetricsSummary }) {
  const data = Object.entries(summary.by_outcome)
    .filter(([, v]) => v > 0)
    .map(([name, value]) => ({ name: LABELS[name] ?? name, value }));

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
              {data.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} stroke="transparent" />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                background: "var(--surface2)",
                border: "1px solid var(--border)",
                borderRadius: "8px",
              }}
            />
            <Legend />
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
  color: "var(--muted)",
  fontWeight: 600,
};
