import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getStay } from "@/lib/stays";
import { fmtDateRange, fmtMoney, nights } from "@/lib/format";
import { appleMapsLink } from "@/lib/geo";
import { MapView } from "@/components/MapView";
import { DeleteStayButton } from "@/components/DeleteStayButton";

export const dynamic = "force-dynamic";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (value == null || value === "") return null;
  return (
    <div className="flex justify-between gap-4 border-b border-border py-2 text-sm last:border-0">
      <span className="text-muted">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

export default async function StayDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  const item = getStay(user.id, Number((await params).id));
  if (!item) notFound();

  const { stay, property } = item;
  const n = nights(stay.checkIn, stay.checkOut);
  const hasGeo = property?.lat != null && property?.lng != null;
  const mapsUrl =
    property?.appleMapsUrl ??
    appleMapsLink({
      name: property?.name,
      address: property?.address,
      lat: property?.lat,
      lng: property?.lng,
      placeId: property?.applePlaceId,
    });

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <div className="flex items-center justify-between">
        <Link href="/" className="text-sm text-muted hover:text-foreground">
          ← Back
        </Link>
        <DeleteStayButton id={stay.id} />
      </div>

      <div>
        <h1 className="text-2xl font-bold">{property?.name ?? "Unknown hotel"}</h1>
        <p className="mt-1 text-muted">
          {[property?.city, property?.country].filter(Boolean).join(", ")}
        </p>
      </div>

      {hasGeo && (
        <MapView
          points={[
            {
              lat: property!.lat!,
              lng: property!.lng!,
              label: property!.name,
            },
          ]}
          className="h-56 w-full overflow-hidden rounded-2xl border border-border"
          zoom={14}
        />
      )}

      <a
        href={mapsUrl}
        target="_blank"
        rel="noreferrer"
        className="flex items-center justify-center gap-2 rounded-full bg-accent py-2.5 text-sm font-medium text-white"
      >
        Open in Apple Maps ↗
      </a>

      <div className="rounded-2xl border border-border bg-surface px-4">
        <Row label="Dates" value={fmtDateRange(stay.checkIn, stay.checkOut)} />
        <Row label="Nights" value={n != null ? n : null} />
        <Row label="Confirmation" value={stay.confirmationNo} />
        <Row label="Room" value={stay.roomType} />
        <Row label="Channel" value={stay.channel && <span className="capitalize">{stay.channel}</span>} />
        <Row label="Total" value={fmtMoney(stay.total, stay.currency)} />
        <Row label="Address" value={property?.address} />
        <Row label="Source" value={stay.source} />
        <Row label="Notes" value={stay.notes} />
      </div>
    </div>
  );
}
