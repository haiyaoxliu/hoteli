export function nights(checkIn?: string | null, checkOut?: string | null): number | null {
  if (!checkIn || !checkOut) return null;
  const a = Date.parse(checkIn);
  const b = Date.parse(checkOut);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

export function fmtDate(d?: string | null): string {
  if (!d) return "—";
  const t = Date.parse(d);
  if (Number.isNaN(t)) return d;
  return new Date(t).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function fmtDateRange(checkIn?: string | null, checkOut?: string | null): string {
  if (!checkIn && !checkOut) return "Dates unknown";
  return `${fmtDate(checkIn)} → ${fmtDate(checkOut)}`;
}

export function fmtMoney(total?: number | null, currency?: string | null): string | null {
  if (total == null) return null;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "USD",
    }).format(total);
  } catch {
    return `${total} ${currency ?? ""}`.trim();
  }
}

/** Is the stay in the future (check-in after today)? */
export function isUpcoming(checkIn?: string | null): boolean {
  if (!checkIn) return false;
  const t = Date.parse(checkIn);
  if (Number.isNaN(t)) return false;
  return t >= Date.now() - 86_400_000; // include today
}
