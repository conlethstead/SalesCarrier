import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { CallEventRecord, RecentCallEntry, SupabaseLoadRow } from "../shared/metrics.js";
import { isLegacyRecord } from "../shared/metrics.js";

let client: SupabaseClient | null | undefined;

/** Same convention as GET /api/loads (e.g. FDX10234). */
export const LOAD_ID_PATTERN = /^[A-Z]{3}\d{5}$/;

export function getSupabaseForLoads(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  if (client === undefined) {
    client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return client;
}

/** Strip LIKE wildcards so query params cannot broaden matches unexpectedly. */
export function sanitizeLikeFragment(s: string): string {
  return s.replace(/[%_\\]/g, "");
}

/** Lowercase full US state / DC names → USPS abbreviation (also used to validate 2-letter codes). */
const US_STATE_NAME_TO_ABBREV: Record<string, string> = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
  "district of columbia": "DC",
};

/** Canadian provinces / territories (English), lowercase keys → postal abbreviation. */
const CANADA_PROVINCE_NAME_TO_ABBREV: Record<string, string> = {
  alberta: "AB",
  "british columbia": "BC",
  manitoba: "MB",
  "new brunswick": "NB",
  "newfoundland and labrador": "NL",
  newfoundland: "NL",
  "northwest territories": "NT",
  "nova scotia": "NS",
  nunavut: "NU",
  ontario: "ON",
  "prince edward island": "PE",
  quebec: "QC",
  québec: "QC",
  saskatchewan: "SK",
  yukon: "YT",
};

/** US states + DC + Canadian provinces; used for "City, Region" and trailing "City Region" speech. */
const REGION_NAME_TO_ABBREV: Record<string, string> = {
  ...US_STATE_NAME_TO_ABBREV,
  ...CANADA_PROVINCE_NAME_TO_ABBREV,
};

const REGION_ABBREVS = new Set(Object.values(REGION_NAME_TO_ABBREV));

/** Longest names first so e.g. "british columbia" wins over "columbia". */
const REGION_NAMES_BY_LENGTH = Object.keys(REGION_NAME_TO_ABBREV).sort((a, b) => b.length - a.length);

function normalizeSpaceSeparatedCityRegion(fragment: string): string | null {
  const t = sanitizeLikeFragment(fragment.trim());
  if (!t) return null;
  const lower = t.toLowerCase();
  for (const key of REGION_NAMES_BY_LENGTH) {
    const trailing = ` ${key}`;
    if (!lower.endsWith(trailing)) continue;
    const cityRaw = t.slice(0, t.length - trailing.length).trim();
    if (!cityRaw) continue;
    return `${sanitizeLikeFragment(cityRaw)}, ${REGION_NAME_TO_ABBREV[key]}`;
  }
  return null;
}

/**
 * Canonical "City, ST" when the trailing region is a US/CA name or valid 2-letter code;
 * also understands spoken form without a comma (e.g. "Toronto Ontario" → "Toronto, ON").
 * Otherwise returns the sanitized fragment unchanged.
 */
export function normalizeLocationFragment(fragment: string): string {
  const t = sanitizeLikeFragment(fragment.trim());
  if (!t) return t;
  const comma = t.indexOf(",");
  if (comma >= 0) {
    const city = t.slice(0, comma).trim();
    const statePartRaw = t.slice(comma + 1).trim().replace(/\.$/, "");
    if (!city || !statePartRaw) return t;

    if (/^[A-Za-z]{2}$/.test(statePartRaw)) {
      const u = statePartRaw.toUpperCase();
      if (REGION_ABBREVS.has(u)) {
        return `${city}, ${u}`;
      }
      return t;
    }

    const lower = statePartRaw.toLowerCase();
    const abbr =
      REGION_NAME_TO_ABBREV[lower] ?? REGION_NAME_TO_ABBREV[lower.replace(/\./g, "")];
    if (abbr) {
      return `${city}, ${abbr}`;
    }
    return t;
  }

  const spaceForm = normalizeSpaceSeparatedCityRegion(t);
  return spaceForm ?? t;
}

/**
 * First segment before a comma (typically city). Broad fallback when stored locations use
 * unexpected formatting.
 */
