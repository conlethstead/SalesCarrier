import fs from "node:fs";
import path from "node:path";
import type {
  CallEventPayload,
  CallEventRecord,
  CallOutcome,
  CarrierSentiment,
  MetricsSummaryComputed,
} from "../shared/metrics.js";
import {
  counterofferCount,
  isAffirmativeWorkflowField,
  isLegacyRecord,
  isWorkflowPlaceholder,
  parseCurrencyNumber,
  sentimentFromWorkflowPayload,
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

const CSV_HEADER = "received_at,occurred_at,record_json";

function dataDir(): string {
  return process.env.DATA_DIR ?? path.join(process.cwd(), "data");
}

function csvPath(): string {
  return path.join(dataDir(), "events.csv");
}

function jsonPathLegacy(): string {
  return path.join(dataDir(), "events.json");
}

function ensureDir(file: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

function escapeCsvField(s: string): string {
  const t = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (/[",\n]/.test(t)) {
    return `"${t.replace(/"/g, '""')}"`;
  }
  return t;
}

function formatStorageRow(e: CallEventRecord): string {
  const json = JSON.stringify(e);
  return [e.received_at, e.occurred_at ?? "", json].map(escapeCsvField).join(",");
}

function parseCsvRow(line: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      i++;
      let cell = "";
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') {
          cell += '"';
          i += 2;
        } else if (line[i] === '"') {
          i++;
          break;
        } else {
          cell += line[i++];
        }
      }
      out.push(cell);
      if (line[i] === ",") i++;
    } else {
      const next = line.indexOf(",", i);
      if (next === -1) {
        out.push(line.slice(i));
        break;
      }
      out.push(line.slice(i, next));
      i = next + 1;
    }
  }
  return out;
}

function migrateJsonToCsvIfNeeded() {
  const csvFile = csvPath();
  const jsonFile = jsonPathLegacy();
  if (fs.existsSync(csvFile) || !fs.existsSync(jsonFile)) return;
  try {
    const raw = fs.readFileSync(jsonFile, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return;
    const events = parsed as CallEventRecord[];
    ensureDir(csvFile);
    const lines = [CSV_HEADER, ...events.map((e) => formatStorageRow(e))];
    fs.writeFileSync(csvFile, lines.join("\n") + "\n", "utf-8");
    const bak = path.join(dataDir(), "events.json.migrated");
    fs.renameSync(jsonFile, bak);
    console.info(`Migrated ${events.length} event(s) from events.json to events.csv (${bak}).`);
  } catch (e) {
    console.error("events.json migration failed:", e);
  }
}

export function loadEvents(): CallEventRecord[] {
  migrateJsonToCsvIfNeeded();
  const file = csvPath();
  if (!fs.existsSync(file)) return [];
  try {
    const raw = fs.readFileSync(file, "utf-8");
    const lines = raw.split(/\n/).map((l) => l.replace(/\r$/, "")).filter((l) => l.length > 0);
    if (lines.length === 0) return [];
    const start = lines[0].startsWith("received_at") ? 1 : 0;
    const out: CallEventRecord[] = [];
    for (let i = start; i < lines.length; i++) {
      const cols = parseCsvRow(lines[i]);
      if (cols.length < 3) continue;
      try {
        out.push(JSON.parse(cols[2]) as CallEventRecord);
      } catch {
        /* skip malformed line */
      }
    }
    return out;
  } catch {
    return [];
  }
}

function appendCsvRow(record: CallEventRecord) {
  const file = csvPath();
  ensureDir(file);
  const line = `${formatStorageRow(record)}\n`;
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, `${CSV_HEADER}\n${line}`, "utf-8");
  } else {
    fs.appendFileSync(file, line, "utf-8");
  }
}

export function appendEvent(payload: CallEventPayload): CallEventRecord {
  const record: CallEventRecord = {
    ...payload,
    received_at: new Date().toISOString(),
    occurred_at: payload.occurred_at ?? new Date().toISOString(),
  };
  appendCsvRow(record);
  return record;
}

