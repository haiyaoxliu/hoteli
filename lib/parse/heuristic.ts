import * as chrono from "chrono-node";
import * as cheerio from "cheerio";
import type { ParsedStay } from "./extract";
import type { ParseInput } from "./extract";

/**
 * Deterministic (non-LLM) extraction of a hotel stay from a confirmation email.
 * Returns the same ParsedStay shape as the LLM parser so it's a drop-in.
 *
 * Strategy: a promo-vs-confirmation gate, then generic field extractors with
 * light per-channel tuning. Coverage is intentionally partial — clean OTA/hotel
 * confirmations parse well; messy ones come back incomplete (for review) or
 * gated out as marketing.
 */

type Channel = ParsedStay["channel"];

// ---- channel ----------------------------------------------------------------

function detectChannel(from = ""): Channel {
  const f = from.toLowerCase();
  if (/airbnb/.test(f)) return "airbnb";
  if (/booking\.com/.test(f)) return "booking";
  if (/expedia/.test(f)) return "expedia";
  if (/hotels\.com/.test(f)) return "hotels";
  if (/(marriott|hilton|hyatt|ihg|accor|radisson|wyndham|bestwestern|choicehotels)/.test(f))
    return "direct";
  return null;
}

/** Vacation rentals: the "name" is a listing title that won't geocode. */
export function isRentalChannel(c: Channel): boolean {
  return c === "airbnb";
}

// ---- gate -------------------------------------------------------------------

const PROMO =
  /(\d+\s*%\s*off|% off|\bdeals?\b|\bsale\b|\bsave\b|discount|coupon|\bwin\b|sweepstake|newsletter|last call|best price|lowest price|for less|members? save|\bexplore\b|\bdiscover\b|inspir|adventure|just what you need|offers? for you|points? expire|don'?t miss|\bup to\b|prices? start|you'?ll love|made easy)/i;

