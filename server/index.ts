import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import cors from "cors";
import express from "express";
import { fileURLToPath } from "node:url";
import type { CallEventPayload, SupabaseLoadRow } from "../shared/metrics.js";
import { appendEvent, computeSummary } from "./store.js";
import {
  buildRecentCallEntries,
  getSupabaseForLoads,
  laneMatchesRow,
  LOAD_ID_PATTERN,
  pairLaneSearchPatterns,
  parseLaneFragments,
  sanitizeLikeFragment,
} from "./supabase-loads.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT ?? 3001);
const API_KEY = process.env.API_KEY ?? "dev-insecure-change-me";

function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/** HappyRobot and similar tools often send every field as a string — coerce at the boundary. */
function str(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return String(v);
}

function parseNonNegNumber(v: unknown, label: string): { ok: true; n: number } | { ok: false; error: string } {
  if (v == null) return { ok: false, error: `${label} is required` };
  const n =
    typeof v === "number"
      ? v
      : typeof v === "string"
        ? Number.parseFloat(v.trim())
        : Number.NaN;
  if (Number.isNaN(n) || n < 0) return { ok: false, error: `${label} must be a non-negative number` };
  return { ok: true, n };
}

function parseNonNegInt(v: unknown, label: string): { ok: true; n: number } | { ok: false; error: string } {
  if (v == null) return { ok: false, error: `${label} is required` };
  const n =
    typeof v === "number"
      ? Math.trunc(v)
      : typeof v === "string"
        ? Number.parseInt(v.trim(), 10)
        : Number.NaN;
  if (!Number.isInteger(n) || n < 0) return { ok: false, error: `${label} must be a non-negative integer` };
  return { ok: true, n };
}

function parseVerified(v: unknown): { ok: true; value?: boolean } | { ok: false; error: string } {
  if (v == null || v === "") return { ok: true, value: undefined };
  if (typeof v === "boolean") return { ok: true, value: v };
  if (typeof v === "number") return { ok: true, value: v !== 0 };
  const s = str(v).trim().toLowerCase();
  if (["true", "yes", "1", "y"].includes(s)) return { ok: true, value: true };
  if (["false", "no", "0", "n"].includes(s)) return { ok: true, value: false };
  return { ok: false, error: 'verified must be true/false, yes/no, 1/0, or a boolean string' };
}

function parseOptionalNumber(v: unknown, label: string): { ok: true; n: number | null } | { ok: false; error: string } {
  if (v == null || str(v) === "") return { ok: true, n: null };
  const p = parseNonNegNumber(v, label);
  if (!p.ok) return p;
  return { ok: true, n: p.n };
}

function parseOptionalInt(v: unknown, label: string): { ok: true; n: number | null } | { ok: false; error: string } {
  if (v == null || str(v) === "") return { ok: true, n: null };
  const p = parseNonNegInt(v, label);
  if (!p.ok) return p;
  return { ok: true, n: p.n };
}

function parseLoadRow(v: unknown, index: number): { ok: true; row: SupabaseLoadRow } | { ok: false; error: string } {
  if (!v || typeof v !== "object") return { ok: false, error: `load[${index}] must be an object` };
  const r = v as Record<string, unknown>;

  const load_id = str(r.load_id).trim().toUpperCase();
  const origin = str(r.origin).trim();
  const destination = str(r.destination).trim();
  const pickup_datetime = str(r.pickup_datetime).trim();
  const delivery_datetime = str(r.delivery_datetime).trim();
  const equipment_type = str(r.equipment_type).trim();
  const commodity_type = str(r.commodity_type).trim();
  const created_at = str(r.created_at).trim() || new Date().toISOString();

  if (!load_id) return { ok: false, error: `load[${index}].load_id is required` };
  if (!origin) return { ok: false, error: `load[${index}].origin is required` };
  if (!destination) return { ok: false, error: `load[${index}].destination is required` };
  if (!pickup_datetime) return { ok: false, error: `load[${index}].pickup_datetime is required` };
  if (!delivery_datetime) return { ok: false, error: `load[${index}].delivery_datetime is required` };
  if (!equipment_type) return { ok: false, error: `load[${index}].equipment_type is required` };
  if (!commodity_type) return { ok: false, error: `load[${index}].commodity_type is required` };

  const rate = parseNonNegNumber(r.loadboard_rate, `load[${index}].loadboard_rate`);
  if (!rate.ok) return rate;
  const miles = parseOptionalNumber(r.miles, `load[${index}].miles`);
  if (!miles.ok) return miles;
  const weight = parseOptionalNumber(r.weight, `load[${index}].weight`);
  if (!weight.ok) return weight;
  const numOfPieces = parseOptionalInt(r.num_of_pieces, `load[${index}].num_of_pieces`);
  if (!numOfPieces.ok) return numOfPieces;

  return {
    ok: true,
    row: {
      load_id,
      origin: origin.slice(0, 500),
      destination: destination.slice(0, 500),
      pickup_datetime,
      delivery_datetime,
      equipment_type: equipment_type.slice(0, 200),
      loadboard_rate: rate.n,
      notes: str(r.notes).trim().slice(0, 4000) || null,
      weight: weight.n,
      commodity_type: commodity_type.slice(0, 300),
      num_of_pieces: numOfPieces.n,
      miles: miles.n,
      dimensions: str(r.dimensions).trim().slice(0, 200) || null,
      created_at,
    },
  };
}

