import { getCurrentUser } from "@/lib/auth";
import { listStaysForUser } from "@/lib/stays";
import { MapView, type MapPoint } from "@/components/MapView";

export const dynamic = "force-dynamic";

export default async function MapPage() {
  const user = await getCurrentUser();
  const stays = listStaysForUser(user.id);

  const points: MapPoint[] = stays
    .filter((s) => s.property?.lat != null && s.property?.lng != null)
    .map((s) => ({
      id: s.stay.id,
      lat: s.property!.lat!,
      lng: s.property!.lng!,
      label: s.property!.name,
      href: `/stays/${s.stay.id}`,
    }));

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Map · {points.length} located</h1>
      {points.length === 0 ? (
        <p className="text-sm text-muted">
          No located stays yet. Add a stay with a hotel picked from search to see it here.
        </p>
      ) : (
        <MapView
          points={points}
          className="h-[70vh] w-full overflow-hidden rounded-2xl border border-border"
        />
      )}
    </div>
  );
}
