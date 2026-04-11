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
  if (typeof b.call_id !== "string" || !b.call_id.trim()) {
    return { ok: false, error: "call_id is required" };
  }
  const outcomes = [
    "booked",
    "declined",
    "no_match",
    "failed_verification",
    "abandoned",
    "negotiated_no_deal",
  ] as const;
  if (typeof b.outcome !== "string" || !outcomes.includes(b.outcome as (typeof outcomes)[number])) {
    return { ok: false, error: "outcome must be a valid CallOutcome" };
  }
  const sentiments = ["positive", "neutral", "negative"] as const;
  if (typeof b.sentiment !== "string" || !sentiments.includes(b.sentiment as (typeof sentiments)[number])) {
    return { ok: false, error: "sentiment must be positive | neutral | negative" };
  }
  const payload: CallEventPayload = {
    call_id: b.call_id.trim(),
    outcome: b.outcome as CallEventPayload["outcome"],
    sentiment: b.sentiment as CallEventPayload["sentiment"],
  };
  if (b.occurred_at != null) {
    if (typeof b.occurred_at !== "string") return { ok: false, error: "occurred_at must be ISO string" };
    payload.occurred_at = b.occurred_at;
  }
  if (b.load_id != null) {
    if (typeof b.load_id !== "string") return { ok: false, error: "load_id must be string" };
    payload.load_id = b.load_id;
  }
  if (b.agreed_rate != null) {
    if (typeof b.agreed_rate !== "number" || Number.isNaN(b.agreed_rate)) {
      return { ok: false, error: "agreed_rate must be a number" };
    }
    payload.agreed_rate = b.agreed_rate;
  }
  if (b.listed_rate != null) {
    if (typeof b.listed_rate !== "number" || Number.isNaN(b.listed_rate)) {
      return { ok: false, error: "listed_rate must be a number" };
    }
    payload.listed_rate = b.listed_rate;
  }
  if (b.negotiation_rounds != null) {
    if (typeof b.negotiation_rounds !== "number" || !Number.isInteger(b.negotiation_rounds)) {
      return { ok: false, error: "negotiation_rounds must be an integer" };
    }
    payload.negotiation_rounds = b.negotiation_rounds;
  }
  if (b.notes != null) {
    if (typeof b.notes !== "string") return { ok: false, error: "notes must be string" };
    payload.notes = b.notes.slice(0, 2000);
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
