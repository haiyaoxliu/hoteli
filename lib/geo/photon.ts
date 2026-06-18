import type { GeoResult } from "./types";
import { appleMapsLink } from "./mapsLink";

// Photon (komoot) — OSM-based, strong at free-text / POI lookups like hotel
// names and typo tolerance. Free public instance; keep usage reasonable.
const ENDPOINT = "https://photon.komoot.io/api/";
const UA = `Hoteli/0.1 (${process.env.HOTELI_CONTACT ?? "self-hosted"})`;

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: Record<string, string>;
}

export async function photonSearch(query: string): Promise<GeoResult[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  const url = new URL(ENDPOINT);
  url.searchParams.set("q", q);
  url.searchParams.set("limit", "3");

  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`Photon ${res.status}`);
  const data = (await res.json()) as { features?: PhotonFeature[] };

  return (data.features ?? [])
    .map((f): GeoResult | null => {
      const coords = f.geometry?.coordinates;
      if (!coords) return null;
      const [lng, lat] = coords;
      if (typeof lat !== "number" || typeof lng !== "number") return null;
      const p = f.properties ?? {};
      const name =
        p.name || [p.housenumber, p.street].filter(Boolean).join(" ") || q;
      const address = [p.name, p.street, p.city, p.state, p.country]
        .filter(Boolean)
        .join(", ");
      return {
        name,
        address,
        city: p.city,
        country: p.country,
        lat,
        lng,
        mapsUrl: appleMapsLink({ name, address, lat, lng }),
        source: "photon",
      };
    })
    .filter((r): r is GeoResult => r !== null);
}