export function primaryLocationToken(fragment: string): string {
  const t = sanitizeLikeFragment(fragment.trim());
  if (!t) return t;
  const comma = t.indexOf(",");
  const core = comma >= 0 ? t.slice(0, comma).trim() : t;
  return sanitizeLikeFragment(core);
}

/** Ordered ILIKE patterns for origin/destination pair search (narrow → broad). */
export function pairLaneSearchPatterns(origin: string, dest: string): { origin: string; dest: string }[] {
  const normO = normalizeLocationFragment(origin);
  const normD = normalizeLocationFragment(dest);
  const cityO = primaryLocationToken(origin) || origin;
  const cityD = primaryLocationToken(dest) || dest;
  const out: { origin: string; dest: string }[] = [];
  const seen = new Set<string>();
  const push = (o: string, d: string) => {
    if (!o || !d) return;
    const key = `${o}\0${d}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ origin: o, dest: d });
  };
  push(normO, normD);
  push(origin, dest);
  push(cityO, cityD);
  return out;
}

/**
 * Split a lane string into origin/destination fragments when separators are present
 * (e.g. "Chicago, IL to Dallas, TX", "Atlanta → Miami").
 * Otherwise returns a single fuzzy string matched in app code against origin/destination.
 */
export function parseLaneFragments(
  lane: string
): { kind: "pair"; origin: string; dest: string } | { kind: "fuzzy"; text: string } {
  const trimmed = lane.trim();
  if (!trimmed) return { kind: "fuzzy", text: "" };

  const tryPair = (a: string, b: string): { origin: string; dest: string } | null => {
    const o = sanitizeLikeFragment(a.trim());
    const d = sanitizeLikeFragment(b.trim());
    return o && d ? { origin: o, dest: d } : null;
  };

  const byTo = trimmed.split(/\s+to\s+/i);
  if (byTo.length >= 2) {
    const p = tryPair(byTo[0], byTo.slice(1).join(" to "));
    if (p) return { kind: "pair", ...p };
  }

  const byArrow = trimmed.split(/\s*(?:→|->)\s*/);
  if (byArrow.length >= 2) {
    const p = tryPair(byArrow[0], byArrow.slice(1).join(" -> "));
    if (p) return { kind: "pair", ...p };
  }

  const byPipe = trimmed.split(/\s*\|\s*/);
  if (byPipe.length >= 2) {
    const p = tryPair(byPipe[0], byPipe.slice(1).join(" | "));
    if (p) return { kind: "pair", ...p };
  }

  const bySpacedDash = trimmed.split(/\s+-\s+/);
  if (bySpacedDash.length >= 2) {
    const p = tryPair(bySpacedDash[0], bySpacedDash.slice(1).join(" - "));
    if (p) return { kind: "pair", ...p };
  }

  return { kind: "fuzzy", text: sanitizeLikeFragment(trimmed) };
}

export function laneMatchesRow(
  row: { origin: string; destination: string },
  fuzzy: string
): boolean {
  if (!fuzzy) return false;
  const hay = `${row.origin} ${row.destination}`.toLowerCase();
  const needle = fuzzy.toLowerCase();
  return hay.includes(needle);
}

function loadIdForEvent(e: CallEventRecord): string | null {
  const raw = isLegacyRecord(e) ? e.load_id?.trim() || "" : e.reference_number.trim();
  return normalizeLoadId(raw);
}

function normalizeLoadId(id: string): string | null {
  const normalized = id.trim().toUpperCase();
  return LOAD_ID_PATTERN.test(normalized) ? normalized : null;
}

function embeddedLoadForEvent(e: CallEventRecord): SupabaseLoadRow | null {
  if (isLegacyRecord(e)) return null;
  if (!Array.isArray(e.load) || e.load.length === 0) return null;
  const eventId = loadIdForEvent(e);
  if (!eventId) return null;
  for (const row of e.load) {
    const id = normalizeLoadId(row.load_id);
    if (id === eventId) return row;
  }
  return null;
}

/** Map recent events to rows with load data from the workflow payload only (`load[]`). */
export function buildRecentCallEntries(recent: CallEventRecord[]): RecentCallEntry[] {
  return recent.map((event) => ({
    event,
    load: embeddedLoadForEvent(event),
  }));
}
