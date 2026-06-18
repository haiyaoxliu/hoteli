"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ReviewItem } from "@/lib/review";

const field =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent";
const label = "block text-xs font-medium text-muted mb-1";

function Card({ item, onDone }: { item: ReviewItem; onDone: (id: number) => void }) {
  const p = item.partial ?? {};
  const [name, setName] = useState(p.hotelName ?? "");
  const [city, setCity] = useState(p.city ?? "");
  const [country, setCountry] = useState(p.country ?? "");
  const [checkIn, setCheckIn] = useState(p.checkIn ?? "");
  const [checkOut, setCheckOut] = useState(p.checkOut ?? "");
  const [conf, setConf] = useState(p.confirmationNo ?? "");
  const [busy, setBusy] = useState<"add" | "dismiss" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    if (!name.trim()) {
      setError("Hotel name is required.");
      return;
    }
    setBusy("add");
    setError(null);
    const res = await fetch(`/api/review/${item.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        city: city || null,
        country: country || null,
        checkIn: checkIn || null,
        checkOut: checkOut || null,
        confirmationNo: conf || null,
        channel: p.channel ?? null,
      }),
    });
    if (res.ok) onDone(item.id);
    else {
      setError("Could not add.");
      setBusy(null);
    }
  }

  async function dismiss() {
    setBusy("dismiss");
    const res = await fetch(`/api/review/${item.id}`, { method: "DELETE" });
    if (res.ok) onDone(item.id);
    else setBusy(null);
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="mb-3">
        <p className="truncate text-sm font-medium">{item.subject ?? "(no subject)"}</p>
        <p className="truncate text-xs text-muted">{item.sender ?? ""}</p>
      </div>

      <div className="space-y-3">
        <div>
          <label className={label}>Hotel</label>
          <input className={field} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>City</label>
            <input className={field} value={city} onChange={(e) => setCity(e.target.value)} />
          </div>
          <div>
            <label className={label}>Country</label>
            <input
              className={field}
              value={country}
              onChange={(e) => setCountry(e.target.value)}
            />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={label}>Check-in</label>
            <input
              type="date"
              className={field}
              value={checkIn}
              onChange={(e) => setCheckIn(e.target.value)}
            />
          </div>
          <div>
            <label className={label}>Check-out</label>
            <input
              type="date"
              className={field}
              value={checkOut}
              onChange={(e) => setCheckOut(e.target.value)}
            />
          </div>
          <div>
            <label className={label}>Confirmation</label>
            <input className={field} value={conf} onChange={(e) => setConf(e.target.value)} />
          </div>
        </div>
      </div>

      {error && <p className="mt-2 text-sm text-rose-400">{error}</p>}

      <div className="mt-4 flex gap-3">
        <button
          onClick={add}
          disabled={busy !== null}
          className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy === "add" ? "Adding…" : "Add stay"}
        </button>
        <button
          onClick={dismiss}
          disabled={busy !== null}
          className="rounded-full border border-border px-4 py-2 text-sm text-muted hover:text-foreground disabled:opacity-50"
        >
          {busy === "dismiss" ? "Dismissing…" : "Dismiss"}
        </button>
      </div>
    </div>
  );
}

export function ReviewList({ items }: { items: ReviewItem[] }) {
  const router = useRouter();
  const [done, setDone] = useState<Set<number>>(new Set());

  function markDone(id: number) {
    setDone((prev) => new Set(prev).add(id));
    router.refresh();
  }

  const remaining = items.filter((i) => !done.has(i.id));
  return (
    <div className="space-y-4">
      {remaining.map((item) => (
        <Card key={item.id} item={item} onDone={markDone} />
      ))}
    </div>
  );
}
