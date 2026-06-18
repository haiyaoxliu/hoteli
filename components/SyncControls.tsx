"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Kind = "emlx" | "gmail";

interface SyncResult {
  scanned: number;
  created: number;
  review: number;
  noMatch: number;
  filesSeen: number;
  mailboxes: { name: string; count: number }[];
  oldest: number | null;
  newest: number | null;
  note: string | null;
  permissionDenied: boolean;
}

function fmt(ms?: number | null): string | null {
  return ms
    ? new Date(ms).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : null;
}

export function SyncControls() {
  const router = useRouter();
  const [status, setStatus] = useState<string | null>(null);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [busy, setBusy] = useState<Kind | null>(null);

  async function run(kind: Kind) {
    setBusy(kind);
    setStatus(kind === "emlx" ? "Scanning your Mail…" : "Syncing forwarded email…");
    setResult(null);
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
      setStatus(null);
      setResult(data as SyncResult);
      router.refresh();
    } catch (e) {
      setStatus(`Error: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  const range =
    result?.oldest && result?.newest
      ? `${fmt(result.oldest)} → ${fmt(result.newest)}`
      : null;
  const problem = !!result && (result.permissionDenied || result.filesSeen === 0);

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

      {result && (
        <div className="space-y-2 text-sm">
          <p>
            Scanned <b>{result.filesSeen.toLocaleString()}</b> emails
            {range ? ` (${range})` : ""} — logged <b>{result.created}</b>, to
            review <b>{result.review}</b>.
          </p>

          {result.note && (
            <p
              className={`rounded-lg border px-3 py-2 ${
                problem
                  ? "border-accent-warm/40 bg-accent-warm/10 text-accent-warm"
                  : "border-border bg-surface-2 text-muted"
              }`}
            >
              {result.note}
            </p>
          )}

          {result.mailboxes.length > 0 && (
            <details className="rounded-lg border border-border bg-surface-2 px-3 py-2">
              <summary className="cursor-pointer text-muted">
                Mailboxes scanned ({result.mailboxes.length})
              </summary>
              <ul className="mt-2 space-y-1">
                {result.mailboxes.map((m) => (
                  <li key={m.name} className="flex justify-between gap-4">
                    <span className="truncate">{m.name}</span>
                    <span className="shrink-0 text-muted">
                      {m.count.toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
