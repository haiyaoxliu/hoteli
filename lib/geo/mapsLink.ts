/**
 * Build an Apple Maps deep link. On Apple devices this opens the native Maps
 * app; everywhere else it opens the Apple Maps web experience.
 *
 * Docs: https://developer.apple.com/documentation/mapkit/unified-map-urls
 */
export function appleMapsLink(opts: {
  name?: string | null;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  placeId?: string | null;
}): string {
  const params = new URLSearchParams();

  // A place id (from the Apple Maps Server API) is the most precise link.
  if (opts.placeId) {
    params.set("place-id", opts.placeId);
  }

  const q = [opts.name, opts.address].filter(Boolean).join(", ");
  if (q) params.set("q", q);

  if (opts.lat != null && opts.lng != null) {
    params.set("ll", `${opts.lat},${opts.lng}`);
  }

  return `https://maps.apple.com/?${params.toString()}`;
}
