/**
 * Offline evaluation of the deterministic parser against the local Apple Mail
 * store. No DB writes.
 *
 *   npm run parse-eval                 # precision/coverage summary
 *   npm run parse-eval -- --show       # + per-message tables
 *   npm run parse-eval -- --geo 20     # also test geocoding on N logged stays
 *
 * Requires Full Disk Access for the terminal on macOS.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { simpleParser } from "mailparser";
import { extractStayHeuristic, isComplete } from "../lib/parse/heuristic";
import { isBulk, pickHeadersFromLines } from "../lib/parse/headers";
import { geocodeBest } from "../lib/geo";
import { isRentalChannel } from "../lib/parse/heuristic";

const KW =
  /\b(reservation|confirmation|confirmed|booking|itinerary|check[- ]?in|your stay|hotel|airbnb|expedia|booking\.com|hotels?\.com|marriott|hilton|hyatt)\b/i;

function emlxToRfc822(buf: Buffer): Buffer | null {
  const nl = buf.indexOf(0x0a);
  if (nl < 0) return null;
  const n = parseInt(buf.subarray(0, nl).toString("ascii").trim(), 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return buf.subarray(nl + 1, nl + 1 + n);
}
function* walk(root: string): Generator<string> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(root, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (e.isFile() && e.name.endsWith(".emlx")) yield full;
  }
}

async function main() {
  const show = process.argv.includes("--show");
  const geoIdx = process.argv.indexOf("--geo");
  const geoN = geoIdx >= 0 ? Number(process.argv[geoIdx + 1] || 20) : 0;
  const root = path.join(os.homedir(), "Library", "Mail");

  let candidates = 0,
    rejectedBulk = 0,
    rejectedOther = 0,
    logged = 0,
    review = 0;
  const loggedRows: string[] = [];
  const reviewRows: string[] = [];
  const loggedStays: ReturnType<typeof extractStayHeuristic>[] = [];

  for (const file of walk(root)) {
    let raw: Buffer;
    try {
      raw = fs.readFileSync(file);
    } catch {
      continue;
    }
    const msg = emlxToRfc822(raw);
    if (!msg) continue;
    if (!KW.test(msg.subarray(0, 8192).toString("utf8"))) continue;
    candidates++;

    let p;
    try {
      p = await simpleParser(msg);
    } catch {
      continue;
    }
    const html = typeof p.html === "string" ? p.html : "";
    const text = p.text || html.replace(/<[^>]+>/g, " ");
    const headers = pickHeadersFromLines(p.headerLines);
    const s = extractStayHeuristic({
      subject: p.subject,
      from: p.from?.text,
      text,
      html: html || undefined,
      headers,
      date: p.date?.toISOString(),
    });

    if (!s.isHotelConfirmation) {
      if (isBulk(headers, p.from?.text)) rejectedBulk++;
      else rejectedOther++;
      continue;
    }
    const row = `${(p.subject || "").slice(0, 40).padEnd(40)} | ${(s.hotelName || "-").slice(0, 22).padEnd(22)} | ${s.checkIn || "-"}→${s.checkOut || "-"} | ${(s.address || "-").slice(0, 28)}`;
    if (isComplete(s)) {
      logged++;
      loggedStays.push(s);
      if (loggedRows.length < 40) loggedRows.push(row);
    } else {
      review++;
      if (reviewRows.length < 40) reviewRows.push(row);
    }
  }

  console.log("=== Parser eval (local Apple Mail) ===");
  console.log(`keyword candidates:   ${candidates}`);
  console.log(`rejected (bulk/mktg): ${rejectedBulk}`);
  console.log(`rejected (other):     ${rejectedOther}`);
  console.log(`LOGGED (complete):    ${logged}`);
  console.log(`review (incomplete):  ${review}`);

  if (show) {
    console.log("\n--- LOGGED ---\n  subject | name | dates | address");
    loggedRows.forEach((r) => console.log("  " + r));
    console.log("\n--- REVIEW ---");
    reviewRows.forEach((r) => console.log("  " + r));
  }

  if (geoN > 0) {
    console.log(`\n=== Geocoding test (first ${geoN} logged) ===`);
    let hit = 0;
    const sample = loggedStays.slice(0, geoN);
    for (const s of sample) {
      const g = await geocodeBest({
        address: s.address,
        name: s.hotelName,
        city: s.city,
        country: s.country,
        rental: isRentalChannel(s.channel),
      });
      if (g) hit++;
      console.log(
        `  ${g ? "✓" : "✗"} ${(s.hotelName || s.address || "?").slice(0, 34).padEnd(34)} ${g ? `(${g.source})` : ""}`,
      );
    }
    console.log(`geo hit-rate: ${hit}/${sample.length}`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
