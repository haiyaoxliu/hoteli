"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Kind = "emlx" | "gmail";

export function SyncControls() {
  const router = useRouter();
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState<Kind | null>(null);

  async function run(kind: Kind) {
    setBusy(kind);
    setStatus(`Running ${kind} import…`);
    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: kind }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus(`Error: ${data.error ?? res.status}`);
        return;
      }
      const fmt = (ms?: number | null) =>
        ms ? new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : null;
      const range =
        data.oldest && data.newest
          ? ` Looked back over emails from ${fmt(data.oldest)} to ${fmt(data.newest)}.`
          : "";
      setStatus(
        `Done: scanned ${data.scanned ?? 0}, new ${data.created ?? 0}, ` +
          `needs review ${data.review ?? 0}, not a confirmation ${data.noMatch ?? 0}.` +
          range,
      );
      router.refresh();
    } catch (e) {
      setStatus(`Error: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => run("emlx")}
          disabled={busy !== null}
          className="rounded-full border border-border bg-surface px-4 py-2 text-sm hover:bg-surface-2 disabled:opacity-50"
        >
          {busy === "emlx" ? "Scanning…" : "Backfill from Apple Mail"}
        </button>
        <button
          onClick={() => run("gmail")}
          disabled={busy !== null}
          className="rounded-full border border-border bg-surface px-4 py-2 text-sm hover:bg-surface-2 disabled:opacity-50"
        >
          {busy === "gmail" ? "Syncing…" : "Sync forwarded email"}
        </button>
      </div>
      {status && <p className="text-sm text-muted">{status}</p>}
    </div>
  );
}
