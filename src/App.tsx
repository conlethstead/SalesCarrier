import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { fetchSummary } from "./api";
import type { MetricsSummary } from "./types";
import { KpiRow } from "./components/KpiRow";
import { OutcomeChart } from "./components/OutcomeChart";
import { SentimentChart } from "./components/SentimentChart";
import { RecentTable } from "./components/RecentTable";

export default function App() {
  const [data, setData] = useState<MetricsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const s = await fetchSummary();
      setData(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load metrics");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 30_000);
    return () => clearInterval(id);
  }, [load]);

  return (
    <div style={layout}>
      <header style={header}>
        <div>
          <h1 style={{ fontSize: "1.35rem" }}>Inbound carrier sales</h1>
          <p style={subtitle}>Assistant outcomes, sentiment, and offer signals</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <button type="button" onClick={() => void load()} style={btn}>
            Refresh
          </button>
        </div>
      </header>

      {error && (
        <div style={errBox} role="alert">
          <strong>Could not load metrics.</strong> {error}
          {!import.meta.env.VITE_API_KEY && (
            <span style={{ display: "block", marginTop: "0.5rem", fontSize: "0.85rem" }}>
              Set <code style={code}>VITE_API_KEY</code> to match server <code style={code}>API_KEY</code>{" "}
              (same value in <code style={code}>.env</code> for Vite).
            </span>
          )}
        </div>
      )}

      {loading && !data && !error && <p style={{ color: "var(--muted)" }}>Loading…</p>}

      {data && (
        <>
          <KpiRow summary={data} />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              gap: "1.25rem",
              marginBottom: "1.5rem",
            }}
          >
            <OutcomeChart summary={data} />
            <SentimentChart summary={data} />
          </div>
          <RecentTable rows={data.recent} />
        </>
      )}
    </div>
  );
}

const layout: CSSProperties = {
  maxWidth: "1120px",
  margin: "0 auto",
  padding: "1.75rem 1.25rem 3rem",
};

const header: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: "1rem",
  marginBottom: "1.75rem",
  paddingBottom: "1.25rem",
  borderBottom: "1px solid var(--border)",
};

const subtitle: CSSProperties = {
  margin: "0.35rem 0 0",
  fontSize: "0.95rem",
  color: "var(--muted)",
};

const btn: CSSProperties = {
  background: "var(--surface2)",
  border: "1px solid var(--border)",
  color: "var(--text)",
  padding: "0.45rem 0.9rem",
  borderRadius: "8px",
  cursor: "pointer",
  fontSize: "0.9rem",
};

const errBox: CSSProperties = {
  background: "rgba(248, 113, 113, 0.08)",
  border: "1px solid rgba(248, 113, 113, 0.35)",
  borderRadius: "10px",
  padding: "1rem 1.1rem",
  marginBottom: "1.25rem",
  fontSize: "0.95rem",
};

const code: CSSProperties = {
  fontFamily: "var(--mono)",
  fontSize: "0.85em",
  background: "var(--surface)",
  padding: "0.1em 0.35em",
  borderRadius: "4px",
};
