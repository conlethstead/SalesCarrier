import type { MetricsSummary } from "./types";

function apiKey(): string {
  const k = import.meta.env.VITE_API_KEY;
  return typeof k === "string" ? k : "";
}

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const key = apiKey();
  const headers = new Headers(init?.headers);
  if (key) headers.set("X-API-Key", key);
  return fetch(path, { ...init, headers });
}

export async function fetchSummary(): Promise<MetricsSummary> {
  const res = await apiFetch("/api/summary");
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? res.statusText);
  }
  return res.json() as Promise<MetricsSummary>;
}
