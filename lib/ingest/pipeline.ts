import { and, eq, like } from "drizzle-orm";
import { db } from "../db/client";
import { rawMessages, properties, stays } from "../db/schema";
import { parseStay, type ParsedStay } from "../parse";
import { isRentalChannel } from "../parse/heuristic";
import { getGeoProvider } from "../geo";
import { upsertProperty } from "../properties";

export interface IngestInput {
  source: string; // emlx | gmail | imap
  externalId: string; // Message-ID or stable key
  userId: number;
  receivedAt?: number;
  subject?: string;
  from?: string;
  date?: string;
  text: string;
  html?: string;
}

export type IngestOutcome =
  | "duplicate"
  | "no_match"
  | "created"
  | "skipped_existing_stay"
  | "needs_review"
  | "failed";

function dedupKeyFor(name: string, city?: string | null): string {
  return [name, city ?? ""].join("|").toLowerCase().replace(/\s+/g, " ").trim();
}

/** A listing title (vacation rental) rather than a geocodable hotel name. */
function looksLikeListing(name: string): boolean {
  return name.length > 45 || /[@/]|\bw\/\b/.test(name);
}

interface GeoHit {
  lat: number;
  lng: number;
  source: string;
  address: string | null;
  country: string | null;
}

/**
 * Geocode a parsed hotel. For vacation rentals the listing title won't geocode,
 * so we look up the city instead. Returns null when no location can be found —
 * the caller then routes the message to review. We never log a location-less stay.
 */
async function geocode(parsed: {
  hotelName: string;
  city: string | null;
  country: string | null;
  channel: ParsedStay["channel"];
}): Promise<GeoHit | null> {
  const rental = isRentalChannel(parsed.channel) || looksLikeListing(parsed.hotelName);
  const query =
    rental && parsed.city
      ? [parsed.city, parsed.country].filter(Boolean).join(", ")
      : [parsed.hotelName, parsed.city, parsed.country].filter(Boolean).join(", ");
  if (!query) return null;
  try {
    const results = await getGeoProvider().search(query);
    const r = results[0];
    if (r) {
      return {
        lat: r.lat,
        lng: r.lng,
        source: rental ? "nominatim-city" : r.source,
        address: r.address ?? null,
        country: r.country ?? null,
      };
    }
  } catch {
    /* network/provider error — treat as no location */
  }
  return null;
}

/** Idempotently ingest one message into stays. Safe to re-run. */
export async function ingestMessage(input: IngestInput): Promise<IngestOutcome> {
  const dup = db
    .select()
    .from(rawMessages)
    .where(
      and(
        eq(rawMessages.userId, input.userId),
        eq(rawMessages.externalId, input.externalId),
      ),
    )
    .get();
  if (dup) return "duplicate";

  const raw = db
    .insert(rawMessages)
    .values({
      source: input.source,
      externalId: input.externalId,
      userId: input.userId,
      subject: input.subject ?? null,
      sender: input.from ?? null,
      receivedAt: input.receivedAt ?? null,
      parseStatus: "pending",
      createdAt: Date.now(),
    })
    .returning()
    .get();

  const { parsed } = await parseStay({
    subject: input.subject,
    from: input.from,
    date: input.date,
    text: input.text,
    html: input.html,
  });

  if (!parsed) {
    db.update(rawMessages)
      .set({ parseStatus: "failed" })
      .where(eq(rawMessages.id, raw.id))
      .run();
    return "failed";
  }

  // Not a confirmation (gated out as marketing/non-lodging).
  if (!parsed.isHotelConfirmation) {
    db.update(rawMessages)
      .set({ parseStatus: "no_match", parseJson: JSON.stringify(parsed) })
      .where(eq(rawMessages.id, raw.id))
      .run();
    return "no_match";
  }

  // Persist the parse so the confirmation-keyed reconcile can see this copy.
  db.update(rawMessages)
    .set({ parseJson: JSON.stringify(parsed) })
    .where(eq(rawMessages.id, raw.id))
    .run();

  // Without a confirmation code we can't dedup/merge across thread copies, and
  // a stay isn't complete anyway — send to review.
  if (!parsed.confirmationNo) {
    db.update(rawMessages)
      .set({ parseStatus: "review" })
      .where(eq(rawMessages.id, raw.id))
      .run();
    return "needs_review";
  }

  return reconcileByConfirmation(input.userId, parsed.confirmationNo, {
    source: input.source,
    externalId: input.externalId,
    rawExcerpt: input.text.slice(0, 500),
  });
}

