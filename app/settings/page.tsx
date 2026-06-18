import { getCurrentUser } from "@/lib/auth";
import { forwardingAddress } from "@/lib/ingest/alias";
import { SyncControls } from "@/components/SyncControls";

export const dynamic = "force-dynamic";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
        {title}
      </h2>
      {children}
    </section>
  );
}

export default async function SettingsPage() {
  const user = await getCurrentUser();
  const alias = forwardingAddress(user.forwardTag);
  const geoProvider = process.env.GEO_PROVIDER ?? "nominatim";

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">Settings</h1>

      <Section title="Account">
        <p className="text-sm">
          Signed in as <span className="font-medium">{user.displayName ?? user.tsLogin}</span>
        </p>
        <p className="text-xs text-muted">{user.tsLogin} · via Tailscale</p>
      </Section>

      <Section title="Your forwarding address">
        <p className="text-sm text-muted">
          Forward hotel confirmation emails here. The importer attributes them to you
          automatically via the <code>+tag</code>.
        </p>
        <p className="mt-2 select-all rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm">
          {alias}
        </p>
      </Section>

      <Section title="Import history">
        <p className="mb-3 text-sm text-muted">
          Backfill scans Apple Mail on this Mac for past confirmations. Sync pulls
          newly forwarded email.
        </p>
        <SyncControls />
      </Section>

      <Section title="Map data">
        <p className="text-sm">
          Geocoding provider: <span className="font-medium capitalize">{geoProvider}</span>
        </p>
        <p className="text-xs text-muted">
          Set <code>GEO_PROVIDER=applemaps</code> after adding an Apple Developer Maps key.
        </p>
      </Section>
    </div>
  );
}
