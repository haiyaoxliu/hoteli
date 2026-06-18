import * as chrono from "chrono-node";
import * as cheerio from "cheerio";
import type { ParsedStay, ParseInput } from "./extract";
import { getProfile, type SenderProfile } from "./senders";
import { isBulk } from "./headers";
import { findCityCountry, findCountry } from "./gazetteer";

/**
 * Deterministic (non-LLM) extraction of a hotel stay from a confirmation email.
 *
 * Strategy (see plan): reject bulk/marketing via headers; hard-exclude
 * non-lodging confirmations (flights/orders/education); require a lodging
 * context (known booking sender, a lodging noun, or a date-range + street
 * address); then extract name / dates / address / conf with table-aware logic.
 * A confirmation code is optional. Anything that's a real lodging candidate but
 * not log-complete goes to review; everything else is rejected.
 */

type Channel = ParsedStay["channel"];

/** Vacation rentals: the "name" is a listing title; geocode by address/city. */
export function isRentalChannel(c: Channel): boolean {
  return c === "airbnb";
}

// ---- signal vocabularies ----------------------------------------------------

const STRONG_LODGING =
  /\b(hotels?|motels?|resorts?|\binn\b|lodge|hostel|guest\s?house|b\s?&\s?b|bed and breakfast|vacation rental|vacation home|holiday (?:home|let)|\bvilla\b|aparthotel|airbnb|vrbo)\b/i;

// Non-lodging confirmations that look similar. Overridden by a strong lodging
// term in the subject/body (e.g. "hotel near LAX airport").
const EXCLUDE_SENDER =
  /(united|delta|aa\.com|americanair|southwest|jetblue|alaskaair|spirit|frontier|ryanair|easyjet|lufthansa|aircanada|airlines?)\b/i;