function parseLoadArray(v: unknown): { ok: true; rows: SupabaseLoadRow[] } | { ok: false; error: string } {
  if (v == null) return { ok: true, rows: [] };
  if (!Array.isArray(v)) return { ok: false, error: "load must be an array when provided" };
  const rows: SupabaseLoadRow[] = [];
  for (let i = 0; i < v.length; i++) {
    const parsed = parseLoadRow(v[i], i);
    if (!parsed.ok) return parsed;
    rows.push(parsed.row);
  }
  return { ok: true, rows };
}

function apiKeyFromRequest(req: express.Request): string | undefined {
  const fromHeader = req.header("x-api-key");
  if (fromHeader) return fromHeader;

  const auth = req.header("authorization")?.trim();
  if (auth) {
    const bearer = /^Bearer\s+(\S+)/i.exec(auth);
    if (bearer) return bearer[1];
    const apiKeyScheme = /^ApiKey\s+(\S+)/i.exec(auth);
    if (apiKeyScheme) return apiKeyScheme[1];
  }

  const raw = req.query.api_key;
  if (typeof raw === "string" && raw !== "") return raw;
  if (Array.isArray(raw) && typeof raw[0] === "string" && raw[0] !== "") return raw[0];
  return undefined;
}

function requireApiKey(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  const key = apiKeyFromRequest(req);
  if (!key || !timingSafeEqual(key, API_KEY)) {
    res.status(401).json({
      error: "Unauthorized",
      detail:
        "Invalid or missing API key (X-API-Key header, Authorization: Bearer or ApiKey, or api_key query)",
    });
    return;
  }
  next();
}

