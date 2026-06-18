import { getCurrentUser } from "@/lib/auth";
import { listStaysForUser } from "@/lib/stays";
import { nights } from "@/lib/format";

export const dynamic = "force-dynamic";

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
    </div>
  );
}

function topCounts(items: (string | null | undefined)[], n = 5) {
  const m = new Map<string, number>();
  for (const it of items) {
    if (!it) continue;
    m.set(it, (m.get(it) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

export default async function StatsPage() {
  const user = await getCurrentUser();
  const stays = listStaysForUser(user.id);

  const totalNights = stays.reduce(
    (sum, s) => sum + (nights(s.stay.checkIn, s.stay.checkOut) ?? 0),
    0,
  );
  const countries = new Set(stays.map((s) => s.property?.country).filter(Boolean));
  const cities = new Set(stays.map((s) => s.property?.city).filter(Boolean));

  const byYear = new Map<string, number>();
  for (const s of stays) {
    if (!s.stay.checkIn) continue;
    const y = s.stay.checkIn.slice(0, 4);
    byYear.set(y, (byYear.get(y) ?? 0) + (nights(s.stay.checkIn, s.stay.checkOut) ?? 1));
  }
  const years = [...byYear.entries()].sort((a, b) => b[0].localeCompare(a[0]));

  const topCities = topCounts(stays.map((s) => s.property?.city));
  const topChannels = topCounts(stays.map((s) => s.stay.channel));

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Stats</h1>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Stays" value={stays.length} />
        <Stat label="Nights" value={totalNights} />
        <Stat label="Cities" value={cities.size} />
        <Stat label="Countries" value={countries.size} />
      </div>

      {years.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">
            Nights by year
          </h2>
          <div className="space-y-1">
            {years.map(([y, n]) => (
              <div key={y} className="flex items-center gap-3 text-sm">
                <span className="w-12 text-muted">{y}</span>
                <div className="h-3 flex-1 overflow-hidden rounded-full bg-surface-2">
                  <div
                    className="h-full rounded-full bg-accent"
                    style={{ width: `${(n / Math.max(...byYear.values())) * 100}%` }}
                  />
                </div>
                <span className="w-8 text-right">{n}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="grid gap-6 sm:grid-cols-2">
        {topCities.length > 0 && (
          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">
              Top cities
            </h2>
            <ul className="space-y-1 text-sm">
              {topCities.map(([c, n]) => (
                <li key={c} className="flex justify-between">
                  <span>{c}</span>
                  <span className="text-muted">{n}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {topChannels.length > 0 && (
          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">
              Booking channels
            </h2>
            <ul className="space-y-1 text-sm">
              {topChannels.map(([c, n]) => (
                <li key={c} className="flex justify-between capitalize">
                  <span>{c}</span>
                  <span className="text-muted">{n}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
