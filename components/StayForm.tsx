"use client";

import { useRouter } from "next/navigation";
import { useState, useRef } from "react";
import type { GeoResult } from "@/lib/geo/types";

const channels = ["", "booking", "expedia", "airbnb", "direct", "hotels", "other"];

export function StayForm() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeoResult[]>([]);
  const [picked, setPicked] = useState<GeoResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  function onQueryChange(v: string) {
    setQuery(v);
    setPicked(null);
    if (debounce.current) clearTimeout(debounce.current);
    if (v.trim().length < 3) {
      setResults([]);
      return;
    }
    debounce.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/geo?q=${encodeURIComponent(v)}`);
        const data = await res.json();
        setResults(data.results ?? []);
      } finally {
        setSearching(false);
      }
    }, 600); // respect Nominatim's 1 req/s policy
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);

    const property = picked
      ? {
          name: picked.name,
          address: picked.address,
          city: picked.city,
          country: picked.country,
          lat: picked.lat,
          lng: picked.lng,
          applePlaceId: picked.placeId,
          geoSource: picked.source,
        }
      : { name: query.trim() };

    if (!property.name) {
      setError("Enter or pick a hotel name.");
      return;
    }

    const totalRaw = String(fd.get("total") || "").trim();
    const body = {
      property,
      checkIn: String(fd.get("checkIn") || "") || null,
      checkOut: String(fd.get("checkOut") || "") || null,
      confirmationNo: String(fd.get("confirmationNo") || "") || null,
      roomType: String(fd.get("roomType") || "") || null,
      total: totalRaw ? Number(totalRaw) : null,
      currency: String(fd.get("currency") || "") || null,
      channel: String(fd.get("channel") || "") || null,
      notes: String(fd.get("notes") || "") || null,
    };

    setSubmitting(true);
    try {
      const res = await fetch("/api/stays", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError("Could not save stay.");
        return;
      }
      router.push("/");
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  const field =
    "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent";
  const label = "block text-xs font-medium text-muted mb-1";

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div>
        <label className={label}>Hotel</label>
        <input
          className={field}
          placeholder="Search e.g. 'Park Hyatt Tokyo'"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          autoFocus
        />
        {searching && <p className="mt-1 text-xs text-muted">Searching…</p>}
        {!picked && results.length > 0 && (
          <ul className="mt-2 divide-y divide-border overflow-hidden rounded-lg border border-border">
            {results.map((r, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => {
                    setPicked(r);
                    setQuery(r.name);
                    setResults([]);
                  }}
                  className="block w-full bg-surface px-3 py-2 text-left text-sm hover:bg-surface-2"
                >
                  <span className="font-medium">{r.name}</span>
                  <span className="block truncate text-xs text-muted">{r.address}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {picked && (
          <p className="mt-1 text-xs text-emerald-400">
            📍 {picked.address ?? picked.name}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>Check-in</label>
          <input type="date" name="checkIn" className={field} />
        </div>
        <div>
          <label className={label}>Check-out</label>
          <input type="date" name="checkOut" className={field} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>Confirmation #</label>
          <input name="confirmationNo" className={field} />
        </div>
        <div>
          <label className={label}>Channel</label>
          <select name="channel" className={field} defaultValue="">
            {channels.map((c) => (
              <option key={c} value={c}>
                {c || "—"}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-[1fr_1fr_5rem] gap-3">
        <div>
          <label className={label}>Room type</label>
          <input name="roomType" className={field} />
        </div>
        <div>
          <label className={label}>Total</label>
          <input name="total" inputMode="decimal" className={field} />
        </div>
        <div>
          <label className={label}>Currency</label>
          <input name="currency" placeholder="USD" className={field} />
        </div>
      </div>

      <div>
        <label className={label}>Notes</label>
        <textarea name="notes" rows={2} className={field} />
      </div>

      {error && <p className="text-sm text-rose-400">{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-full bg-accent py-2.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {submitting ? "Saving…" : "Save stay"}
      </button>
    </form>
  );
}
