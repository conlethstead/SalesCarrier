#!/usr/bin/env node
/**
 * Seed the metrics dashboard by POSTing diverse call events to POST /api/events.
 *
 * (GET /api/loads is read-only load search; it does not append dashboard rows.)
 *
 * Usage (from metrics-dashboard/):
 *   node scripts/seed-dashboard-events.mjs
 *   METRICS_SEED_BASE_URL=https://example.com API_KEY=secret node scripts/seed-dashboard-events.mjs
 *   node scripts/seed-dashboard-events.mjs --dry-run
 *
 * Loads metrics-dashboard/.env when present (API_KEY, optional METRICS_SEED_BASE_URL).
 *
 * Sends 30 distinct POST bodies (mixed envs, outcomes, load shapes, and field aliases).
 *
 * Booked rows (`booking_decision: "yes"`) always include `agreed_rate` (string or number).
 *
 * Dashboard "abandoned" outcome = omit booking_decision (not booking_decision "no" + abandoned flag).
 * All counteroffer fields are 0–3 (workflow never exceeds 3).
 */

import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, "..", ".env") });

const BASE_URL = "https://sales-w6cygkshra-uc.a.run.app/";
const API_KEY = process.env.API_KEY ?? "";

const dryRun = process.argv.includes("--dry-run");

/** ISO timestamp `daysAgo` days before now (UTC). */
function occurredDaysAgo(daysAgo, hourUTC = 15) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  d.setUTCHours(hourUTC, 32, 0, 0);
  return d.toISOString();
}

function baseLoad(overrides = {}) {
  return {
    load_id: "FDX10234",
    origin: "Los Angeles, CA",
    destination: "Dallas, TX",
    pickup_datetime: "2026-04-14T14:00:00.000Z",
    delivery_datetime: "2026-04-16T18:00:00.000Z",
    equipment_type: "Dry Van",
    commodity_type: "General Freight",
    loadboard_rate: 2500,
    miles: 1436,
    weight: 42000,
    num_of_pieces: 22,
    notes: "Seeded test load",
    dimensions: null,
    created_at: "2026-04-01T12:00:00.000Z",
    ...overrides,
  };
}

/**
 * @type {{ name: string; body: Record<string, unknown> }[]}
 */