const POSITIVE =
  /\b(confirmed|confirmation|your (?:reservation|booking|stay|trip)|reservation (?:for|confirmed|reminder)|booking (?:confirmed|confirmation|reference)|itinerary|you'?re going|trip to|checks? in|check[- ]in details|upcoming (?:stay|reservation|trip))\b/i;

const RES_HINT = /\b(reservation|booking|stay|trip|itinerary)\b/i;

// A lodging-specific signal — distinguishes hotel confirmations from generic
// "order/registration/payment confirmed" emails that also have dates. Kept
// strict on purpose: weak words like bare "room"/"property" leak SAT/event
// confirmations into the queue, so they're excluded.
const LODGING =
  /\b(hotels?|motels?|resorts?|inn|lodge|hostel|guest\s?house|b\s?&\s?b|bed and breakfast|nights? stay|\d+\s+nights?|check[\s-]?in|check[\s-]?out|reservation at|your stay|king (?:room|bed)|queen (?:room|bed)|airbnb|vrbo)\b/i;

// Unambiguous lodging terms — when present, keep the email even if it also
// trips an exclusion (e.g. "hotel near the airport").
const STRONG_LODGING =
  /\b(hotels?|motels?|resorts?|inn|lodge|hostel|guest\s?house|airbnb|vrbo|bed and breakfast)\b/i;

// Non-lodging confirmation categories that otherwise look similar (flights trip
// "check in", universities/orders trip "confirmation" + dates).
const EXCLUDE =
  /\b(flights?|airlines?|air lines|boarding pass|check in for your flight|university|college|campus|admission|\bsat\b|\bact\b|exam|tuition|webinar|seminar|marathon|\b5k\b|run & walk|\brace\b|open house|campus tour|order\s*#|invoice|subscription)\b/i;

function isLikelyConfirmation(
  subject: string,
  body: string,
  hasDate: boolean,
  hasConf: boolean,
  lodging: boolean,
): boolean {
  const strong = STRONG_LODGING.test(subject) || STRONG_LODGING.test(body.slice(0, 1000));
  if (!strong && (EXCLUDE.test(subject) || EXCLUDE.test(body.slice(0, 300)))) return false;
  if (!lodging) return false; // must be lodging-related, not any confirmation
  const promo = PROMO.test(subject) || PROMO.test(body.slice(0, 300));
  const positive = POSITIVE.test(subject) || POSITIVE.test(body.slice(0, 2000));
  if (promo && !positive) return false; // marketing
  if (positive) return true;
  if (RES_HINT.test(subject) && hasDate) return true;
  if (hasDate && hasConf) return true;
  return false;
}

// ---- helpers ----------------------------------------------------------------

function cleanSubject(s = ""): string {
  return s.replace(/^(re|fwd?):\s*/i, "").trim();
}

/** Collapse HTML to readable text via cheerio (drops scripts/styles). */
function htmlToText(html: string): string {
  try {
    const $ = cheerio.load(html);
    $("script, style, head").remove();
    return $("body").text().replace(/\s+/g, " ").trim();
  } catch {
    return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
}

function isoFromComponent(c: chrono.ParsedComponents | null | undefined): string | null {
  if (!c) return null;
  const y = c.get("year");
  const m = c.get("month");
  const d = c.get("day");
  if (y == null || m == null || d == null) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// A single, unambiguous date token. We parse ONLY this matched substring with
// chrono — never a wide window — so collapsed whitespace like "...2026   June
// 21..." can't be misread as a stray range/year (the bug that logged 2021).
const MONTH = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?";
const WEEKDAY = "(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\\s*";
const DATE_TOKEN = new RegExp(
  [
    `(?:${WEEKDAY})?${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s*\\d{4}`, // June 19, 2026 / Jun 19th, 2026
    `(?:${WEEKDAY})?\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH}\\s*,?\\s*\\d{4}`, // 19 June 2026
    `\\d{4}-\\d{2}-\\d{2}`, // 2026-06-19
    `\\d{1,2}[/]\\d{1,2}[/]\\d{2,4}`, // 06/19/2026
  ].join("|"),
  "i",
);

/**
 * Find the first labeled date: scan every label occurrence, and for each, pull
 * the clean date token that follows and parse just that. Returns the first hit.
 */
function dateNear(text: string, labelSrc: string): string | null {
  const re = new RegExp(labelSrc, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 50);
    const dm = DATE_TOKEN.exec(after);
    if (dm) {
      const res = chrono.parse(dm[0]);
      const iso = res[0] ? isoFromComponent(res[0].start) : null;
      if (iso) return iso;
    }
    if (re.lastIndex === m.index) re.lastIndex++; // avoid zero-width loops
  }
  return null;
}

const CHECKIN_LABEL = "check[\\s-]?in|arrival|arriving";
const CHECKOUT_LABEL = "check[\\s-]?out|checkout|departure|departing";

function extractDates(text: string): { checkIn: string | null; checkOut: string | null } {
  const checkIn = dateNear(text, CHECKIN_LABEL);
  const checkOut = dateNear(text, CHECKOUT_LABEL);
  if (checkIn || checkOut) return { checkIn, checkOut };

  // Fallback: first plausible date range anywhere in the text (skip absurd
  // spans, which are usually chrono misreads of collapsed whitespace).
  const results = chrono.parse(text);
  for (const r of results) {
    if (r.start && r.end) {
      const a = isoFromComponent(r.start);
      const b = isoFromComponent(r.end);
      if (a && b) {
        const nights = (Date.parse(b) - Date.parse(a)) / 86_400_000;
        if (nights >= 0 && nights <= 60) return { checkIn: a, checkOut: b };
      }
    }
  }
  return { checkIn: results[0] ? isoFromComponent(results[0].start) : null, checkOut: null };
}

// Require an explicit label word + a real separator (: or #) so we don't match
// the "conf" inside "confirmed". The captured code must contain a digit.
const CONF_RE =
  /\b(?:confirmation|booking|itinerary|reservation|trip|reference)\s*(?:code|number|no\.?|id|reference|ref)?\s*[:#]\s*([A-Z0-9][A-Z0-9-]{4,})\b/i;

function looksLikeCode(code: string): boolean {
  if (!/\d/.test(code)) return false; // real codes carry digits
  if (/^\d{1,2}[-/]\d{1,2}/.test(code)) return false; // date-like
  return true;
}

function extractConfirmation(text: string, channel: Channel): string | null {
  // Airbnb codes look like HM + 8 alphanumerics with at least one digit.
  if (channel === "airbnb") {
    const a = /\bHM[A-Z0-9]{6,9}\b/.exec(text);
    if (a && /\d/.test(a[0])) return a[0];
  }
  const m = CONF_RE.exec(text);
  if (!m) return null;
  const code = m[1].toUpperCase();
  return looksLikeCode(code) ? code : null;
}

const NAME_SUBJECT_PATTERNS: RegExp[] = [
  /(?:reservation|booking|stay)\s+(?:for|at)\s+(.+?)(?:\s+is\s+confirmed|\s*[-–|·]|$)/i,
  /your\s+(?:stay|booking|reservation)\s+at\s+(.+?)(?:\s+is\b|\s*[-–|·]|$)/i,
  /(.+?)\s+(?:booking\s+)?(?:is\s+)?confirmed\b/i,
];

// Marketing/boilerplate headings that aren't a property name.
const JUNK_NAME =
  /^(your|the|a)\b|pack your bags|get ready|here are|stories|welcome|thank you|order\b|registration|payment|trip planning|reservation reminder/i;

function cleanName(n: string | null | undefined): string | null {
  if (!n) return null;
  const t = n.trim();
  if (t.length < 3 || t.length > 120) return null;
  if (JUNK_NAME.test(t) || PROMO.test(t)) return null;
  return t;
}

function extractName(subject: string, html?: string): string | null {
  for (const re of NAME_SUBJECT_PATTERNS) {
    const m = re.exec(subject);
    const n = cleanName(m?.[1]);
    if (n) return n;
  }
  if (html) {
    try {
      const $ = cheerio.load(html);
      const h1 = cleanName($("h1").first().text());
      if (h1) return h1;
      const title = $("title").first().text().replace(/\s*[-–|].*$/, "");
      const t = cleanName(title);
      if (t) return t;
    } catch {
      /* ignore */
    }
  }
  return null;
}

const CITY_RE =
  /\b([A-Z][a-zA-Z.\-' ]{1,40}),\s*([A-Z][a-zA-Z.\-' ]{1,40})\b/;

function extractCity(text: string): { city: string | null; country: string | null } {
  // Look near a location/address cue first.
  const cue = /(?:address|location|located in|city)\s*[:]?\s*(.{0,60})/i.exec(text);
  const hay = cue ? cue[1] : text;
  const m = CITY_RE.exec(hay);
  if (!m) return { city: null, country: null };
  return { city: m[1].trim(), country: m[2].trim() };
}

const PRICE_RE =
  /(?:grand total|total(?:\s+price|\s+paid|\s+cost)?|amount(?:\s+paid|\s+charged)?)\s*[:]?\s*([$€£])\s?([\d,]+(?:\.\d{2})?)/i;
const SYMBOL: Record<string, string> = { $: "USD", "€": "EUR", "£": "GBP" };

function extractPrice(text: string): { total: number | null; currency: string | null } {
  const m = PRICE_RE.exec(text);
  if (!m) return { total: null, currency: null };
  const total = Number(m[2].replace(/,/g, ""));
  return { total: Number.isFinite(total) ? total : null, currency: SYMBOL[m[1]] ?? null };
}

// ---- main -------------------------------------------------------------------

function nullStay(): ParsedStay {
  return {
    isHotelConfirmation: false,
    hotelName: null,
    brand: null,
    address: null,
    city: null,
    country: null,
    checkIn: null,
    checkOut: null,
    confirmationNo: null,
    roomType: null,
    total: null,
    currency: null,
    channel: null,
    confidence: 0,
  };
}

export function extractStayHeuristic(input: ParseInput): ParsedStay {
  const subject = cleanSubject(input.subject);
  const bodyText =
    (input.text || "") +
    (input.html ? " " + htmlToText(input.html) : "");
  const haystack = `${subject}\n${bodyText}`;

  const channel = detectChannel(input.from);
  const { checkIn, checkOut } = extractDates(haystack);
  const confirmationNo = extractConfirmation(haystack, channel);

  // Lodging signal: explicit lodging words, or a known travel-channel sender.
  const lodging = channel !== null || LODGING.test(haystack);

  const gated = isLikelyConfirmation(
    subject,
    bodyText,
    !!checkIn,
    !!confirmationNo,
    lodging,
  );
  if (!gated) {
    const s = nullStay();
    s.channel = channel;
    return s;
  }

  const hotelName = extractName(subject, input.html);
  const { city, country } = extractCity(haystack);
  const { total, currency } = extractPrice(haystack);

  let confidence = 0.4;
  if (hotelName) confidence += 0.25;
  if (checkIn) confidence += 0.25;
  if (confirmationNo) confidence += 0.1;

  return {
    isHotelConfirmation: true,
    hotelName,
    brand: null,
    address: null,
    city,
    country,
    checkIn,
    checkOut,
    confirmationNo,
    roomType: null,
    total,
    currency,
    channel,
    confidence: Math.min(1, confidence),
  };
}

/**
 * A complete stay has every required field. Map location is verified separately
 * (after geocoding) in the ingest pipeline. Anything short of this goes to the
 * review queue.
 */
export function isComplete(s: ParsedStay): boolean {
  return (
    s.isHotelConfirmation &&
    !!s.hotelName &&
    !!s.checkIn &&
    !!s.checkOut &&
    !!s.confirmationNo
  );
}
