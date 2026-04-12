/** Ingest body for POST /api/events — only reference_number is required. */
export interface CallEventPayload {
  reference_number: string;
  mc_number?: string;
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

export interface MetricsSummary {
  total_calls: number;
  by_outcome: Record<CallOutcome, number>;
  by_sentiment: Record<CarrierSentiment, number>;
  booked_count: number;
  booking_rate: number;
  avg_agreed_rate_when_booked: number | null;
  avg_negotiation_rounds_when_negotiated: number | null;
  avg_call_duration_seconds: number | null;
  recent: CallEventRecord[];
}