const CASES = [
  {
    name: "booked — production, full load, positive sentiment",
    body: {
      environment: "production",
      reference_number: "FDX10234",
      mc_number: "MC-884421",
      booking_decision: "yes",
      call_duration: 420,
      counteroffers: 3,
      verified: true,
      carrier_name: "Acme Trucking LLC",
      sentiment_classification: "Positive",
      sentiment_reasoning: "Carrier confirmed interest and agreed to terms quickly.",
      trailer: "Dry Van",
      lane: "CA → TX",
      listed_rate: "$2,400",
      agreed_rate: "$2,500",
      how_load_was_found: "DAT",
      load: [baseLoad()],
      occurred_at: occurredDaysAgo(0, 10),
    },
  },
  {
    name: "declined — rate, neutral, string call_duration",
    body: {
      environment: "production",
      reference_number: "FDX10235",
      mc_number: "123456",
      booking_decision: "no",
      decline_reason: "Rate too low vs market",
      call_duration: "185",
      counteroffers: 3,
      verified: true,
      carrier_name: "Blue Highway Inc",
      sentiment_classification: "Neutral",
      sentiment_reasoning: "Professional tone; firm on minimum rate.",
      trailer: "Reefer",
      lane: "Chicago, IL → Atlanta, GA",
      listed_rate: "3100",
      agreed_rate: "",
      how_load_was_found: "Company load board",
      load: [
        baseLoad({
          load_id: "FDX10235",
          origin: "Chicago, IL",
          destination: "Atlanta, GA",
          equipment_type: "Reefer",
          commodity_type: "Produce",
          loadboard_rate: 3100,
          miles: 715,
        }),
      ],
      occurred_at: occurredDaysAgo(1, 14),
    },
  },
  {
    name: "failed verification — workflow-style empty strings, no load",
    body: {
      environment: "production",
      reference_number: "",
      mc_number: "",
      carrier_name: "",
      booking_decision: "no",
      decline_reason: "failed verification (no MC number)",
      call_duration: 25,
      counteroffers: "",
      load: "",
      abandoned: "",
      loading_error: "",
      agreed_rate: "",
      how_load_was_found: "",
      failed_verification: "yes",
      step_of_emotion: "",
      sentiment_classification: "Neutral",
      sentiment_reasoning: "Short informational exchange.",
      occurred_at: occurredDaysAgo(1, 18),
    },
  },
  {
    name: "abandoned — no booking_decision after counteroffers (true dashboard abandoned)",
    body: {
      environment: "staging",
      reference_number: "FDX10236",
      mc_number: 999888,
      call_duration: 540,
      counteroffers: 3,
      abandoned: "yes",
      carrier_name: "Quick Exit Logistics",
      sentiment_classification: "Negative",
      sentiment_reasoning: "Multiple rate rounds; caller went silent and never confirmed yes/no.",
      lane: "Denver, CO → Seattle, WA",
      load: [
        baseLoad({
          load_id: "FDX10236",
          origin: "Denver, CO",
          destination: "Seattle, WA",
          loadboard_rate: 2850,
          miles: 1305,
        }),
      ],
      occurred_at: occurredDaysAgo(2, 11),
    },
  },
  {
    name: "development env — legacy counteroffer field name",
    body: {
      environment: "development",
      reference_number: "FDX10237",
      mc_number: "MC-DEV-01",
      booking_decision: "no",
      decline_reason: "Equipment mismatch",
      call_duration: 240,
      number_of_counteroffers: 3,
      verified: "yes",
      carrier_name: "Dev Carrier Co",
      sentiment_classification: "neutral",
      trailer: "Flatbed",
      load: [
        baseLoad({
          load_id: "FDX10237",
          origin: "Houston, TX",
          destination: "Phoenix, AZ",
          equipment_type: "Flatbed",
          commodity_type: "Steel coils",
          loadboard_rate: 2800,
        }),
      ],
      occurred_at: occurredDaysAgo(3, 9),
    },
  },
  {
    name: "two loads on one call",
    body: {
      environment: "production",
      reference_number: "FDX10238",
      booking_decision: "no",
      decline_reason: "Chose different load from batch",
      call_duration: 512,
      counteroffers: 3,
      carrier_name: "Batch Review Transport",
      sentiment_classification: "Positive",
      sentiment_reasoning: "Engaged with options; polite decline.",
      load: [
        baseLoad({
          load_id: "FDX10238",
          origin: "Memphis, TN",
          destination: "Columbus, OH",
          loadboard_rate: 1900,
          miles: 540,
        }),
        baseLoad({
          load_id: "FDX10239",
          origin: "Memphis, TN",
          destination: "Indianapolis, IN",
          loadboard_rate: 1750,
          miles: 460,
          notes: "Second option same day pickup",
        }),
      ],
      occurred_at: occurredDaysAgo(4, 16),
    },
  },
  {
    name: "loading_error flag — no reference",
    body: {
      environment: "production",
      booking_decision: "no",
      decline_reason: "Could not retrieve load details",
      call_duration: 48,
      loading_error: "yes",
      failed_verification: "no",
      sentiment_classification: "Neutral",
      load: "",
      occurred_at: occurredDaysAgo(5, 13),
    },
  },
  {
    name: "omit load key entirely",
    body: {
      environment: "staging",
      mc_number: "5551234",
      booking_decision: "no",
      decline_reason: "Not interested in lane",
      call_duration: 120,
      carrier_name: "No Load Key Carriers",
      sentiment_classification: "Negative",
      occurred_at: occurredDaysAgo(6, 10),
    },
  },
  {
    name: "verified boolean false, step_of_emotion negotiation",
    body: {
      environment: "production",
      reference_number: "FDX10240",
      booking_decision: "no",
      call_duration: 300,
      verified: false,
      carrier_name: "Unverified Caller",
      step_of_emotion: "negotiation",
      sentiment_classification: "Negative",
      sentiment_reasoning: "Expressed impatience with hold time.",
      load: [baseLoad({ load_id: "FDX10240", loadboard_rate: 2200 })],
      occurred_at: occurredDaysAgo(7, 15),
    },
  },
  {
    name: "booked — staging, second winner, zero counteroffers",
    body: {
      environment: "staging",
      reference_number: "FDX10241",
      mc_number: "884422",
      booking_decision: "yes",
      call_duration: 198,
      counteroffers: 0,
      verified: true,
      carrier_name: "Northern Star Freight",
      sentiment_classification: "Positive",
      sentiment_reasoning: "Took first offer after lane match.",
      trailer: "Dry Van",
      lane: "Minneapolis, MN → Kansas City, MO",
      agreed_rate: "1925",
      load: [
        baseLoad({
          load_id: "FDX10241",
          origin: "Minneapolis, MN",
          destination: "Kansas City, MO",
          loadboard_rate: 1925,
          miles: 440,
        }),
      ],
      occurred_at: occurredDaysAgo(8, 8),
    },
  },
  {
    name: "booked — development, reefer, high miles",
    body: {
      environment: "development",
      reference_number: "FDX10242",
      mc_number: "MC-REE-99",
      booking_decision: "yes",
      call_duration: 610,
      counteroffers: 3,
      verified: "true",
      carrier_name: "Cold Chain Partners",
      sentiment_classification: "positive",
      sentiment_reasoning: "Detailed questions then committed.",
      trailer: "Reefer",
      lane: "Miami, FL → Boston, MA",
      listed_rate: "$4,100",
      agreed_rate: "$4,250",
      how_load_was_found: "Email blast",
      load: [
        baseLoad({
          load_id: "FDX10242",
          origin: "Miami, FL",
          destination: "Boston, MA",
          equipment_type: "Reefer",
          commodity_type: "Frozen food",
          loadboard_rate: 4250,
          miles: 1505,
          weight: 38000,
        }),
      ],
      occurred_at: occurredDaysAgo(9, 17),
    },
  },
  {
    name: "declined — driver unavailable",
    body: {
      environment: "production",
      reference_number: "FDX10243",
      mc_number: "771100",
      booking_decision: "no",
      decline_reason: "No driver available until next week",
      call_duration: 156,
      counteroffers: 3,
      carrier_name: "Weekend Gap Logistics",
      sentiment_classification: "Neutral",
      lane: "Nashville, TN → Charlotte, NC",
      load: [
        baseLoad({
          load_id: "FDX10243",
          origin: "Nashville, TN",
          destination: "Charlotte, NC",
          loadboard_rate: 1650,
          miles: 410,
        }),
      ],
      occurred_at: occurredDaysAgo(10, 12),
    },
  },
  {
    name: "declined — lane not a fit",
    body: {
      environment: "production",
      reference_number: "FDX10244",
      booking_decision: "no",
      decline_reason: "Does not run that lane",
      call_duration: 72,
      counteroffers: 1,
      carrier_name: "Regional Only Carriers",
      sentiment_classification: "Neutral",
      sentiment_reasoning: "Polite; prefers west coast only.",
      load: [baseLoad({ load_id: "FDX10244", origin: "Portland, OR", destination: "Boise, ID", loadboard_rate: 1400, miles: 430 })],
      occurred_at: occurredDaysAgo(10, 19),
    },
  },
  {
    name: "declined — already covered elsewhere",
    body: {
      environment: "staging",
      reference_number: "FDX10245",
      mc_number: "662233",
      booking_decision: "no",
      decline_reason: "Already booked with another broker",
      call_duration: 205,
      counteroffers: 2,
      carrier_name: "Double Booked LLC",
      sentiment_classification: "Negative",
      load: [baseLoad({ load_id: "FDX10245", origin: "St. Louis, MO", destination: "Detroit, MI", loadboard_rate: 2100, miles: 520 })],
      occurred_at: occurredDaysAgo(11, 9),
    },
  },
  {
    name: "negotiated — still declined",
    body: {
      environment: "production",
      reference_number: "FDX10246",
      booking_decision: "no",
      decline_reason: "Still below needed RPM after counters",
      call_duration: 890,
      counteroffers: 3,
      carrier_name: "Hard Negotiator Inc",
      sentiment_classification: "Neutral",
      sentiment_reasoning: "Long back-and-forth; ended professionally.",
      load: [baseLoad({ load_id: "FDX10246", loadboard_rate: 2400, miles: 1100 })],
      occurred_at: occurredDaysAgo(12, 14),
    },
  },
  {
    name: "long call — booked after many questions",
    body: {
      environment: "production",
      reference_number: "FDX10247",
      mc_number: "445566",
      booking_decision: "yes",
      call_duration: 1840,
      counteroffers: 3,
      verified: true,
      carrier_name: "Due Diligence Trucking",
      sentiment_classification: "Positive",
      sentiment_reasoning: "Asked about lumper, detention, and fuel surcharge.",
      listed_rate: "$1,350",
      agreed_rate: "$1,375",
      load: [baseLoad({ load_id: "FDX10247", origin: "Salt Lake City, UT", destination: "Las Vegas, NV", loadboard_rate: 1350, miles: 420 })],
      occurred_at: occurredDaysAgo(13, 11),
    },
  },
  {
    name: "camelCase sentiment fields",
    body: {
      environment: "staging",
      reference_number: "FDX10248",
      booking_decision: "no",
      decline_reason: "Need team drivers — not available",
      call_duration: 267,
      counteroffers: 3,
      sentimentClassification: "Negative",
      sentimentReasoning: "Frustrated that listing did not mention team required.",
      carrier_name: "Solo Only Express",
      load: [baseLoad({ load_id: "FDX10248", equipment_type: "Dry Van", commodity_type: "Retail", loadboard_rate: 3200, miles: 980 })],
      occurred_at: occurredDaysAgo(14, 10),
    },
  },
  {
    name: "counter_offers alias field",
    body: {
      environment: "production",
      reference_number: "FDX10249",
      booking_decision: "no",
      decline_reason: "Timing on pickup window",
      call_duration: 334,
      counter_offers: 3,
      carrier_name: "Alias Counter Test Co",
      sentiment_classification: "Neutral",
      load: [baseLoad({ load_id: "FDX10249", origin: "Omaha, NE", destination: "Oklahoma City, OK", loadboard_rate: 1550, miles: 455 })],
      occurred_at: occurredDaysAgo(14, 16),
    },
  },
  {
    name: "numberOfCounterOffers camelCase alias",
    body: {
      environment: "development",
      reference_number: "FDX10250",
      booking_decision: "no",
      decline_reason: "Fuel surcharge structure",
      call_duration: 290,
      numberOfCounterOffers: 3,
      carrier_name: "Camel Case Logistics",
      sentiment_classification: "Neutral",
      load: [baseLoad({ load_id: "FDX10250", loadboard_rate: 2680, miles: 890 })],
      occurred_at: occurredDaysAgo(15, 13),
    },
  },
  {
    name: "verified as numeric 1",
    body: {
      environment: "production",
      reference_number: "FDX10251",
      mc_number: "990011",
      booking_decision: "yes",
      call_duration: 355,
      counteroffers: 2,
      verified: 1,
      carrier_name: "Numeric Verified Trucking",
      sentiment_classification: "Positive",
      agreed_rate: "875",
      load: [baseLoad({ load_id: "FDX10251", origin: "Baltimore, MD", destination: "Richmond, VA", loadboard_rate: 875, miles: 185 })],
      occurred_at: occurredDaysAgo(16, 9),
    },
  },
  {
    name: "flatbed oversize — declined commodity",
    body: {
      environment: "staging",
      reference_number: "FDX10252",
      booking_decision: "no",
      decline_reason: "Does not haul oversize without permits in hand",
      call_duration: 412,
      counteroffers: 3,
      trailer: "Flatbed",
      carrier_name: "Permit Picky Haulers",
      sentiment_classification: "Neutral",
      load: [
        baseLoad({
          load_id: "FDX10252",
          equipment_type: "Flatbed",
          commodity_type: "Machinery (oversize)",
          loadboard_rate: 4500,
          miles: 620,
          notes: "Permits required — shipper arranging",
        }),
      ],
      occurred_at: occurredDaysAgo(17, 15),
    },
  },
  {
    name: "failed verification — but reference and load present",
    body: {
      environment: "production",
      reference_number: "FDX10253",
      booking_decision: "no",
      decline_reason: "MC could not be confirmed",
      call_duration: 140,
      counteroffers: 1,
      failed_verification: "yes",
      carrier_name: "Questionable MC Transport",
      sentiment_classification: "Negative",
      load: [baseLoad({ load_id: "FDX10253", loadboard_rate: 2000 })],
      occurred_at: occurredDaysAgo(18, 8),
    },
  },
  {
    name: "declined — disconnected after hold (booking_decision no)",
    body: {
      environment: "production",
      reference_number: "FDX10254",
      booking_decision: "no",
      decline_reason: "Line dropped during hold — treated as no booking",
      call_duration: 430,
      counteroffers: 3,
      carrier_name: "Hold Time Hangup LLC",
      sentiment_classification: "Negative",
      sentiment_reasoning: "Disconnected during long hold.",
      load: [baseLoad({ load_id: "FDX10254", loadboard_rate: 1755, miles: 500 })],
      occurred_at: occurredDaysAgo(19, 18),
    },
  },
  {
    name: "loading_error — with partial reference",
    body: {
      environment: "staging",
      reference_number: "FDX10255",
      booking_decision: "no",
      decline_reason: "System timeout pulling load",
      call_duration: 55,
      counteroffers: 1,
      loading_error: "yes",
      sentiment_classification: "Neutral",
      load: "",
      occurred_at: occurredDaysAgo(20, 12),
    },
  },
  {
    name: "step_of_emotion — calm positive (pitch)",
    body: {
      environment: "development",
      reference_number: "FDX10256",
      booking_decision: "yes",
      call_duration: 275,
      counteroffers: 1,
      verified: true,
      step_of_emotion: "pitch",
      carrier_name: "Calm Closers Inc",
      sentiment_classification: "Positive",
      agreed_rate: "$1,200",
      load: [baseLoad({ load_id: "FDX10256", origin: "Tucson, AZ", destination: "El Paso, TX", loadboard_rate: 1200, miles: 315 })],
      occurred_at: occurredDaysAgo(21, 14),
    },
  },
  {
    name: "optional load fields omitted (weight, num_of_pieces)",
    body: {
      environment: "production",
      reference_number: "FDX10257",
      booking_decision: "no",
      decline_reason: "Need weight confirmation from shipper",
      call_duration: 188,
      counteroffers: 3,
      carrier_name: "Detail Oriented Carriers",
      sentiment_classification: "Neutral",
      load: [
        (() => {
          const row = baseLoad({ load_id: "FDX10257", loadboard_rate: 2300, miles: 700 });
          delete row.weight;
          delete row.num_of_pieces;
          return row;
        })(),
      ],
      occurred_at: occurredDaysAgo(22, 11),
    },
  },
  {
    name: "listed_rate only — no agreed_rate",
    body: {
      environment: "production",
      reference_number: "FDX10258",
      booking_decision: "no",
      decline_reason: "Listed rate non-negotiable for them",
      call_duration: 142,
      counteroffers: 2,
      listed_rate: "$1,875 all-in",
      carrier_name: "Take It Or Leave It Trucking",
      sentiment_classification: "Neutral",
      load: [baseLoad({ load_id: "FDX10258", loadboard_rate: 1875, miles: 405 })],
      occurred_at: occurredDaysAgo(23, 16),
    },
  },
  {
    name: "how_load_was_found — referral",
    body: {
      environment: "staging",
      reference_number: "FDX10259",
      mc_number: "334455",
      booking_decision: "yes",
      call_duration: 320,
      counteroffers: 1,
      verified: true,
      how_load_was_found: "Referral from another carrier",
      carrier_name: "Network Effect Logistics",
      sentiment_classification: "Positive",
      agreed_rate: "1425",
      load: [baseLoad({ load_id: "FDX10259", origin: "Little Rock, AR", destination: "Jackson, MS", loadboard_rate: 1425, miles: 305 })],
      occurred_at: occurredDaysAgo(24, 9),
    },
  },
  {
    name: "broker policy — declined",
    body: {
      environment: "production",
      reference_number: "FDX10260",
      booking_decision: "no",
      decline_reason: "Does not sign broker quick-pay terms",
      call_duration: 226,
      counteroffers: 3,
      carrier_name: "Policy First Transport",
      sentiment_classification: "Negative",
      load: [baseLoad({ load_id: "FDX10260", loadboard_rate: 2600, miles: 720 })],
      occurred_at: occurredDaysAgo(25, 13),
    },
  },
  {
    name: "quick win — booked under 90s",
    body: {
      environment: "production",
      reference_number: "FDX10261",
      mc_number: "778899",
      booking_decision: "yes",
      call_duration: 84,
      counteroffers: 0,
      verified: true,
      carrier_name: "Speed Close Carriers",
      sentiment_classification: "Positive",
      sentiment_reasoning: "Knew the lane; minimal questions.",
      agreed_rate: "$950",
      load: [baseLoad({ load_id: "FDX10261", origin: "Spokane, WA", destination: "Seattle, WA", loadboard_rate: 950, miles: 280 })],
      occurred_at: occurredDaysAgo(26, 7),
    },
  },
];

async function postEvent(name, body) {
  const url = `${BASE_URL}/api/events`;
  if (dryRun) {
    console.log(`[dry-run] ${name}`);
    console.log(JSON.stringify(body, null, 2));
    console.log("");
    return { ok: true, status: 0, name };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-API-Key": API_KEY,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    console.error(`FAIL ${name} → ${res.status}`, json);
    return { ok: false, status: res.status, name, detail: json };
  }

  console.log(`OK   ${name} → ${res.status}`);
  return { ok: true, status: res.status, name };
}

async function main() {
  if (!dryRun && !API_KEY) {
    console.error("API_KEY is missing. Set it in .env or the environment.");
    process.exit(1);
  }

  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Cases:    ${CASES.length}${dryRun ? " (dry-run)" : ""}\n`);

  const results = [];
  for (const { name, body } of CASES) {
    results.push(await postEvent(name, body));
    if (!dryRun) {
      await new Promise((r) => setTimeout(r, 120));
    }
  }

  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    console.error(`\n${failed.length} request(s) failed.`);
    process.exit(1);
  }

  console.log(`\nDone. Refresh the dashboard (filter by All environments to see staging/dev rows).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
