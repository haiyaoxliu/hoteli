export interface GeoResult {
  name: string;
  address?: string;
  city?: string;
  country?: string;
  lat: number;
  lng: number;
  /** Apple Maps place identifier, when the provider supplies one. */
  placeId?: string;
  /** Deep link that opens this place in Apple Maps (native or web). */
  mapsUrl: string;
  source: string; // nominatim | applemaps
}

export interface GeoProvider {
  readonly name: string;
  search(query: string): Promise<GeoResult[]>;
}
