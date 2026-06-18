import { eq } from "drizzle-orm";
import { db } from "./db/client";
import { properties, type Property } from "./db/schema";
import { appleMapsLink, type GeoResult } from "./geo";

function dedupKeyFor(name: string, city?: string | null): string {
  return [name, city ?? ""]
    .join("|")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export interface PropertyInput {
  name: string;
  brand?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  lat?: number | null;
  lng?: number | null;
  applePlaceId?: string | null;
  geoSource?: string | null;
}

/** Insert a property if new, otherwise return the existing match (by name+city). */
export function upsertProperty(input: PropertyInput): Property {
  const key = dedupKeyFor(input.name, input.city);
  const existing = db
    .select()
    .from(properties)
    .where(eq(properties.dedupKey, key))
    .get();
  if (existing) return existing;

  const appleMapsUrl = appleMapsLink({
    name: input.name,
    address: input.address ?? undefined,
    lat: input.lat,
    lng: input.lng,
    placeId: input.applePlaceId,
  });

  return db
    .insert(properties)
    .values({
      name: input.name,
      brand: input.brand ?? null,
      address: input.address ?? null,
      city: input.city ?? null,
      country: input.country ?? null,
      lat: input.lat ?? null,
      lng: input.lng ?? null,
      applePlaceId: input.applePlaceId ?? null,
      appleMapsUrl,
      geoSource: input.geoSource ?? null,
      dedupKey: key,
      createdAt: Date.now(),
    })
    .returning()
    .get();
}

export function upsertPropertyFromGeo(g: GeoResult): Property {
  return upsertProperty({
    name: g.name,
    address: g.address,
    city: g.city,
    country: g.country,
    lat: g.lat,
    lng: g.lng,
    applePlaceId: g.placeId,
    geoSource: g.source,
  });
}
