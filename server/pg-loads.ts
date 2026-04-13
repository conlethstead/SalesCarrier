import pg from "pg";
import type { SupabaseLoadRow } from "../shared/metrics.js";
import {
  laneMatchesRow,
  pairLaneSearchPatterns,
  parseLaneFragments,
  sanitizeLikeFragment,
} from "./supabase-loads.js";

let pool: pg.Pool | undefined;

export function getPgPoolForLoads(): pg.Pool | null {
  const conn = process.env.DATABASE_URL?.trim();
  if (!conn) return null;
  if (pool === undefined) {
    pool = new pg.Pool({ connectionString: conn, max: 8 });
  }
  return pool;
}

function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (v == null) return Number.NaN;
  const n = Number.parseFloat(String(v));
  return Number.isNaN(n) ? Number.NaN : n;
}

function numOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = num(v);
  return Number.isNaN(n) ? null : n;
}

function intOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? Math.trunc(v) : Number.parseInt(String(v), 10);
  return Number.isInteger(n) ? n : null;
}

export function mapPgLoadRow(r: Record<string, unknown>): SupabaseLoadRow {
  return {
    load_id: String(r.load_id ?? ""),
    origin: String(r.origin ?? ""),
    destination: String(r.destination ?? ""),
    pickup_datetime: String(r.pickup_datetime ?? ""),
    delivery_datetime: String(r.delivery_datetime ?? ""),
    equipment_type: String(r.equipment_type ?? ""),
    loadboard_rate: num(r.loadboard_rate),
    notes: r.notes == null ? null : String(r.notes),
    weight: numOrNull(r.weight),
    commodity_type: String(r.commodity_type ?? ""),
    num_of_pieces: intOrNull(r.num_of_pieces),
    miles: numOrNull(r.miles),
    dimensions: r.dimensions == null ? null : String(r.dimensions),
    created_at: String(r.created_at ?? ""),
  };
}

export async function pgFetchLoadsById(pool: pg.Pool, loadId: string): Promise<SupabaseLoadRow[]> {
  const res = await pool.query<Record<string, unknown>>(
    `select * from public.loads where load_id = $1 order by pickup_datetime asc`,
    [loadId]
  );
  return res.rows.map(mapPgLoadRow);
}

export async function pgFetchLoadsLanePair(
  pool: pg.Pool,
  equipmentPattern: string,
  origin: string,
  dest: string
): Promise<SupabaseLoadRow[]> {
  const res = await pool.query<Record<string, unknown>>(
    `select * from public.loads
     where equipment_type ilike $1 and origin ilike $2 and destination ilike $3
     order by pickup_datetime asc`,
    [`%${equipmentPattern}%`, `%${origin}%`, `%${dest}%`]
  );
  return res.rows.map(mapPgLoadRow);
}

export async function pgFetchLoadsEquipmentOnly(
  pool: pg.Pool,
  equipmentPattern: string
): Promise<SupabaseLoadRow[]> {
  const res = await pool.query<Record<string, unknown>>(
    `select * from public.loads where equipment_type ilike $1 order by pickup_datetime asc`,
    [`%${equipmentPattern}%`]
  );
  return res.rows.map(mapPgLoadRow);
}

/** Mirrors GET /api/loads Supabase branch using a Postgres pool (e.g. Docker `DATABASE_URL`). */
export async function pgSearchLoads(
  pool: pg.Pool,
  referenceNumberRaw: string,
  equipmentRaw: string,
  laneRaw: string
): Promise<{ ok: true; loads: SupabaseLoadRow[] } | { ok: false; status: number; error: string; detail?: string }> {
  if (referenceNumberRaw !== "") {
    const referenceNumber = referenceNumberRaw.toUpperCase();
    if (!/^[A-Z]{3}\d{5}$/.test(referenceNumber)) {
      return {
        ok: false,
        status: 400,
        error: "Invalid reference_number",
        detail: "Must be three uppercase letters followed by five digits (e.g. FDX10234).",
      };
    }
    const loads = await pgFetchLoadsById(pool, referenceNumber);
    return { ok: true, loads };
  }

  if (laneRaw === "" || equipmentRaw === "") {
    return {
      ok: false,
      status: 400,
      error: "Invalid query",
      detail:
        "Without reference_number, both lane and equipment are required (e.g. lane=Chicago, IL...Madison, WI&equipment=Dry Van).",
    };
  }

  const equipment = sanitizeLikeFragment(equipmentRaw);
  if (!equipment) {
    return {
      ok: false,
      status: 400,
      error: "Invalid query",
      detail: "equipment is empty or invalid after sanitization.",
    };
  }

  const lane = parseLaneFragments(laneRaw);

  if (lane.kind === "pair") {
    const patterns = pairLaneSearchPatterns(lane.origin, lane.dest);
    let lastError: string | null = null;
    for (const { origin: o, dest: d } of patterns) {
      try {
        const loads = await pgFetchLoadsLanePair(pool, equipment, o, d);
        if (loads.length > 0) return { ok: true, loads };
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        console.error("Postgres loads query:", lastError);
        break;
      }
    }
    if (lastError) {
      return { ok: false, status: 500, error: "Failed to query loads", detail: lastError };
    }
    return { ok: true, loads: [] };
  }

  if (!lane.text) {
    return { ok: false, status: 400, error: "Invalid query", detail: "lane must not be empty." };
  }

  try {
    const all = await pgFetchLoadsEquipmentOnly(pool, equipment);
    const loads = all.filter((row) => laneMatchesRow(row, lane.text));
    return { ok: true, loads };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("Postgres loads query:", msg);
    return { ok: false, status: 500, error: "Failed to query loads", detail: msg };
  }
}