function firstTruthy<K extends keyof ParsedStay>(
  list: ParsedStay[],
  key: K,
): ParsedStay[K] | null {
  for (const p of list) {
    const v = p[key];
    if (v != null && v !== "") return v;
  }
  return null;
}

/** Merge all copies of a reservation into the best single record. */
function mergeParsed(list: ParsedStay[], conf: string): ParsedStay {
  // Prefer a copy that has BOTH dates (a real check-in/out pair) over partials.
  const datePair = list.find((p) => p.checkIn && p.checkOut);
  // Prefer a copy with a street address, else any with a city, for location.
  const loc = list.find((p) => p.address) ?? list.find((p) => p.city) ?? null;
  return {
    isHotelConfirmation: true,
    hotelName: firstTruthy(list, "hotelName"),
    brand: firstTruthy(list, "brand"),
    address: loc?.address ?? null,
    city: loc?.city ?? firstTruthy(list, "city"),
    country: loc?.country ?? firstTruthy(list, "country"),
    checkIn: datePair ? datePair.checkIn : firstTruthy(list, "checkIn"),
    checkOut: datePair ? datePair.checkOut : firstTruthy(list, "checkOut"),
    confirmationNo: conf,
    roomType: firstTruthy(list, "roomType"),
    total: firstTruthy(list, "total"),
    currency: firstTruthy(list, "currency"),
    channel: firstTruthy(list, "channel"),
    confidence: Math.max(0, ...list.map((p) => p.confidence ?? 0)),
  };
}

/**
 * Reconcile every processed copy that shares a confirmation code into a single
 * stay with merged best fields. Promotes the reservation out of review once the
 * combined copies provide name + both dates + a geocodable location; otherwise
 * leaves the (stay-less) copies in review.
 */
async function reconcileByConfirmation(
  userId: number,
  conf: string,
  origin: { source: string; externalId: string; rawExcerpt: string },
): Promise<IngestOutcome> {
  const rows = db
    .select()
    .from(rawMessages)
    .where(and(eq(rawMessages.userId, userId), like(rawMessages.parseJson, `%${conf}%`)))
    .all();

  const list: ParsedStay[] = [];
  for (const r of rows) {
    if (!r.parseJson) continue;
    try {
      const p = JSON.parse(r.parseJson) as ParsedStay;
      if (p.confirmationNo === conf) list.push(p);
    } catch {
      /* ignore unparseable */
    }
  }

  const merged = mergeParsed(list, conf);
  const existingStay = db
    .select()
    .from(stays)
    .where(and(eq(stays.userId, userId), eq(stays.confirmationNo, conf)))
    .get();

  const markReview = (): IngestOutcome => {
    for (const r of rows) {
      if (r.stayId == null) {
        db.update(rawMessages)
          .set({ parseStatus: "review" })
          .where(eq(rawMessages.id, r.id))
          .run();
      }
    }
    return "needs_review";
  };

  if (!merged.hotelName || !merged.checkIn || !merged.checkOut) return markReview();

  // Resolve a map location: reuse the stay's property coords, else an existing
  // property by name+city, else geocode now.
  let property =
    (existingStay?.propertyId
      ? db.select().from(properties).where(eq(properties.id, existingStay.propertyId)).get()
      : undefined) ??
    db
      .select()
      .from(properties)
      .where(eq(properties.dedupKey, dedupKeyFor(merged.hotelName, merged.city)))
      .get();

  let hasCoords = !!property && property.lat != null && property.lng != null;
  if (!hasCoords) {
    const hit = await geocode({
      hotelName: merged.hotelName,
      city: merged.city,
      country: merged.country,
      channel: merged.channel,
    });
    if (!hit) return markReview();
    if (!property) {
      property = upsertProperty({
        name: merged.hotelName,
        brand: merged.brand,
        address: merged.address ?? hit.address,
        city: merged.city,
        country: merged.country ?? hit.country,
        lat: hit.lat,
        lng: hit.lng,
        geoSource: hit.source,
      });
    } else {
      db.update(properties)
        .set({
          lat: hit.lat,
          lng: hit.lng,
          geoSource: hit.source,
          address: property.address ?? merged.address ?? hit.address,
          city: property.city ?? merged.city,
        })
        .where(eq(properties.id, property.id))
        .run();
    }
    hasCoords = true;
  }
  if (!property || !hasCoords) return markReview();

  // Create or update the single stay for this confirmation with merged fields.
  let stayId: number;
  let created = false;
  if (existingStay) {
    db.update(stays)
      .set({
        propertyId: property.id,
        checkIn: merged.checkIn,
        checkOut: merged.checkOut,
        channel: merged.channel,
        roomType: merged.roomType,
        total: merged.total,
        currency: merged.currency,
      })
      .where(eq(stays.id, existingStay.id))
      .run();
    stayId = existingStay.id;
  } else {
    const stay = db
      .insert(stays)
      .values({
        userId,
        propertyId: property.id,
        checkIn: merged.checkIn,
        checkOut: merged.checkOut,
        confirmationNo: conf,
        roomType: merged.roomType,
        total: merged.total,
        currency: merged.currency,
        channel: merged.channel,
        source: origin.source,
        sourceRef: origin.externalId,
        rawExcerpt: origin.rawExcerpt,
        createdAt: Date.now(),
      })
      .returning()
      .get();
    stayId = stay.id;
    created = true;
  }

  // All copies of this reservation now resolve to the one stay.
  for (const r of rows) {
    db.update(rawMessages)
      .set({ parseStatus: "parsed", stayId })
      .where(eq(rawMessages.id, r.id))
      .run();
  }

  return created ? "created" : "skipped_existing_stay";
}

