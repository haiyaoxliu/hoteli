import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { listStaysForUser } from "@/lib/stays";
import { isUpcoming } from "@/lib/format";
import { StayCard } from "@/components/StayCard";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getCurrentUser();
  const all = listStaysForUser(user.id);
  const upcoming = all.filter((s) => isUpcoming(s.stay.checkIn));
  const past = all.filter((s) => !isUpcoming(s.stay.checkIn));

  if (all.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-surface p-10 text-center">
        <h2 className="text-lg font-semibold">No stays yet</h2>
        <p className="mt-1 text-sm text-muted">
          Add one manually, or backfill from your email.
        </p>
        <div className="mt-4 flex justify-center gap-3">
          <Link
            href="/stays/new"
            className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-white"
          >
            + Add a stay
          </Link>
          <Link
            href="/settings"
            className="rounded-full border border-border px-4 py-2 text-sm"
          >
            Import from email
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {upcoming.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
            Upcoming
          </h2>
          <div className="space-y-3">
            {upcoming.map((item) => (
              <StayCard key={item.stay.id} item={item} />
            ))}
          </div>
        </section>
      )}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
          History · {past.length}
        </h2>
        <div className="space-y-3">
          {past.map((item) => (
            <StayCard key={item.stay.id} item={item} />
          ))}
        </div>
      </section>
    </div>
  );
}
