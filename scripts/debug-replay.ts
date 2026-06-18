/**
 * Replay exported debug cases through the current parser, to iterate offline.
 *
 *   npm run debug-replay -- hoteli-debug.json          # parse summary + table
 *   npm run debug-replay -- hoteli-debug.json --geo    # also test geocoding
 *
 * Pair with debug-export (run on a tester's machine). This lets us improve the
 * parser against real failing cases without their live mailbox.
 */
import fs from "node:fs";
import { extractStayHeuristic, isComplete, isRentalChannel } from "../lib/parse/heuristic";
import { isBulk } from "../lib/parse/headers";
import { geocodeBest } from "../lib/geo";

interface DebugCase {
  subject: string | null;
  from: string | null;
  date: string | null;
  headers: Record<string, string>;
  text: string;
  html: string;
}

async function main() {
  const fileArg = process.argv[2];
  const doGeo = process.argv.includes("--geo");
  if (!fileArg) {
    console.error("Usage: npm run debug-replay -- <hoteli-debug.json> [--geo]");
    process.exit(1);
  }
  const { cases } = JSON.parse(fs.readFileSync(fileArg, "utf8")) as { cases: DebugCase[] };

  let logged = 0,
    review = 0,
    rejected = 0;
  const logRows: { c: DebugCase; s: ReturnType<typeof extractStayHeuristic> }[] = [];

  for (const c of cases) {
    const s = extractStayHeuristic({
      subject: c.subject ?? undefined,
      from: c.from ?? undefined,
      text: c.text,
      html: c.html || undefined,
      headers: c.headers,
      date: c.date ?? undefined,
    });
    if (!s.isHotelConfirmation) {
      rejected++;
      continue;
    }
    if (isComplete(s)) {
      logged++;
      logRows.push({ c, s });
    } else {
      review++;
    }
    const nights =
      s.checkIn && s.checkOut
        ? Math.round((Date.parse(s.checkOut) - Date.parse(s.checkIn)) / 86_400_000)
        : "?";
    console.log(
      `[${isComplete(s) ? "LOG" : "REV"}] ${(c.subject || "").slice(0, 42).padEnd(42)} | ` +
        `${(s.hotelName || "-").slice(0, 22).padEnd(22)} | ${s.checkIn || "-"}→${s.checkOut || "-"} (${nights}n) | ` +
        `${(s.city || "-")}/${s.country || "-"} | conf:${s.confirmationNo || "-"}${isBulk(c.headers, c.from ?? "") ? " [bulk]" : ""}`,
    );
  }

  console.log(`\ncases:${cases.length}  logged:${logged}  review:${review}  rejected:${rejected}`);

  if (doGeo) {
    console.log("\n=== geocoding (logged) ===");
    let hit = 0;
    for (const { s } of logRows) {
      const g = await geocodeBest({
        address: s.address,
        name: s.hotelName,
        city: s.city,
        country: s.country,
        rental: isRentalChannel(s.channel),
      });
      if (g) hit++;
      console.log(
        `  ${g ? "✓" : "✗"} ${(s.hotelName || s.address || "?").slice(0, 30).padEnd(30)} ${g ? `→ ${g.city || g.name} (${g.lat.toFixed(2)},${g.lng.toFixed(2)})` : ""}`,
      );
    }
    console.log(`geo hit-rate: ${hit}/${logRows.length}`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
