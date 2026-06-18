/**
 * Offline evaluation of the deterministic parser against the local Apple Mail
 * store. No LLM, no DB writes — just measures coverage and gate behaviour.
 *
 *   npm run parse-eval            # summary
 *   npm run parse-eval -- --show  # + per-message table
 *
 * Requires Full Disk Access for the terminal on macOS.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { simpleParser } from "mailparser";
import { extractStayHeuristic } from "../lib/parse/heuristic";

const KW =
  /\b(reservation|confirmation|confirmed|booking|itinerary|check[- ]?in|your stay|booking\.com|expedia|hotels?\.com|airbnb|marriott|hilton|hyatt|ihg|accor)\b/i;

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
  const root = path.join(os.homedir(), "Library", "Mail");

  let candidates = 0,
    gatePass = 0,
    complete = 0,
    nameHit = 0,
    dateHit = 0,
    confHit = 0,
    rejected = 0;
  const rows: string[] = [];

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

    let parsed;
    try {
      parsed = await simpleParser(msg);
    } catch {
      continue;
    }
    const html = typeof parsed.html === "string" ? parsed.html : "";
    const text = parsed.text || html.replace(/<[^>]+>/g, " ");
    const s = extractStayHeuristic({
      subject: parsed.subject,
      from: parsed.from?.text,
      text,
      html: html || undefined,
    });

    if (!s.isHotelConfirmation) {
      rejected++;
    } else {
      gatePass++;
      if (s.hotelName) nameHit++;
      if (s.checkIn) dateHit++;
      if (s.confirmationNo) confHit++;
      if (s.hotelName && s.checkIn && s.checkOut && s.confirmationNo) complete++;
    }

    if (show && (s.isHotelConfirmation || /reservation|confirmed|booking/i.test(parsed.subject || ""))) {
      rows.push(
        [
          (s.isHotelConfirmation ? "✓" : "✗").padEnd(2),
          (parsed.subject || "").slice(0, 44).padEnd(44),
          (s.hotelName || "-").slice(0, 24).padEnd(24),
          (s.checkIn || "-").padEnd(10),
          (s.confirmationNo || "-").slice(0, 12).padEnd(12),
          s.channel || "-",
        ].join(" | "),
      );
    }
  }

  console.log("=== Deterministic parser eval (local Apple Mail) ===");
  console.log(`keyword candidates:        ${candidates}`);
  console.log(`gate: confirmation:        ${gatePass}   rejected (promo/other): ${rejected}`);
  console.log(`of confirmations:`);
  console.log(`  hotel name extracted:    ${nameHit}/${gatePass}`);
  console.log(`  check-in date extracted: ${dateHit}/${gatePass}`);
  console.log(`  confirmation # extracted:${confHit}/${gatePass}`);
  console.log(`  complete (name+dates+conf):${complete}/${gatePass}  -> eligible to log (still needs a geocode hit at ingest)`);
  console.log(`  -> needs manual review:  ${gatePass - complete}`);
  if (show) {
    console.log("\n gate | subject | hotel | check-in | conf | channel");
    rows.slice(0, 40).forEach((r) => console.log("  " + r));
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
