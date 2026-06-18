import type { GeoProvider } from "./types";
import { nominatimProvider } from "./nominatim";
import { appleMapsProvider } from "./applemaps";

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
