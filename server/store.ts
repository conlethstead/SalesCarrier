import fs from "node:fs";
import path from "node:path";
import type {
  CallEventPayload,
  CallEventRecord,
  CallOutcome,
  CarrierSentiment,
  MetricsSummary,
} from "../shared/metrics.js";

const OUTCOMES: CallOutcome[] = [
  "booked",
  "declined",
  "no_match",
  "failed_verification",
  "abandoned",
  "negotiated_no_deal",
];

const SENTIMENTS: CarrierSentiment[] = ["positive", "neutral", "negative"];

function dataPath(): string {
  const dir = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
  return path.join(dir, "events.json");
}

function ensureDir(file: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

export function loadEvents(): CallEventRecord[] {
  const file = dataPath();
  if (!fs.existsSync(file)) return [];
  try {
    const raw = fs.readFileSync(file, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed as CallEventRecord[];
  } catch {
    return [];
  }
}

function saveEvents(events: CallEventRecord[]) {
  const file = dataPath();
  ensureDir(file);
  fs.writeFileSync(file, JSON.stringify(events, null, 2), "utf-8");
}

export function appendEvent(payload: CallEventPayload): CallEventRecord {
  const events = loadEvents();
  const record: CallEventRecord = {
    ...payload,
    received_at: new Date().toISOString(),
    occurred_at: payload.occurred_at ?? new Date().toISOString(),
  };
  events.push(record);
  saveEvents(events);
  return record;
}

export function computeSummary(limitRecent = 50): MetricsSummary {
  const events = loadEvents();
  const by_outcome = Object.fromEntries(
    OUTCOMES.map((o) => [o, 0])
  ) as Record<CallOutcome, number>;
  const by_sentiment = Object.fromEntries(
    SENTIMENTS.map((s) => [s, 0])
  ) as Record<CarrierSentiment, number>;

  for (const e of events) {
    if (by_outcome[e.outcome] !== undefined) by_outcome[e.outcome]++;
    if (by_sentiment[e.sentiment] !== undefined) by_sentiment[e.sentiment]++;
  }

  const booked_count = by_outcome.booked;
  const total_calls = events.length;
  const booking_rate = total_calls ? booked_count / total_calls : 0;

  const negotiated = events.filter(
    (e) => e.negotiation_rounds != null && e.negotiation_rounds > 0
  );
  const avg_negotiation_rounds_when_negotiated =
    negotiated.length === 0
      ? null
      : negotiated.reduce((s, e) => s + (e.negotiation_rounds ?? 0), 0) /
        negotiated.length;

  const bookedWithRate = events.filter(
    (e) => e.outcome === "booked" && e.agreed_rate != null
  );
  const avg_agreed_rate_when_booked =
    bookedWithRate.length === 0
      ? null
      : bookedWithRate.reduce((s, e) => s + (e.agreed_rate ?? 0), 0) /
        bookedWithRate.length;

  const recent = [...events].slice(-limitRecent).reverse();

  return {
    total_calls,
    by_outcome,
    by_sentiment,
    booked_count,
    booking_rate,
    avg_negotiation_rounds_when_negotiated,
    avg_agreed_rate_when_booked,
    recent,
  };
}
