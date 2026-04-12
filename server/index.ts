import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import cors from "cors";
import express from "express";
import { fileURLToPath } from "node:url";
import type { CallEventPayload } from "../shared/metrics.js";
import { appendEvent, computeSummary } from "./store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT ?? 3001);
const API_KEY = process.env.API_KEY ?? "dev-insecure-change-me";

function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
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
  if (typeof b.reference_number !== "string" || !b.reference_number.trim()) {
    return { ok: false, error: "reference_number is required" };
  }

  const payload: CallEventPayload = {
    reference_number: b.reference_number.trim(),
  };

  if (b.mc_number != null) {
    if (typeof b.mc_number !== "string") return { ok: false, error: "mc_number must be a string" };
    payload.mc_number = b.mc_number.trim();
  }
  if (b.booking_decision != null) {
    if (typeof b.booking_decision !== "string") {
      return { ok: false, error: 'booking_decision must be a string: "yes" or "no"' };
    }
    const raw = b.booking_decision.trim().toLowerCase();
    if (raw === "yes" || raw === "no") {
      payload.booking_decision = raw;
    } else {
      return { ok: false, error: 'booking_decision must be "yes" or "no" (case-insensitive)' };
    }
  }
  if (b.decline_reason != null) {
    if (typeof b.decline_reason !== "string") return { ok: false, error: "decline_reason must be a string" };
    payload.decline_reason = b.decline_reason.slice(0, 2000);
  }
  if (b.call_duration != null) {
    const sec =
      typeof b.call_duration === "number"
        ? b.call_duration
        : typeof b.call_duration === "string"
          ? Number.parseFloat(b.call_duration)
          : NaN;
    if (Number.isNaN(sec) || sec < 0) {
      return { ok: false, error: "call_duration must be a non-negative number (seconds)" };
    }
    payload.call_duration = sec;
  }
  if (b.number_of_counteroffers != null) {
    const n =
      typeof b.number_of_counteroffers === "number"
        ? b.number_of_counteroffers
        : typeof b.number_of_counteroffers === "string"
          ? Number.parseInt(b.number_of_counteroffers, 10)
          : NaN;
    if (!Number.isInteger(n) || n < 0) {
      return { ok: false, error: "number_of_counteroffers must be a non-negative integer" };
    }
    payload.number_of_counteroffers = n;
  }
  if (b.verified != null) {
    if (typeof b.verified !== "boolean") return { ok: false, error: "verified must be a boolean" };
    payload.verified = b.verified;
  }
  if (b.occurred_at != null) {
    if (typeof b.occurred_at !== "string") return { ok: false, error: "occurred_at must be ISO string" };
    payload.occurred_at = b.occurred_at;
  }
  if (b.carrier_name != null) {
    if (typeof b.carrier_name !== "string") return { ok: false, error: "carrier_name must be a string" };
    payload.carrier_name = b.carrier_name.trim().slice(0, 500);
  }
  if (b.sentiment_classification != null) {
    if (typeof b.sentiment_classification !== "string") {
      return { ok: false, error: "sentiment_classification must be a string" };
    }
    payload.sentiment_classification = b.sentiment_classification.trim().slice(0, 500);
  }
  if (b.sentiment_reasoning != null) {
    if (typeof b.sentiment_reasoning !== "string") {
      return { ok: false, error: "sentiment_reasoning must be a string" };
    }
    payload.sentiment_reasoning = b.sentiment_reasoning.slice(0, 4000);
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

  const dist = [path.join(__dirname, "..", "dist"), path.join(__dirname, "..", "..", "dist")].find(
    (d) => fs.existsSync(path.join(d, "index.html"))
  );
  if (dist) {
    app.use(express.static(dist));
    app.get("*", (_req, res) => {
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
