import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { MetricsSummary } from "../types";

const SENTIMENT_BAR_COLORS: Record<string, string> = {
  Positive: "var(--booked-accent)",
  Neutral: "var(--negotiated-accent)",
  Negative: "var(--declined-accent)",
};

export function SentimentChart({ summary }: { summary: MetricsSummary }) {
  const data = [
    { name: "Positive", value: summary.by_sentiment.positive },
    { name: "Neutral", value: summary.by_sentiment.neutral },
    { name: "Negative", value: summary.by_sentiment.negative },
  ];

  const hasData = data.some((d) => d.value > 0);

  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "12px",
        padding: "1.1rem 1.15rem",
      }}
    >
      <h2
        style={{
          fontSize: "0.95rem",
          marginBottom: "0.75rem",
          color: "var(--text)",
          fontWeight: 600,
        }}
      >
        Carrier sentiment
      </h2>
      {!hasData ? (
        <p style={{ color: "var(--muted)", margin: 0 }}>No data yet.</p>
      ) : (
        <div style={{ width: "100%", height: 260 }}>
          <ResponsiveContainer>
            <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="name" tick={{ fill: "var(--muted)", fontSize: 12 }} axisLine={false} />
              <YAxis allowDecimals={false} tick={{ fill: "var(--muted)", fontSize: 12 }} axisLine={false} />
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
              <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={48}>
                {data.map((d) => (
                  <Cell key={d.name} fill={SENTIMENT_BAR_COLORS[d.name] ?? "var(--text)"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
