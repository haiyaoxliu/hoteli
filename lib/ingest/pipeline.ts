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

function stripName(s: string): string {
  return norm(s).replace(/[^a-z0-9 ]/g, "").trim();
}

/** Two hotel names refer to the same property (equal, or one contains the other). */
function nameSimilar(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  const x = stripName(a);
  const y = stripName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  return x.length >= 6 && y.length >= 6 && (x.includes(y) || y.includes(x));
}

type StayRow = typeof stays.$inferSelect;

/**
 * Find a logged stay that is the same reservation as `merged`: same check-in,
 * and matching confirmation, a similar hotel name, or the same full date range
 * (city-guarded). Lets a portal booking and the hotel's own emails collapse.
 */
function matchReservationStay(userId: number, merged: ParsedStay): StayRow | null {
  if (!merged.checkIn) return null;
  const cands = db
    .select({ s: stays, pname: properties.name, pcity: properties.city })
    .from(stays)
    .leftJoin(properties, eq(properties.id, stays.propertyId))
    .where(and(eq(stays.userId, userId), eq(stays.checkIn, merged.checkIn)))
    .all();
  for (const c of cands) {
    if (
      merged.confirmationNo &&
      c.s.confirmationNo &&
      c.s.confirmationNo.toUpperCase() === merged.confirmationNo.toUpperCase()
    ) {
      return c.s;
    }
    if (nameSimilar(merged.hotelName, c.pname)) return c.s;
    if (
      merged.checkOut &&
      c.s.checkOut === merged.checkOut &&
      (!merged.city || !c.pcity || norm(c.pcity) === norm(merged.city))
    ) {
      return c.s;
    }
  }
  return null;
}

/** Re-link review messages that belong to the same reservation as a new stay. */
function absorbReviewCopies(userId: number, stayId: number, merged: ParsedStay): void {
  if (!merged.checkIn) return;
  const reviews = db
    .select()
    .from(rawMessages)
    .where(and(eq(rawMessages.userId, userId), eq(rawMessages.parseStatus, "review")))
    .all();
  for (const r of reviews) {
    if (!r.parseJson) continue;
    let p: ParsedStay;
    try {
      p = JSON.parse(r.parseJson) as ParsedStay;
    } catch {
      continue;
    }
    if (p.checkIn !== merged.checkIn) continue;
    const same =
      (p.confirmationNo &&
        merged.confirmationNo &&
        p.confirmationNo.toUpperCase() === merged.confirmationNo.toUpperCase()) ||
      nameSimilar(p.hotelName, merged.hotelName) ||
      (!!p.city && !!merged.city && norm(p.city) === norm(merged.city));
    if (same) {
      db.update(rawMessages)
        .set({ parseStatus: "parsed", stayId })
        .where(eq(rawMessages.id, r.id))
        .run();
    }
  }
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

  const linkRows = (stayId: number) => {
    for (const r of rows) {
      db.update(rawMessages)
        .set({ parseStatus: "parsed", stayId })
        .where(eq(rawMessages.id, r.id))
        .run();
    }
  };
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

  // Find an existing stay this reservation belongs to: a copy already linked,
  // else a logged stay matching check-in + (confirmation OR similar hotel name OR
  // same full date range). This unifies records that keyed differently — e.g. an
  // Amex/portal booking and the hotel's own upsell email for the same stay.
  const linkedId = rows.find((r) => r.stayId != null)?.stayId ?? null;
  const existingStay =
    (linkedId != null
      ? db.select().from(stays).where(eq(stays.id, linkedId)).get() ?? null
      : null) ?? matchReservationStay(userId, merged);

  // Incomplete (e.g. an upsell with only a check-in): attach to a matching stay
  // if one exists, otherwise hold for review.
  if (!isComplete(merged)) {
    if (existingStay) {
      linkRows(existingStay.id);
      return "skipped_existing_stay";
    }
    return markReview();
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

  linkRows(stayId);
  // Pull in any earlier review copies of this same reservation (e.g. upsell
  // emails that arrived before the booking confirmation).
  absorbReviewCopies(userId, stayId, merged);

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
