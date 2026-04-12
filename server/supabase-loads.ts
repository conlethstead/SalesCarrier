import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null | undefined;

export function getSupabaseForLoads(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  if (client === undefined) {
    client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return client;
}

/** Strip LIKE wildcards so query params cannot broaden matches unexpectedly. */
export function sanitizeLikeFragment(s: string): string {
  return s.replace(/[%_\\]/g, "");
}

/**
 * Split a lane string into origin/destination fragments when separators are present
 * (e.g. "Chicago, IL to Dallas, TX", "Atlanta → Miami").
 * Otherwise returns a single fuzzy string matched in app code against origin/destination.
 */
export function parseLaneFragments(
  lane: string
): { kind: "pair"; origin: string; dest: string } | { kind: "fuzzy"; text: string } {
  const trimmed = lane.trim();
  if (!trimmed) return { kind: "fuzzy", text: "" };

  const tryPair = (a: string, b: string): { origin: string; dest: string } | null => {
    const o = sanitizeLikeFragment(a.trim());
    const d = sanitizeLikeFragment(b.trim());
    return o && d ? { origin: o, dest: d } : null;
  };

  const byTo = trimmed.split(/\s+to\s+/i);
  if (byTo.length >= 2) {
    const p = tryPair(byTo[0], byTo.slice(1).join(" to "));
    if (p) return { kind: "pair", ...p };
  }

  const byArrow = trimmed.split(/\s*(?:→|->)\s*/);
  if (byArrow.length >= 2) {
    const p = tryPair(byArrow[0], byArrow.slice(1).join(" -> "));
    if (p) return { kind: "pair", ...p };
  }

  const byPipe = trimmed.split(/\s*\|\s*/);
  if (byPipe.length >= 2) {
    const p = tryPair(byPipe[0], byPipe.slice(1).join(" | "));
    if (p) return { kind: "pair", ...p };
  }

  const bySpacedDash = trimmed.split(/\s+-\s+/);
  if (bySpacedDash.length >= 2) {
    const p = tryPair(bySpacedDash[0], bySpacedDash.slice(1).join(" - "));
    if (p) return { kind: "pair", ...p };
  }

  return { kind: "fuzzy", text: sanitizeLikeFragment(trimmed) };
}

export function laneMatchesRow(
  row: { origin: string; destination: string },
  fuzzy: string
): boolean {
  if (!fuzzy) return false;
  const hay = `${row.origin} ${row.destination}`.toLowerCase();
  const needle = fuzzy.toLowerCase();
  return hay.includes(needle);
}

export type LoadRow = {
  load_id: string;
  origin: string;
  destination: string;
  pickup_datetime: string;
  delivery_datetime: string;
  equipment_type: string;
  loadboard_rate: number;
  notes: string | null;
  weight: number | null;
  commodity_type: string;
  num_of_pieces: number | null;
  miles: number | null;
  dimensions: string | null;
  created_at: string;
};
