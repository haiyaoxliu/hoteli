import type { GeoProvider, GeoResult } from "./types";
import { appleMapsLink } from "./mapsLink";

/**
 * Apple Maps Server API provider. Activated by setting GEO_PROVIDER=applemaps
 * once an Apple Developer membership + Maps key are available.
 *
 * Requires:
 *   APPLE_MAPS_TEAM_ID, APPLE_MAPS_KEY_ID, APPLE_MAPS_PRIVATE_KEY (PKCS8 .p8)
 *
 * Flow: sign a JWT (ES256) with the .p8 key -> POST /v1/token to exchange for a
 * short-lived access token -> call GET /v1/search. Tokens are cached ~30 min.
 * Docs: https://developer.apple.com/documentation/applemapsserverapi
 *
 * Left as a clearly-marked stub so the provider interface is ready now and the
 * implementation can be dropped in without touching callers.
 */
export const appleMapsProvider: GeoProvider = {
  name: "applemaps",
  async search(_query: string): Promise<GeoResult[]> {
    void _query;
    void appleMapsLink; // used by the real implementation
    throw new Error(
      "Apple Maps provider not yet configured. Set GEO_PROVIDER=nominatim, " +
        "or implement token exchange in lib/geo/applemaps.ts with an Apple " +
        "Developer Maps key.",
    );
  },
};
