import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import cors from "cors";
import express from "express";
import { fileURLToPath } from "node:url";
import type { CallEventPayload } from "../shared/metrics.js";
import { appendEvent, computeSummary } from "./store.js";
import {
  getSupabaseForLoads,
  laneMatchesRow,
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

function requireApiKey(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  const key = req.header("x-api-key");
  if (!key || !timingSafeEqual(key, API_KEY)) {
    res.status(401).json({ error: "Unauthorized", detail: "Invalid or missing X-API-Key" });
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
  if (b.sentiment_classification != null && str(b.sentiment_classification) !== "") {
    payload.sentiment_classification = str(b.sentiment_classification).trim().slice(0, 500);
  }
  if (b.sentiment_reasoning != null && str(b.sentiment_reasoning) !== "") {
    payload.sentiment_reasoning = str(b.sentiment_reasoning).slice(0, 4000);
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
    res.json(computeSummary(75));
  });

  /** load_id / reference_number: three uppercase letters + five digits (e.g. FDX10234). */
  const loadIdPattern = /^[A-Z]{3}\d{5}$/;

  /**
   * Protected load search for HappyRobot / AI workflows (e.g. Cloud Run).
   * Header X-API-Key must match API_KEY.
   *
   * Query modes (exactly one):
   * 1) reference_number — matches load_id (optional alias: load_id).
   * 2) equipment + lane — equipment_type substring + lane (origin/destination); see parseLaneFragments.
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
    const referenceNumber = referenceNumberRaw.toUpperCase();
    const equipmentRaw = str(req.query.equipment).trim() || str(req.query.equipment_type).trim();
    const laneRaw = str(req.query.lane).trim();

    if (referenceNumber) {
      if (!loadIdPattern.test(referenceNumber)) {
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

    const equipment = sanitizeLikeFragment(equipmentRaw);
    if (!equipment || !laneRaw) {
      res.status(400).json({
        error: "Invalid query",
        detail:
          "Provide either reference_number (load id) or both equipment and lane query parameters.",
      });
      return;
    }

    const lane = parseLaneFragments(laneRaw);

    if (lane.kind === "pair") {
      const { data, error } = await supabase
        .from("loads")
        .select("*")
        .ilike("equipment_type", `%${equipment}%`)
        .ilike("origin", `%${lane.origin}%`)
        .ilike("destination", `%${lane.dest}%`)
        .order("pickup_datetime", { ascending: true });

      if (error) {
        console.error("Supabase loads query:", error.message);
        res.status(500).json({ error: "Failed to query loads", detail: error.message });
        return;
      }
      res.json({ loads: data ?? [] });
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
