import type { MetricsEnvironmentFilter, MetricsSummary } from "./types";

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

function environmentQuery(environment: MetricsEnvironmentFilter): string {
  if (environment === "all") return "";
  const p = new URLSearchParams({ environment });
  return `?${p.toString()}`;
}

export async function fetchSummary(
  environment: MetricsEnvironmentFilter = "all"
): Promise<MetricsSummary> {
  const res = await apiFetch(`/api/summary${environmentQuery(environment)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? res.statusText);
  }
  const raw = (await res.json()) as MetricsSummary & {
    avg_listed_minus_agreed_when_booked?: number | null;
  };
  // Older API responses only exposed listed − agreed; map to agreed − listed.
  if (
    raw.avg_agreed_minus_listed_when_booked == null &&
    raw.avg_listed_minus_agreed_when_booked != null
  ) {
    raw.avg_agreed_minus_listed_when_booked = -raw.avg_listed_minus_agreed_when_booked;
  }
  return raw;
}

/** All stored calls as CSV (UTF-8 with BOM), newest first. Same columns as “Download CSV (filtered)”. */
export async function fetchAllCallsCsvBlob(
  environment: MetricsEnvironmentFilter = "all"
): Promise<Blob> {
  const res = await apiFetch(`/api/export/calls.csv${environmentQuery(environment)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? res.statusText);
  }
  return res.blob();
}
