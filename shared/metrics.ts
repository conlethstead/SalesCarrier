/** Row from `public.loads` as returned by the metrics API (Supabase). */
export interface SupabaseLoadRow {
  load_id: string;
  origin: string;
  destination: string;
  pickup_datetime: string;
  delivery_datetime: string;
  equipment_type: string;
  loadboard_rate: number;
  notes?: string | null;
  weight?: number | null;
  commodity_type: string;
  num_of_pieces?: number | null;
  miles?: number | null;
  dimensions?: string | null;
  created_at: string;
}

/** Ingest body for POST /api/events. */
export interface CallEventPayload {
  reference_number?: string;
  mc_number?: string | number;
  /** "yes" = agreed to book, "no" = did not */
  booking_decision?: "yes" | "no";
  /** When booking_decision is "no", optional reason (leave empty when "yes") */
  decline_reason?: string;
  /** Call length in seconds */
  call_duration?: number;
  /** How many times the assistant sent a counteroffer (aliases normalized at ingest) */
  counteroffers?: number;
  /**
   * Legacy name for `counteroffers`; may still appear on rows written before the rename.
   * Not set by new ingest — use `counteroffers`.
   */
  number_of_counteroffers?: number;
  /** Whether the carrier was verified via MC */
  verified?: boolean;
  /** Carrier legal name from verification */
  carrier_name?: string;
  /** High-level sentiment / outcome label from the assistant (e.g. "Not interested") */
  sentiment_classification?: string;
  /** Short explanation for the classification */
  sentiment_reasoning?: string;
  /** Equipment (e.g. "Dry Van") */
  trailer?: string;
  /** Lane description (e.g. "California to Texas") */
  lane?: string;
  /** Listed or agreed rate as provided by the workflow (often free text) */
  listed_rate?: string;
  /** How the carrier found the load */
  how_load_was_found?: string;
  /** Final negotiated rate from workflow as text (e.g. "", "2050", "$2,050"); stored before `load` */
  agreed_rate?: string;
  /** Workflow flags (often "yes" / "no" strings; placeholders like `<response.*>` ignored for analytics). */
  abandoned?: string;
  failed_verification?: string;
  loading_error?: string;
  step_of_emotion?: string;
  /** Optional load row(s) returned by workflow from DB search. */
  load?: SupabaseLoadRow[];
  /** ISO 8601; defaults to server receive time if omitted */
  occurred_at?: string;
}

/** Counteroffer count for analytics/UI — prefers `counteroffers`, then legacy `number_of_counteroffers`. */
export function counterofferCount(e: CallEventPayload): number | undefined {
  if (e.counteroffers != null) return e.counteroffers;
  if (e.number_of_counteroffers != null) return e.number_of_counteroffers;
  return undefined;
}

export type CallOutcome =
  | "booked"
  | "declined"
  | "no_match"
  | "failed_verification"
  | "abandoned"
  | "negotiated_no_deal";

export type CarrierSentiment = "positive" | "neutral" | "negative";

/**
 * Map workflow `sentiment_classification` (free text) into analytics buckets.
 * Explicit "positive" / "neutral" / "negative" labels are honored; otherwise uses light heuristics.
 */
export function sentimentFromWorkflowPayload(e: CallEventPayload): CarrierSentiment {
  const raw =
    e.sentiment_classification?.trim() ??
    (e as { sentimentClassification?: string }).sentimentClassification?.trim() ??
    "";
  if (!raw) return "neutral";

  const lower = raw.toLowerCase();
  if (lower === "positive" || lower === "negative" || lower === "neutral") {
    return lower;
  }

  if (/\bnot\s+interested\b/.test(lower)) return "negative";
  if (/\b(disinterested|uninterested)\b/.test(lower)) return "negative";

  if (
    /hostile|frustrat|angr(y|ed)|upset|dissatisf|unhappy|\bnegative\b|refus|reject/.test(lower)
  ) {
    return "negative";
  }

  if (
    /\binterested\b|enthusiast|cooperative|\bengaged\b|satisfi|\bpositive\b|\bhappy\b|\beager\b/.test(
      lower
    )
  ) {
    return "positive";
  }

  return "neutral";
}

/** Legacy rows stored before the schema change (still counted in summaries). */
export interface LegacyCallEvent {
  call_id: string;
  occurred_at?: string;
  outcome: CallOutcome;
  sentiment: CarrierSentiment;
  load_id?: string;
  agreed_rate?: number;
  listed_rate?: number;
  negotiation_rounds?: number;
  notes?: string;
}

export type CallEventRecord =
  | (CallEventPayload & { received_at: string; occurred_at: string })
  | (LegacyCallEvent & { received_at: string; occurred_at: string });

export function isLegacyRecord(
  r: CallEventRecord
): r is LegacyCallEvent & { received_at: string; occurred_at: string } {
  return "call_id" in r && typeof (r as LegacyCallEvent).call_id === "string";
}

/** HappyRobot-style template placeholders are not real values. */
export function isWorkflowPlaceholder(s: string): boolean {
  const t = s.trim();
  return t.startsWith("<") && t.includes(">");
}

/** True for yes/true/1 (strings case-insensitive); false for empty or placeholders. */
export function isAffirmativeWorkflowField(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v === 1;
  const s = String(v).trim();
  if (!s || isWorkflowPlaceholder(s)) return false;
  const lower = s.toLowerCase();
  return lower === "yes" || lower === "true" || lower === "1" || lower === "y";
}

/** Parse currency-like text ($2,050, 2050); returns null if missing or not numeric. */
export function parseCurrencyNumber(raw: string | undefined | null): number | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s || isWorkflowPlaceholder(s)) return null;
  const cleaned = s.replace(/[$,\s]/g, "");
  const n = Number.parseFloat(cleaned);
  if (Number.isNaN(n)) return null;
  return n;
}

/** One recent call plus optional load row from the workflow `load[]` payload. */
export interface RecentCallEntry {
  event: CallEventRecord;
  load: SupabaseLoadRow | null;
}

/** Summary before attaching workflow `load[]` to `recent` for the API response. */
export interface MetricsSummaryComputed {
  total_calls: number;
  by_outcome: Record<CallOutcome, number>;
  by_sentiment: Record<CarrierSentiment, number>;
  booked_count: number;
  booking_rate: number;
  /** Average (listed − agreed) in dollars for booked calls with both values; listed from loadboard or `listed_rate`. */
  avg_listed_minus_agreed_when_booked: number | null;
  failed_verification_yes_count: number;
  failed_verification_rate: number;
  loading_error_yes_count: number;
  loading_error_rate: number;
  top_step_emotion: string | null;
  top_step_emotion_count: number;
  /** Mean counteroffers per call; missing/`undefined` counteroffers count as 0. */
  avg_counteroffers_per_call: number | null;
  avg_call_duration_seconds: number | null;
  recent: CallEventRecord[];
}

export interface MetricsSummary extends Omit<MetricsSummaryComputed, "recent"> {
  recent: RecentCallEntry[];
}