function validatePayload(body: unknown): { ok: true; data: CallEventPayload } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Body must be a JSON object" };
  const b = body as Record<string, unknown>;
  const ref = str(b.reference_number).trim();
  if (!ref) {
    return { ok: false, error: "reference_number is required (string)" };
  }

  const payload: CallEventPayload = {
    reference_number: ref,
  };

  if (b.mc_number != null && str(b.mc_number) !== "") {
    payload.mc_number = str(b.mc_number).trim();
  }
  if (b.booking_decision != null && str(b.booking_decision) !== "") {
    const raw = str(b.booking_decision).trim().toLowerCase();
    if (raw === "yes" || raw === "no") {
      payload.booking_decision = raw;
    } else {
      return { ok: false, error: 'booking_decision must be "yes" or "no" (strings accepted, case-insensitive)' };
    }
  }
  if (b.decline_reason != null && str(b.decline_reason) !== "") {
    payload.decline_reason = str(b.decline_reason).slice(0, 2000);
  }
  if (b.call_duration != null && str(b.call_duration) !== "") {
    const p = parseNonNegNumber(b.call_duration, "call_duration");
    if (!p.ok) return p;
    payload.call_duration = p.n;
  }
  const counterRaw =
    b.counteroffers ??
    b.number_of_counteroffers ??
    b.counter_offers ??
    b.numberOfCounterOffers;
  if (counterRaw != null && str(counterRaw) !== "") {
    const p = parseNonNegInt(counterRaw, "counteroffers");
    if (!p.ok) return p;
    payload.counteroffers = p.n;
  }
  if (b.verified != null && str(b.verified) !== "") {
    const pv = parseVerified(b.verified);
    if (!pv.ok) return pv;
    if (pv.value !== undefined) payload.verified = pv.value;
  }
  if (b.occurred_at != null && str(b.occurred_at) !== "") {
    payload.occurred_at = str(b.occurred_at).trim();
  }
  if (b.carrier_name != null && str(b.carrier_name) !== "") {
    payload.carrier_name = str(b.carrier_name).trim().slice(0, 500);
  }
  const sentimentClassRaw = b.sentiment_classification ?? b.sentimentClassification;
  if (sentimentClassRaw != null && str(sentimentClassRaw) !== "") {
    payload.sentiment_classification = str(sentimentClassRaw).trim().slice(0, 500);
  }
  const sentimentReasonRaw = b.sentiment_reasoning ?? b.sentimentReasoning;
  if (sentimentReasonRaw != null && str(sentimentReasonRaw) !== "") {
    payload.sentiment_reasoning = str(sentimentReasonRaw).slice(0, 4000);
  }
  if (b.trailer != null && str(b.trailer) !== "") {
    payload.trailer = str(b.trailer).trim().slice(0, 200);
  }
  if (b.lane != null && str(b.lane) !== "") {
    payload.lane = str(b.lane).trim().slice(0, 500);
  }
  if (b.listed_rate != null && str(b.listed_rate) !== "") {
    payload.listed_rate = str(b.listed_rate).trim().slice(0, 200);
  }
  if (b.how_load_was_found != null && str(b.how_load_was_found) !== "") {
    payload.how_load_was_found = str(b.how_load_was_found).trim().slice(0, 2000);
  }
  if (b.agreed_rate != null) {
    payload.agreed_rate = str(b.agreed_rate).trim().slice(0, 200);
  }
  if (b.abandoned != null && str(b.abandoned) !== "") {
    payload.abandoned = str(b.abandoned).trim().slice(0, 50);
  }
  if (b.failed_verification != null && str(b.failed_verification) !== "") {
    payload.failed_verification = str(b.failed_verification).trim().slice(0, 50);
  }
  if (b.loading_error != null && str(b.loading_error) !== "") {
    payload.loading_error = str(b.loading_error).trim().slice(0, 500);
  }
  if (b.step_of_emotion != null && str(b.step_of_emotion) !== "") {
    payload.step_of_emotion = str(b.step_of_emotion).trim().slice(0, 500);
  }
  if (b.load != null) {
    const parsedLoad = parseLoadArray(b.load);
    if (!parsedLoad.ok) return parsedLoad;
    if (parsedLoad.rows.length > 0) payload.load = parsedLoad.rows;
  }

  return { ok: true, data: payload };
}

