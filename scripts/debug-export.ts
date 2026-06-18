/**
 * Export real parser cases from the local Apple Mail store for debugging.
 *
 *   npm run debug-export                 # writes hoteli-debug.json
 *   npm run debug-export -- --max 80     # cap number of cases
 *
 * Captures candidates + near-misses (anything lodging/date-ish) with the raw
 * subject, sender, key headers, a body excerpt, and what the parser currently
 * extracted — enough to replay and improve the parser offline.
 *
 * PRIVACY: the output contains real email content (subjects + body excerpts).
 * Review hoteli-debug.json before sharing it.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { simpleParser } from "mailparser";
import { extractStayHeuristic, isComplete } from "../lib/parse/heuristic";
import { isBulk, pickHeadersFromLines } from "../lib/parse/headers";

const KW =
  /\b(reservation|confirmation|confirmed|booking|itinerary|check[- ]?in|check[- ]?out|your stay|hotel|resort|inn|airbnb|expedia|booking\.com|hotels?\.com|marriott|hilton|hyatt|nights?)\b/i;

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

function argVal(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const max = process.argv.includes("--all")
    ? Infinity
    : Number(argVal("--max") ?? 200);
  // Targeted extraction: pull every message matching a sender / subject-or-body
  // substring (e.g. --from amex, --match "the langham"). Bypasses the keyword
  // filter so you can grab specific emails the parser currently misses.
  const fromFilter = argVal("--from")?.toLowerCase();
  const matchFilter = argVal("--match")?.toLowerCase();
  const targeted = !!(fromFilter || matchFilter);
  const root = path.join(os.homedir(), "Library", "Mail");

  const cases: unknown[] = [];
  for (const file of walk(root)) {
    if (cases.length >= max) break;
    let raw: Buffer;
    try {
      raw = fs.readFileSync(file);
    } catch {
      continue;
    }
    const msg = emlxToRfc822(raw);
    if (!msg) continue;
    if (!targeted && !KW.test(msg.subarray(0, 8192).toString("utf8"))) continue;

    let p;
    try {
      p = await simpleParser(msg);
    } catch {
      continue;
    }
    const html = typeof p.html === "string" ? p.html : "";
    const text = p.text || html.replace(/<[^>]+>/g, " ");
    const headers = pickHeadersFromLines(p.headerLines);

    if (targeted) {
      const from = (p.from?.text ?? "").toLowerCase();
      const subj = (p.subject ?? "").toLowerCase();
      const body = text.toLowerCase();
      const ok =
        (!fromFilter || from.includes(fromFilter)) &&
        (!matchFilter || subj.includes(matchFilter) || body.includes(matchFilter));
      if (!ok) continue;
    }

    const parsed = extractStayHeuristic({
      subject: p.subject,
      from: p.from?.text,
      text,
      html: html || undefined,
      headers,
      date: p.date?.toISOString(),
    });

    // Default (non-targeted) mode: keep candidates + near-misses only.
    const nearMiss = /\b(check[- ]?in|check[- ]?out|nights?|reservation|hotel|resort)\b/i.test(
      text.slice(0, 2000),
    );
    if (!targeted && !parsed.isHotelConfirmation && !nearMiss) continue;

    cases.push({
      subject: p.subject ?? null,
      from: p.from?.text ?? null,
      date: p.date?.toISOString() ?? null,
      headers,
      bulk: isBulk(headers, p.from?.text),
      parsed,
      complete: isComplete(parsed),
      // Excerpts for offline replay (truncated).
      text: text.replace(/\s+/g, " ").slice(0, 6000),
      html: html.slice(0, 20000),
    });
  }

  const out = path.join(process.cwd(), "hoteli-debug.json");
  fs.writeFileSync(out, JSON.stringify({ exportedAt: Date.now(), cases }, null, 2));
  console.log(`Wrote ${cases.length} cases to ${out}`);
  console.log("⚠️  Contains real email content — review before sharing.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