export interface IngestSummary {
  scanned: number;
  created: number;
  skipped: number;
  review: number;
  noMatch: number;
  failed: number;
  duplicate: number;
  /** Total mail messages (.emlx files) the miner saw, before filtering. */
  filesSeen: number;
  /** Per-mailbox message counts, so the user can see what got scanned. */
  mailboxes: { name: string; count: number }[];
  /** Epoch ms of the oldest / newest email the parser looked at (its range). */
  oldest: number | null;
  newest: number | null;
  /** Human-readable explanation of the result (esp. on zero results). */
  note: string | null;
  /** Set when the run couldn't read the mail store (Full Disk Access). */
  permissionDenied: boolean;
}

export function emptySummary(): IngestSummary {
  return {
    scanned: 0,
    created: 0,
    skipped: 0,
    review: 0,
    noMatch: 0,
    failed: 0,
    duplicate: 0,
    filesSeen: 0,
    mailboxes: [],
    oldest: null,
    newest: null,
    note: null,
    permissionDenied: false,
  };
}

/** Record an email's date so the summary reflects how far back we looked. */
export function noteDate(summary: IngestSummary, ms?: number | null): void {
  if (ms == null || !Number.isFinite(ms)) return;
  if (summary.oldest == null || ms < summary.oldest) summary.oldest = ms;
  if (summary.newest == null || ms > summary.newest) summary.newest = ms;
}

/**
 * Reconcile the review count against the DB. Reservations merged out of review
 * by a later copy would otherwise stay counted; this reflects the true state.
 */
export function recountReview(summary: IngestSummary, userId: number): void {
  summary.review = db
    .select()
    .from(rawMessages)
    .where(and(eq(rawMessages.userId, userId), eq(rawMessages.parseStatus, "review")))
    .all().length;
}

export function tally(summary: IngestSummary, outcome: IngestOutcome): void {
  summary.scanned++;
  if (outcome === "created") summary.created++;
  else if (outcome === "duplicate") summary.duplicate++;
  else if (outcome === "needs_review") summary.review++;
  else if (outcome === "no_match") summary.noMatch++;
  else if (outcome === "failed") summary.failed++;
  else summary.skipped++;
}
