/** Payload POSTed by your workflow / middleware after each call (or batched). */
export type CallOutcome =
  | "booked"
  | "declined"
  | "no_match"
  | "failed_verification"
  | "abandoned"
  | "negotiated_no_deal";

export type CarrierSentiment = "positive" | "neutral" | "negative";

export interface CallEventPayload {
  call_id: string;
  /** ISO 8601; defaults to server receive time if omitted */
  occurred_at?: string;
  outcome: CallOutcome;
  sentiment: CarrierSentiment;
  load_id?: string;
  /** Agreed linehaul in USD when outcome is booked or negotiated */
  agreed_rate?: number;
  /** Opening or listed rate for comparison */
  listed_rate?: number;
  negotiation_rounds?: number;
  /** Optional free text; keep short for dashboard */
  notes?: string;
}

export interface CallEventRecord extends CallEventPayload {
  received_at: string;
}

export interface MetricsSummary {
  total_calls: number;
  by_outcome: Record<CallOutcome, number>;
  by_sentiment: Record<CarrierSentiment, number>;
  booked_count: number;
  booking_rate: number;
  avg_negotiation_rounds_when_negotiated: number | null;
  avg_agreed_rate_when_booked: number | null;
  recent: CallEventRecord[];
}
