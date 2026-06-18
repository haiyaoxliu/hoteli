import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { rawMessages, properties, stays } from "../db/schema";
import { parseStay, type ParsedStay } from "../parse";
import { isRentalChannel, isComplete } from "../parse/heuristic";
import { geocodeBest } from "../geo";
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
  headers?: Record<string, string>;
}

export type IngestOutcome =
  | "duplicate"
  | "no_match"
  | "created"
  | "skipped_existing_stay"
  | "needs_review"
  | "failed";

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * A reservation identity used to group copies (thread replies, reminders) for
 * merging. Confirmation code when present; otherwise the date range, which is
 * the field most consistently extracted across copies. (Cross-key duplicates —
 * one copy with a code, another without — are caught by the date-range stay
 * lookup in reconcileByKey.) Returns null without a check-in.
 */
function reservationKey(p: ParsedStay): string | null {
  if (p.confirmationNo) return `conf:${p.confirmationNo.toUpperCase()}`;
  if (p.checkIn && p.checkOut) return `dates:${p.checkIn}|${p.checkOut}`;
  if (p.checkIn) return `dates:${p.checkIn}`;
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
    headers: input.headers,
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

  // Persist the parse + reservation key so reconcile can find sibling copies.
  const key = reservationKey(parsed);
  db.update(rawMessages)
    .set({ parseJson: JSON.stringify(parsed), resvKey: key })
    .where(eq(rawMessages.id, raw.id))
    .run();

  // Not enough to identify a reservation (no conf, and missing check-in or any
  // name/address) — hold for review.
  if (!key) {
    db.update(rawMessages)
      .set({ parseStatus: "review" })
      .where(eq(rawMessages.id, raw.id))
      .run();
    return "needs_review";
  }

  return reconcileByKey(input.userId, key, {
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
function mergeParsed(list: ParsedStay[]): ParsedStay {
  // Prefer a copy that has BOTH dates (a real check-in/out pair) over partials.
  const datePair = list.find((p) => p.checkIn && p.checkOut);
  // Prefer a copy with a street address, else any with a city, for location.
  const loc = list.find((p) => p.address) ?? list.find((p) => p.city) ?? null;
  return {
    isHotelConfirmation: true,
    hotelName: firstTruthy(list, "hotelName"),
    brand: firstTruthy(list, "brand"),
    address: loc?.address ?? firstTruthy(list, "address"),
    city: loc?.city ?? firstTruthy(list, "city"),
    country: loc?.country ?? firstTruthy(list, "country"),
    checkIn: datePair ? datePair.checkIn : firstTruthy(list, "checkIn"),
    checkOut: datePair ? datePair.checkOut : firstTruthy(list, "checkOut"),
    confirmationNo: firstTruthy(list, "confirmationNo"),
    roomType: firstTruthy(list, "roomType"),
    total: firstTruthy(list, "total"),
    currency: firstTruthy(list, "currency"),
    channel: firstTruthy(list, "channel"),
    confidence: Math.max(0, ...list.map((p) => p.confidence ?? 0)),
  };
}

/**
 * Reconcile every processed copy sharing a reservation key into ONE stay with
 * merged best fields. Logs once the copies provide check-in/out + a name or
 * address (confirmation code and map pin are optional — geocoding is best-effort
 * and a stay is still logged without a pin). Otherwise leaves copies in review.
 */
async function reconcileByKey(
  userId: number,
  key: string,
  origin: { source: string; externalId: string; rawExcerpt: string },
): Promise<IngestOutcome> {
  const rows = db
    .select()
    .from(rawMessages)
    .where(and(eq(rawMessages.userId, userId), eq(rawMessages.resvKey, key)))
    .all();

  const list: ParsedStay[] = [];
  for (const r of rows) {
    if (!r.parseJson) continue;
    try {
      list.push(JSON.parse(r.parseJson) as ParsedStay);
    } catch {
      /* ignore unparseable */
    }
  }

  const merged = mergeParsed(list);

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

  // Log bar: check-in/out + an identity (name or address). Conf & pin optional.
  if (!isComplete(merged)) return markReview();

  // Existing stay for this reservation: a copy already linked to one, else the
  // same property + check-in (dedups across copies that keyed differently).
  const linkedId = rows.find((r) => r.stayId != null)?.stayId ?? null;
  let existingStay =
    linkedId != null
      ? db.select().from(stays).where(eq(stays.id, linkedId)).get() ?? null
      : null;

  // Cross-key dedup: an existing stay with the same date range is the same
  // reservation (copies that keyed by code vs dates still collapse). Guard
  // against merging two genuinely different hotels on the same dates by
  // requiring the city to match when both are known.
  if (!existingStay && merged.checkIn && merged.checkOut) {
    const sameDates = db
      .select({ s: stays, city: properties.city })
      .from(stays)
      .leftJoin(properties, eq(properties.id, stays.propertyId))
      .where(
        and(
          eq(stays.userId, userId),
          eq(stays.checkIn, merged.checkIn),
          eq(stays.checkOut, merged.checkOut),
        ),
      )
      .all();
    const match = sameDates.find(
      (c) => !c.city || !merged.city || norm(c.city) === norm(merged.city),
    );
    existingStay = match?.s ?? null;
  }

  // Find-or-create the property (deduped by name+city); coords best-effort.
  const propName = merged.hotelName ?? merged.address ?? "Stay";
  const property =
    (existingStay?.propertyId
      ? db.select().from(properties).where(eq(properties.id, existingStay.propertyId)).get()
      : undefined) ??
    upsertProperty({
      name: propName,
      brand: merged.brand,
      address: merged.address,
      city: merged.city,
      country: merged.country,
      lat: null,
      lng: null,
      geoSource: null,
    });

  // Best-effort geocode if we don't already have coordinates.
  if (property.lat == null || property.lng == null) {
    const hit = await geocodeBest({
      address: merged.address,
      name: merged.hotelName,
      city: merged.city,
      country: merged.country,
      rental: isRentalChannel(merged.channel),
    });
    if (hit) {
      db.update(properties)
        .set({
          lat: hit.lat,
          lng: hit.lng,
          geoSource: hit.source,
          address: property.address ?? merged.address ?? hit.address,
          city: property.city ?? merged.city ?? hit.city,
          country: property.country ?? merged.country ?? hit.country,
        })
        .where(eq(properties.id, property.id))
        .run();
    }
  }

  let stayId: number;
  let created = false;
  if (existingStay) {
    db.update(stays)
      .set({
        propertyId: property.id,
        checkIn: merged.checkIn,
        checkOut: merged.checkOut,
        confirmationNo: merged.confirmationNo ?? existingStay.confirmationNo,
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
        confirmationNo: merged.confirmationNo,
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
