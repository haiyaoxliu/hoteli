import { and, desc, eq } from "drizzle-orm";
import { db } from "./db/client";
import { rawMessages } from "./db/schema";
import type { ParsedStay } from "./parse";
import { upsertProperty } from "./properties";
import { getGeoProvider } from "./geo";
import { createStayDeduped } from "./stays";

export interface ReviewItem {
  id: number;
  subject: string | null;
  sender: string | null;
  receivedAt: number | null;
  partial: Partial<ParsedStay> | null;
}

function parsePartial(json: string | null): Partial<ParsedStay> | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as Partial<ParsedStay>;
  } catch {
    return null;
  }
}

export function listReviewForUser(userId: number): ReviewItem[] {
  return db
    .select()
    .from(rawMessages)
    .where(and(eq(rawMessages.userId, userId), eq(rawMessages.parseStatus, "review")))
    .orderBy(desc(rawMessages.receivedAt))
    .all()
    .map((r) => ({
      id: r.id,
      subject: r.subject,
      sender: r.sender,
      receivedAt: r.receivedAt,
      partial: parsePartial(r.parseJson),
    }));
}

export function countReviewForUser(userId: number): number {
  return db
    .select()
    .from(rawMessages)
    .where(and(eq(rawMessages.userId, userId), eq(rawMessages.parseStatus, "review")))
    .all().length;
}

export interface ResolveInput {
  name: string;
  city?: string | null;
  country?: string | null;
  checkIn?: string | null;
  checkOut?: string | null;
  confirmationNo?: string | null;
  channel?: string | null;
}

/** Confirm a review item: create the stay and mark the message parsed. */
export async function resolveReview(
  userId: number,
  id: number,
  input: ResolveInput,
): Promise<boolean> {
  const row = db
    .select()
    .from(rawMessages)
    .where(and(eq(rawMessages.id, id), eq(rawMessages.userId, userId)))
    .get();
  if (!row || row.parseStatus !== "review") return false;

  // Best-effort geocode so the confirmed stay still appears on the map.
  let lat: number | null = null;
  let lng: number | null = null;
  let geoSource = "manual";
  const query = [input.name, input.city, input.country].filter(Boolean).join(", ");
  try {
    if (query) {
      const results = await getGeoProvider().search(query);
      if (results[0]) {
        lat = results[0].lat;
        lng = results[0].lng;
        geoSource = results[0].source;
      }
    }
  } catch {
    /* keep without coordinates */
  }

  const property = upsertProperty({
    name: input.name,
    city: input.city,
    country: input.country,
    lat,
    lng,
    geoSource,
  });

  const { stay } = createStayDeduped({
    userId,
    propertyId: property.id,
    checkIn: input.checkIn ?? null,
    checkOut: input.checkOut ?? null,
    confirmationNo: input.confirmationNo ?? null,
    channel: input.channel ?? null,
    source: row.source,
    sourceRef: row.externalId,
  });

  db.update(rawMessages)
    .set({ parseStatus: "parsed", stayId: stay.id })
    .where(eq(rawMessages.id, id))
    .run();
  return true;
}

/** Dismiss a review item without creating a stay. */
export function dismissReview(userId: number, id: number): boolean {
  const row = db
    .update(rawMessages)
    .set({ parseStatus: "skipped" })
    .where(and(eq(rawMessages.id, id), eq(rawMessages.userId, userId)))
    .returning()
    .get();
  return !!row;
}