export function computeSummary(limitRecent = 50): MetricsSummaryComputed {
  const events = loadEvents();
  const by_outcome = Object.fromEntries(
    OUTCOMES.map((o) => [o, 0])
  ) as Record<CallOutcome, number>;
  const by_sentiment = Object.fromEntries(
    SENTIMENTS.map((s) => [s, 0])
  ) as Record<CarrierSentiment, number>;

  for (const e of events) {
    if (isLegacyRecord(e)) {
      if (by_outcome[e.outcome] !== undefined) by_outcome[e.outcome]++;
      if (by_sentiment[e.sentiment] !== undefined) by_sentiment[e.sentiment]++;
    } else {
      if (e.booking_decision === "yes") by_outcome.booked++;
      else if (e.booking_decision === "no") {
        const n = counterofferCount(e);
        if (n != null && n > 0) by_outcome.negotiated_no_deal++;
        else by_outcome.declined++;
      } else by_outcome.abandoned++;
      by_sentiment[sentimentFromWorkflowPayload(e)]++;
    }
  }

  const booked_count = by_outcome.booked;
  const total_calls = events.length;
  const booking_rate = total_calls ? booked_count / total_calls : 0;

  let counterofferSum = 0;
  for (const e of events) {
    if (isLegacyRecord(e)) {
      const n = e.negotiation_rounds;
      counterofferSum += n != null && Number.isFinite(n) ? n : 0;
    } else {
      counterofferSum += counterofferCount(e) ?? 0;
    }
  }
  const avg_counteroffers_per_call =
    events.length === 0 ? null : counterofferSum / events.length;

  const rateDiffs: number[] = [];
  let failed_verification_yes_count = 0;
  let loading_error_yes_count = 0;
  const stepEmotionCounts = new Map<string, number>();

  for (const e of events) {
    if (isLegacyRecord(e)) {
      if (
        e.outcome === "booked" &&
        e.listed_rate != null &&
        e.agreed_rate != null &&
        Number.isFinite(e.listed_rate) &&
        Number.isFinite(e.agreed_rate)
      ) {
        rateDiffs.push(e.listed_rate - e.agreed_rate);
      }
    } else {
      if (isAffirmativeWorkflowField(e.failed_verification)) failed_verification_yes_count++;
      if (isAffirmativeWorkflowField(e.loading_error)) loading_error_yes_count++;
      const step = e.step_of_emotion?.trim();
      if (step && !isWorkflowPlaceholder(step)) {
        stepEmotionCounts.set(step, (stepEmotionCounts.get(step) ?? 0) + 1);
      }
      if (e.booking_decision === "yes") {
        const listed = e.load?.[0]?.loadboard_rate ?? parseCurrencyNumber(e.listed_rate ?? null);
        const agreed = parseCurrencyNumber(e.agreed_rate ?? null);
        if (listed != null && agreed != null) rateDiffs.push(listed - agreed);
      }
    }
  }

  const avg_listed_minus_agreed_when_booked =
    rateDiffs.length === 0 ? null : rateDiffs.reduce((a, b) => a + b, 0) / rateDiffs.length;

  let top_step_emotion: string | null = null;
  let top_step_emotion_count = 0;
  for (const [k, c] of stepEmotionCounts) {
    if (
      c > top_step_emotion_count ||
      (c === top_step_emotion_count && (top_step_emotion === null || k < top_step_emotion))
    ) {
      top_step_emotion = k;
      top_step_emotion_count = c;
    }
  }

  const failed_verification_rate = total_calls ? failed_verification_yes_count / total_calls : 0;
  const loading_error_rate = total_calls ? loading_error_yes_count / total_calls : 0;

  const durations: number[] = [];
  for (const e of events) {
    if (!isLegacyRecord(e) && e.call_duration != null && e.call_duration >= 0) {
      durations.push(e.call_duration);
    }
  }
  const avg_call_duration_seconds =
    durations.length === 0 ? null : durations.reduce((a, b) => a + b, 0) / durations.length;

  const recent = [...events].slice(-limitRecent).reverse();

  return {
    total_calls,
    by_outcome,
    by_sentiment,
    booked_count,
    booking_rate,
    avg_listed_minus_agreed_when_booked,
    failed_verification_yes_count,
    failed_verification_rate,
    loading_error_yes_count,
    loading_error_rate,
    top_step_emotion,
    top_step_emotion_count,
    avg_counteroffers_per_call,
    avg_call_duration_seconds,
    recent,
  };
}
