import type { GeoProvider, GeoResult } from "./types";
import { nominatimProvider } from "./nominatim";
import { appleMapsProvider } from "./applemaps";
import { photonSearch } from "./photon";

export type { GeoProvider, GeoResult } from "./types";
export { appleMapsLink } from "./mapsLink";

/** Select the active geocoding provider from GEO_PROVIDER (default: nominatim). */
export function getGeoProvider(): GeoProvider {
  const which = (process.env.GEO_PROVIDER ?? "nominatim").toLowerCase();
  switch (which) {
    case "applemaps":
      return appleMapsProvider;
    case "nominatim":
    default:
      return nominatimProvider;
  }
}

async function tryProvider(fn: () => Promise<GeoResult[]>): Promise<GeoResult | null> {
  try {
    return (await fn())[0] ?? null;
  } catch {
    return null;
  }
}

export interface GeocodeParts {
  address?: string | null;
  name?: string | null;
  city?: string | null;
  country?: string | null;
  /** Vacation rental: skip name lookup (listing title won't geocode). */
  rental?: boolean;
}

/**
 * Address-first geocoding. A full street address geocodes far more reliably than
 * a hotel name, so try it first (Nominatim is strongest on addresses); fall back
 * to a POI/name search (Photon is strongest there), then a city centroid.
 * Honors GEO_PROVIDER when set to a non-default provider (e.g. applemaps).
 */
export async function geocodeBest(p: GeocodeParts): Promise<GeoResult | null> {
  const override = (process.env.GEO_PROVIDER ?? "nominatim").toLowerCase();
  if (override !== "nominatim") {
    const provider = getGeoProvider();
    const q =
      p.address ||
      [p.name, p.city, p.country].filter(Boolean).join(", ") ||
      [p.city, p.country].filter(Boolean).join(", ");
    return q ? tryProvider(() => provider.search(q)) : null;
  }

  if (p.address) {
    const hit = await tryProvider(() => nominatimProvider.search(p.address!));
    if (hit) return { ...hit, source: "nominatim-address" };
  }
  if (p.name && !p.rental) {
    const q = [p.name, p.city, p.country].filter(Boolean).join(", ");
    const hit = (await tryProvider(() => photonSearch(q))) ??
      (await tryProvider(() => nominatimProvider.search(q)));
    if (hit) return hit;
  }
  if (p.city) {
    const q = [p.city, p.country].filter(Boolean).join(", ");
    const hit = await tryProvider(() => nominatimProvider.search(q));
    if (hit) return { ...hit, source: "nominatim-city" };
  }
  return null;
}
