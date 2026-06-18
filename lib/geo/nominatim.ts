import type { GeoProvider, GeoResult } from "./types";
import { appleMapsLink } from "./mapsLink";

const ENDPOINT = "https://nominatim.openstreetmap.org/search";

// Nominatim's usage policy requires an identifying User-Agent and <=1 req/s.
// Set HOTELI_CONTACT to your email so OSM can reach you if needed.
const UA = `Hoteli/0.1 (${process.env.HOTELI_CONTACT ?? "self-hosted"})`;

interface NominatimItem {
  display_name: string;
  lat: string;
  lon: string;
  name?: string;
  address?: Record<string, string>;
}

function pickCity(addr: Record<string, string> = {}): string | undefined {
  return addr.city ?? addr.town ?? addr.village ?? addr.municipality ?? addr.county;
}

export const nominatimProvider: GeoProvider = {
  name: "nominatim",
  async search(query: string): Promise<GeoResult[]> {
    const url = new URL(ENDPOINT);
    url.searchParams.set("q", query);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("limit", "6");

    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) throw new Error(`Nominatim ${res.status}`);
    const items = (await res.json()) as NominatimItem[];

    return items.map((it) => {
      const lat = parseFloat(it.lat);
      const lng = parseFloat(it.lon);
      const name = it.name?.trim() || it.display_name.split(",")[0];
      const city = pickCity(it.address);
      const country = it.address?.country;
      return {
        name,
        address: it.display_name,
        city,
        country,
        lat,
        lng,
        mapsUrl: appleMapsLink({ name, address: it.display_name, lat, lng }),
        source: "nominatim",
      } satisfies GeoResult;
    });
  },
};