const EXCLUDE_SUBJECT =
  /\b(flights?|airlines?|boarding pass|e-?ticket|order\s*#|your order|order confirmation|invoice|university|college|campus|admission|accepted student|open house|webinar|seminar|\bsat\b|\bact\b|exam|tour reservation|registration confirmation|one[- ]time pass|passcode|verification code|expense reimbursement|rewards? points?|sent you a message|new message|left (?:you )?a review)\b/i;

// Upsell / loyalty marketing dressed up as a "stay" email (e.g. Langham
// "Reminder to upgrade your stay", "Elevate your stay").
const UPSELL =
  /\b(upgrade your (?:stay|room)|elevat(?:e|ing) your (?:stay|delightful)|enhance your stay|complete your stay|upgrade your delightful)\b/i;

// Restaurant / dining reservations (e.g. a NYC restaurant "Re: Reservation").
const DINING =
  /\b(restaurant|dining|prix fixe|tasting menu|table for \d|party of \d|seating|sommelier|reservation for \d+ (?:guests?|people)|our menu)\b/i;

// ---- helpers ----------------------------------------------------------------

function cleanSubject(s = ""): string {
  return s.replace(/^(re|fwd?):\s*/i, "").trim();
}

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

function isoFromDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

function addDays(iso: string, n: number): string {
  return isoFromDate(new Date(Date.parse(iso) + n * 86_400_000));
}

function validRange(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const days = (Date.parse(b) - Date.parse(a)) / 86_400_000;
  return days > 0 && days <= 60;
}

const MONTH = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?";
const WEEKDAY = "(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\\s*";
const DATE_TOKEN = new RegExp(
  [
    `(?:${WEEKDAY})?${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s*\\d{4}`,
    `(?:${WEEKDAY})?\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH}\\s*,?\\s*\\d{4}`,
    `\\d{4}-\\d{2}-\\d{2}`,
    `\\d{1,2}[/]\\d{1,2}[/]\\d{2,4}`,
  ].join("|"),
  "i",
);
const DATE_TOKEN_G = new RegExp(DATE_TOKEN.source, "gi");

/**
 * Parse one date token to ISO. Numeric d/m/y is ambiguous: `dayFirst` (set for
 * non-US locations) reads "08/06/2026" as 8 June, not 6 August.
 */
function tokenToIso(token: string, dayFirst: boolean): string | null {
  const sl = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(token.trim());
  if (sl) {
    const yy = sl[3].length === 2 ? 2000 + Number(sl[3]) : Number(sl[3]);
    const mo = dayFirst ? Number(sl[2]) : Number(sl[1]);
    const d = dayFirst ? Number(sl[1]) : Number(sl[2]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      return `${yy}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
    return null;
  }
  const res = chrono.parse(token);
  return res[0] ? isoFromComponent(res[0].start) : null;
}

/** First labeled date: scan each label, parse the clean token that follows. */
function dateNear(text: string, labelSrc: string, dayFirst: boolean): string | null {
  const re = new RegExp(labelSrc, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 50);
    const dm = DATE_TOKEN.exec(after);
    if (dm) {
      const iso = tokenToIso(dm[0], dayFirst);
      if (iso) return iso;
    }
    if (re.lastIndex === m.index) re.lastIndex++;
  }
  return null;
}

const CHECKIN_LABEL = "check[\\s-]?in|arrival|arriving";
const CHECKOUT_LABEL = "check[\\s-]?out|checkout|departure|departing";

/** A subject often carries the whole range, e.g. "..., Jun 19 – 21" or
 *  "..., Apr 10 – 12, 2026" — the most reliable source for Airbnb. */
function parseSubjectRange(subject: string, year: number): { checkIn: string; checkOut: string } | null {
  // "Mon D – Mon D[, YYYY]"
  let m = new RegExp(
    `(${MONTH})\\s+(\\d{1,2})\\s*[\\u2013\\u2014-]\\s*(${MONTH})\\s+(\\d{1,2})(?:,?\\s*(\\d{4}))?`,
    "i",
  ).exec(subject);
  if (m) {
    const yr = m[5] || String(year);
    const ci = chrono.parseDate(`${m[1]} ${m[2]}, ${yr}`);
    const co = chrono.parseDate(`${m[3]} ${m[4]}, ${yr}`);
    if (ci && co) {
      const a = isoFromDate(ci);
      const b = isoFromDate(co);
      if (validRange(a, b)) return { checkIn: a, checkOut: b };
    }
  }
  // "Mon D – D[, YYYY]"
  m = new RegExp(
    `(${MONTH})\\s+(\\d{1,2})\\s*[\\u2013\\u2014-]\\s*(\\d{1,2})(?:,?\\s*(\\d{4}))?`,
    "i",
  ).exec(subject);
  if (m) {
    const yr = m[4] || String(year);
    const ci = chrono.parseDate(`${m[1]} ${m[2]}, ${yr}`);
    const co = chrono.parseDate(`${m[1]} ${m[3]}, ${yr}`);
    if (ci && co) {
      const a = isoFromDate(ci);
      const b = isoFromDate(co);
      if (validRange(a, b)) return { checkIn: a, checkOut: b };
    }
  }
  return null;
}

function allDateTokens(text: string, dayFirst: boolean): string[] {
  const set = new Set<string>();
  let m: RegExpExecArray | null;
  DATE_TOKEN_G.lastIndex = 0;
  while ((m = DATE_TOKEN_G.exec(text))) {
    const iso = tokenToIso(m[0], dayFirst);
    if (iso) set.add(iso);
  }
  return [...set].sort();
}

function extractNights(text: string): number | null {
  const m = /\b(\d{1,2})\s+nights?\b/i.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  return n > 0 && n <= 60 ? n : null;
}

function extractDates(
  subject: string,
  haystack: string,
  fallbackYear: number,
  dayFirst: boolean,
): { checkIn: string | null; checkOut: string | null } {
  const ci = dateNear(haystack, CHECKIN_LABEL, dayFirst);
  const co = dateNear(haystack, CHECKOUT_LABEL, dayFirst);
  if (validRange(ci, co)) return { checkIn: ci, checkOut: co };

  const sr = parseSubjectRange(subject, fallbackYear);
  if (sr) return sr;

  const nights = extractNights(haystack);
  if (ci && nights) {
    const derived = addDays(ci, nights);
    if (validRange(ci, derived)) return { checkIn: ci, checkOut: derived };
  }

  // First ascending pair of body dates within a plausible span.
  const toks = allDateTokens(haystack, dayFirst);
  for (let i = 0; i < toks.length - 1; i++) {
    if (validRange(toks[i], toks[i + 1])) return { checkIn: toks[i], checkOut: toks[i + 1] };
  }
  return { checkIn: ci ?? toks[0] ?? null, checkOut: validRange(ci, co) ? co : null };
}

// ---- address ----------------------------------------------------------------

const STREET_TYPE =
  "Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Lane|Ln|Boulevard|Blvd|Highway|Hwy|Court|Ct|Place|Pl|Terrace|Ter|Circle|Cir|Parkway|Pkwy|Square|Sq|Way|Walk|Row|Close|Crescent|Trail|Trl";
const US_ADDRESS = new RegExp(
  `\\b(\\d{1,6}\\s+[A-Za-z0-9.'\\- ]{2,40}\\b(?:${STREET_TYPE})\\b)` + // street
    `(?:,?\\s*(?:Unit|Apt|Suite|Ste|#)\\s*[A-Za-z0-9-]+)?` + // optional unit
    `,?\\s*([A-Za-z .'\\-]{2,30}?),?\\s*([A-Z]{2})\\.?\\s*(\\d{5}(?:-\\d{4})?)`, // city, ST zip
  "i",
);

export interface Address {
  full: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  postal: string | null;
  country: string | null;
}

const US_ADDRESS_G = new RegExp(US_ADDRESS.source, "gi");
// Corporate / footer addresses that appear in every email from a sender and
// must never be taken as the property address.
const CORP_ADDR =
  /888\s+Brannan|One\s+Apple\s+Park|Apple\s+Inc|hacker\s+way|expedia group|travelscape/i;
const NONE: Address = {
  full: null,
  street: null,
  city: null,
  state: null,
  postal: null,
  country: null,
};

function extractAddress(text: string): Address {
  US_ADDRESS_G.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = US_ADDRESS_G.exec(text))) {
    const [, street, city, state, postal] = m;
    const full = `${street}, ${city}, ${state} ${postal}`;
    if (CORP_ADDR.test(full)) continue; // skip corporate footer address
    return {
      full,
      street: street.trim(),
      city: city.trim(),
      state: state.toUpperCase(),
      postal,
      country: "USA",
    };
  }
  // Labeled fallback (international / non-US) — require it to look like a real
  // address (has a number and a comma) so we don't grab arbitrary sentences.
  const lab = /(?:address|located at|property address)\s*:?\s*([^\n<]{8,90})/i.exec(text);
  if (lab) {
    const full = lab[1].replace(/\s+/g, " ").trim().replace(/[.,;]+$/, "");
    if (/\d/.test(full) && full.includes(",") && !CORP_ADDR.test(full)) {
      return { full, street: null, city: null, state: null, postal: null, country: null };
    }
  }
  return NONE;
}

// ---- confirmation code ------------------------------------------------------

const CONF_RE =
  /\b(?:confirmation|booking|itinerary|reservation|trip|reference)\s*(?:code|number|no\.?|id|reference|ref)?\s*[:#]\s*([A-Z0-9][A-Z0-9-]{4,})\b/i;

function extractConfirmation(text: string, channel: Channel): string | null {
  if (channel === "airbnb") {
    const a = /\bHM[A-Z0-9]{6,9}\b/.exec(text);
    if (a && /\d/.test(a[0])) return a[0];
  }
  const m = CONF_RE.exec(text);
  if (!m) return null;
  const code = m[1].toUpperCase();
  if (!/\d/.test(code)) return null;
  if (/^\d{1,2}[-/]\d{1,2}/.test(code)) return null;
  return code;
}

// ---- name -------------------------------------------------------------------

const NAME_SUBJECT_PATTERNS: RegExp[] = [
  /(?:reservation|booking|stay)\s+(?:for|at)\s+(.+?)(?:\s+is\s+confirmed|,\s*[A-Z][a-z]{2}\s+\d|\s*[-–|·]|$)/i,
  /your\s+(?:stay|booking|reservation)\s+at\s+(.+?)(?:\s+is\b|\s*[-–|·]|$)/i,
  /(.+?)\s+(?:booking\s+)?(?:is\s+)?confirmed\b/i,
];

const JUNK_NAME =
  /^(your|the|a)\s+(reservation|booking|stay|trip|hotel|order|upcoming)\b|pack your bags|get ready|here are|stories|welcome to|thank you|^order\b|registration|payment|trip planning|reservation reminder|you're going|upgrade|elevate/i;

function cleanName(n: string | null | undefined): string | null {
  if (!n) return null;
  const t = n
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,;:–-]+$/, "")
    .trim();
  if (t.length < 3 || t.length > 120) return null;
  if (JUNK_NAME.test(t)) return null;
  return t;
}

function extractName(
  subject: string,
  profile: SenderProfile,
  from = "",
  html?: string,
): string | null {
  // Provider-specific subject templates first, then generic patterns.
  for (const re of [...profile.nameFromSubject, ...NAME_SUBJECT_PATTERNS]) {
    const n = cleanName(re.exec(subject)?.[1]);
    if (n) return n;
  }
  // Sender display name — chains often send as "The Langham, Hong Kong" <…>.
  const disp = (from.match(/^\s*"?([^"<]+?)"?\s*</)?.[1] ?? "").trim();
  if (disp && (findCityCountry(disp) || STRONG_LODGING.test(disp))) {
    const n = cleanName(disp);
    if (n) return n;
  }
  if (html) {
    try {
      const $ = cheerio.load(html);
      const h1 = cleanName($("h1").first().text());
      if (h1) return h1;
      const title = cleanName($("title").first().text().replace(/\s*[-–|].*$/, ""));
      if (title) return title;
    } catch {
      /* ignore */
    }
  }
  return null;
}

/**
 * Resolve location for geocoding. Prefer a parsed US street address; otherwise
 * pull a known city (+country) from the name/subject/body — for branded hotels
 * the city is usually in the name ("Park Hyatt Guangzhou", "Cordis, Hong Kong").
 */
function extractLocation(
  name: string | null,
  subject: string,
  haystack: string,
): { address: string | null; city: string | null; country: string | null } {
  const addr = extractAddress(haystack);
  if (addr.full) return { address: addr.full, city: addr.city, country: addr.country };

  // The hotel name / subject is the strongest signal for branded hotels.
  const hint = `${name ?? ""} ; ${subject}`;
  const gz = findCityCountry(hint) ?? findCityCountry(haystack.slice(0, 3000));
  if (gz) return { address: null, city: gz.city, country: gz.country };

  // "Name, City" pattern in the subject (e.g. "Welcoming you to Cordis, Hong Kong").
  const m = /,\s*([A-Z][A-Za-z .'\-]{2,30})\s*$/.exec(subject);
  if (m) return { address: null, city: m[1].trim(), country: findCountry(haystack) };

  return { address: null, city: null, country: findCountry(haystack) };
}

// ---- price ------------------------------------------------------------------

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

function reject(channel: Channel): ParsedStay {
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
    channel,
    confidence: 0,
  };
}

export function extractStayHeuristic(input: ParseInput): ParsedStay {
  const subject = cleanSubject(input.subject);
  const bodyText = (input.text || "") + (input.html ? " " + htmlToText(input.html) : "");
  const haystack = `${subject}\n${bodyText}`;
  const head1k = bodyText.slice(0, 1000);

  const profile = getProfile(input.from);
  const { channel, known } = profile;
  const bulk = isBulk(input.headers, input.from);
  const strong = STRONG_LODGING.test(subject) || STRONG_LODGING.test(head1k);

  // 0) Notifications/messages are never a stay, even when they mention "hotel".
  if (/\b(sent you a message|new message|left (?:you )?a review|message from)\b/i.test(subject)) {
    return reject(channel);
  }

  // 1) Hard-exclude non-lodging confirmations (unless clearly lodging).
  if (!strong && (EXCLUDE_SENDER.test(input.from ?? "") || EXCLUDE_SUBJECT.test(subject))) {
    return reject(channel);
  }
  // Restaurant/dining bookings → reject (unless clearly a hotel).
  if ((DINING.test(subject) || DINING.test(head1k)) && !strong) return reject(channel);
  // Upsell/loyalty mail: from an unknown sender it's marketing → reject. From a
  // known hotel/chain it implies a real booking, so keep it — but it's routed to
  // review (we don't trust its dates as a full stay; see `upsell` below).
  const upsell = UPSELL.test(subject) || UPSELL.test(head1k);
  if (upsell && !known) return reject(channel);

  // 2) Bulk/marketing → reject. Real reservation confirmations are
  // transactional and don't carry List-Unsubscribe / ESP campaign headers.
  if (bulk) return reject(channel);

  const fallbackYear = input.date
    ? new Date(input.date).getFullYear()
    : new Date().getFullYear();
  // Non-US location → interpret ambiguous numeric dates as day-first (DD/MM).
  const dayFirst = !!findCityCountry(`${subject}\n${bodyText.slice(0, 3000)}`);
  const { checkIn, checkOut } = extractDates(subject, haystack, fallbackYear, dayFirst);
  const addr = extractAddress(haystack);
  const datePair = validRange(checkIn, checkOut);

  // 3) Require a lodging context. For unknown senders, accept a date-range + a
  // real address only alongside an explicit reservation cue (avoids order/event
  // confirmations that happen to contain a date range and a footer address).
  const resHint =
    /\b(reservation|booking|your stay|stay at|itinerary|check[\s-]?in|nights?)\b/i.test(
      subject + "\n" + head1k,
    );
  const lodging = known || strong || (datePair && !!addr.full && resHint);
  if (!lodging) return reject(channel);

  // It's a real lodging candidate — extract the rest.
  const confirmationNo = extractConfirmation(haystack, channel);
  const hotelName = extractName(subject, profile, input.from, input.html);
  const loc = extractLocation(hotelName, subject, haystack);
  const { total, currency } = extractPrice(haystack);
  // Upsells imply a real booking but their dates aren't a reliable full stay —
  // drop the checkout so they're routed to review for confirmation.
  const outDate = upsell ? null : checkOut;

  let confidence = 0.35;
  if (hotelName) confidence += 0.2;
  if (datePair) confidence += 0.25;
  else if (checkIn) confidence += 0.1;
  if (loc.address) confidence += 0.15;
  else if (loc.city) confidence += 0.08;
  if (confirmationNo) confidence += 0.1;
  if (known) confidence += 0.05;

  return {
    isHotelConfirmation: true,
    hotelName,
    brand: null,
    address: loc.address,
    city: loc.city,
    country: loc.country,
    checkIn,
    checkOut: outDate,
    confirmationNo,
    roomType: null,
    total,
    currency,
    channel,
    confidence: Math.min(1, confidence),
  };
}

/**
 * Log-complete: a real candidate with check-in, check-out, and an identity
 * (hotel name OR street address). Confirmation code and map pin are optional.
 */
export function isComplete(s: ParsedStay): boolean {
  return (
    s.isHotelConfirmation &&
    !!s.checkIn &&
    !!s.checkOut &&
    (!!s.hotelName || !!s.address)
  );
}