export function createApp() {
  const app = express();
  if (process.env.NODE_ENV === "production") {
    app.set("trust proxy", 1);
  }
  app.use(cors());
  app.use(express.json({ limit: "256kb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, service: "carrier-sales-metrics" });
  });

  app.post("/api/events", requireApiKey, (req, res) => {
    const parsed = validatePayload(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    try {
      const record = appendEvent(parsed.data);
      res.status(201).json(record);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to persist event" });
    }
  });

  app.get("/api/summary", requireApiKey, (_req, res) => {
    const computed = computeSummary(75);
    const recent = buildRecentCallEntries(computed.recent);
    res.json({ ...computed, recent });
  });

  /**
   * Protected load search for HappyRobot / AI workflows (e.g. Cloud Run).
   * API key must match API_KEY (X-API-Key, Authorization Bearer/ApiKey, or api_key query).
   *
   * Query parameters (same shape as the workflow “Fetch load details” step):
   * - reference_number — if non-empty, search by load_id only; lane and equipment are ignored.
   * - Otherwise both lane and equipment are required (equipment_type substring + lane; see parseLaneFragments).
   * Optional aliases: load_id for reference_number, equipment_type for equipment.
   */
  app.get("/api/loads", requireApiKey, async (req, res) => {
    const supabase = getSupabaseForLoads();
    if (!supabase) {
      res.status(503).json({
        error: "Load search unavailable",
        detail: "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the server.",
      });
      return;
    }

    const referenceNumberRaw = str(req.query.reference_number).trim() || str(req.query.load_id).trim();
    const equipmentRaw = str(req.query.equipment).trim() || str(req.query.equipment_type).trim();
    const laneRaw = str(req.query.lane).trim();

    if (referenceNumberRaw !== "") {
      const referenceNumber = referenceNumberRaw.toUpperCase();
      if (!LOAD_ID_PATTERN.test(referenceNumber)) {
        res.status(400).json({
          error: "Invalid reference_number",
          detail: "Must be three uppercase letters followed by five digits (e.g. FDX10234).",
        });
        return;
      }
      const { data, error } = await supabase
        .from("loads")
        .select("*")
        .eq("load_id", referenceNumber)
        .order("pickup_datetime", { ascending: true });

      if (error) {
        console.error("Supabase loads query:", error.message);
        res.status(500).json({ error: "Failed to query loads", detail: error.message });
        return;
      }
      res.json({ loads: data ?? [] });
      return;
    }

    if (laneRaw === "" || equipmentRaw === "") {
      res.status(400).json({
        error: "Invalid query",
        detail:
          "Without reference_number, both lane and equipment are required (e.g. lane=Chicago, IL...Madison, WI&equipment=Dry Van).",
      });
      return;
    }

    const equipment = sanitizeLikeFragment(equipmentRaw);
    if (!equipment) {
      res.status(400).json({
        error: "Invalid query",
        detail: "equipment is empty or invalid after sanitization.",
      });
      return;
    }

    const lane = parseLaneFragments(laneRaw);

    if (lane.kind === "pair") {
      const patterns = pairLaneSearchPatterns(lane.origin, lane.dest);
      let lastError: string | null = null;
      for (const { origin: o, dest: d } of patterns) {
        const { data, error } = await supabase
          .from("loads")
          .select("*")
          .ilike("equipment_type", `%${equipment}%`)
          .ilike("origin", `%${o}%`)
          .ilike("destination", `%${d}%`)
          .order("pickup_datetime", { ascending: true });

        if (error) {
          lastError = error.message;
          console.error("Supabase loads query:", error.message);
          break;
        }
        if ((data?.length ?? 0) > 0) {
          res.json({ loads: data ?? [] });
          return;
        }
      }
      if (lastError) {
        res.status(500).json({ error: "Failed to query loads", detail: lastError });
        return;
      }
      res.json({ loads: [] });
      return;
    }

    if (!lane.text) {
      res.status(400).json({ error: "Invalid query", detail: "lane must not be empty." });
      return;
    }

    const { data, error } = await supabase
      .from("loads")
      .select("*")
      .ilike("equipment_type", `%${equipment}%`)
      .order("pickup_datetime", { ascending: true });

    if (error) {
      console.error("Supabase loads query:", error.message);
      res.status(500).json({ error: "Failed to query loads", detail: error.message });
      return;
    }

    const rows = (data ?? []).filter((row) => laneMatchesRow(row, lane.text));
    res.json({ loads: rows });
  });

  const dist = [path.join(__dirname, "..", "dist"), path.join(__dirname, "..", "..", "dist")].find(
    (d) => fs.existsSync(path.join(d, "index.html"))
  );
  if (dist) {
    app.use(express.static(dist));
    app.get("*", (req, res) => {
      // Never serve the SPA for /api/* — avoids masking missing API routes with index.html (e.g. stale image).
      if (req.path.startsWith("/api")) {
        res.status(404).json({ error: "Not found", path: req.path });
        return;
      }
      res.sendFile(path.join(dist, "index.html"));
    });
  } else if (process.env.NODE_ENV === "production") {
    console.warn("No dist/index.html found; static UI not served. Build the client with npm run build.");
  }

  return app;
}

const app = createApp();
const host = process.env.LISTEN_HOST ?? "0.0.0.0";
app.listen(PORT, host, () => {
  console.log(`Metrics API listening on http://${host}:${PORT}`);
});
