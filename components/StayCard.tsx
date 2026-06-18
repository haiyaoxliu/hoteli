import Link from "next/link";
import type { StayWithProperty } from "@/lib/stays";
import { fmtDateRange, fmtMoney, nights } from "@/lib/format";

const channelColors: Record<string, string> = {
  booking: "bg-blue-500/15 text-blue-300",
  expedia: "bg-yellow-500/15 text-yellow-300",
  airbnb: "bg-rose-500/15 text-rose-300",
  direct: "bg-emerald-500/15 text-emerald-300",
};

export function StayCard({ item }: { item: StayWithProperty }) {
  const { stay, property } = item;
  const n = nights(stay.checkIn, stay.checkOut);
  const money = fmtMoney(stay.total, stay.currency);
  const place = [property?.city, property?.country].filter(Boolean).join(", ");

  return (
    <Link
      href={`/stays/${stay.id}`}
      className="block rounded-2xl border border-border bg-surface p-4 transition-colors hover:bg-surface-2"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold">
            {property?.name ?? "Unknown hotel"}
          </h3>
          {place && <p className="truncate text-sm text-muted">{place}</p>}
        </div>
        {stay.channel && (
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
              channelColors[stay.channel] ?? "bg-surface-2 text-muted"
            }`}
          >
            {stay.channel}
          </span>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
        <span>{fmtDateRange(stay.checkIn, stay.checkOut)}</span>
        {n != null && <span>· {n} {n === 1 ? "night" : "nights"}</span>}
        {money && <span className="ml-auto font-medium text-foreground">{money}</span>}
      </div>
    </Link>
  );
}
