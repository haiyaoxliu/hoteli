import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { simpleParser } from "mailparser";
import {
  ingestMessage,
  emptySummary,
  tally,
  noteDate,
  recountReview,
  type IngestSummary,
} from "./pipeline";

// Heuristics to pre-filter candidate confirmations cheaply (before any LLM call).
const KEYWORDS =
  /\b(reservation|confirmation|confirmed|booking|itinerary|check[- ]?in|your stay|booking\.com|expedia|hotels?\.com|airbnb|marriott|hilton|hyatt|ihg|accor|radisson|wyndham|best western)\b/i;

/**
 * Decode an Apple Mail .emlx file into a raw RFC822 message buffer.
 * Format: "<byteCount>\n" + <message bytes> + <plist trailer>.
 */
function emlxToRfc822(buf: Buffer): Buffer | null {
  const nl = buf.indexOf(0x0a);
  if (nl < 0) return null;
  const n = parseInt(buf.subarray(0, nl).toString("ascii").trim(), 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return buf.subarray(nl + 1, nl + 1 + n);
}

/** Cheap Date-header read (no full MIME parse) for the scan-range window. */
function dateFromHead(head: string): number | null {
  const m = /^Date:\s*(.+)$/im.exec(head);
  if (!m) return null;
  const t = Date.parse(m[1].trim());
  return Number.isNaN(t) ? null : t;
}

function* walkEmlx(root: string): Generator<string> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return; // unreadable dir (permissions) — skip
  }
  for (const e of entries) {
    const full = path.join(root, e.name);
    if (e.isDirectory()) {
      yield* walkEmlx(full);
    } else if (e.isFile() && e.name.endsWith(".emlx")) {
      yield full;
    }
  }
}

export interface EmlxOptions {
  /** Mail root(s); defaults to ~/Library/Mail. */
  roots?: string[];
  /** Max candidate messages to LLM-parse (cost guard). */
  maxCandidates?: number;
  onProgress?: (s: IngestSummary) => void;
}

/**
 * Backfill stays for a user from the local Apple Mail store. Requires Full Disk
 * Access for the runtime on macOS. Idempotent — re-running skips seen messages.
 *
 * NOTE: this reads the local machine's mailbox, so it attributes stays to the
 * triggering user (in practice the Mac owner). Other users should forward to
 * their Gmail alias instead.
 */
export async function backfillFromAppleMail(
  userId: number,
  opts: EmlxOptions = {},
): Promise<IngestSummary> {
  const roots = opts.roots ?? [path.join(os.homedir(), "Library", "Mail")];
  const max = opts.maxCandidates ?? 500;
  const summary = emptySummary();
  let candidates = 0;

  for (const root of roots) {
    for (const file of walkEmlx(root)) {
      let raw: Buffer;
      try {
        raw = fs.readFileSync(file);
      } catch {
        continue;
      }
      const msg = emlxToRfc822(raw);
      if (!msg) continue;

      const head = msg.subarray(0, 8192).toString("utf8");
      // Record the date of every scanned message so the range reflects the full
      // mailbox window the parser looked at (even messages we don't ingest).
      noteDate(summary, dateFromHead(head));

      // Cheap pre-filter on the raw header/body text before full parse + LLM.
      if (!KEYWORDS.test(head)) continue;
      // Past the candidate cap: keep scanning for the date range, skip the
      // expensive parse + LLM.
      if (candidates >= max) continue;

      let parsed;
      try {
        parsed = await simpleParser(msg);
      } catch {
        continue;
      }
      candidates++;

      const externalId = parsed.messageId ?? `emlx:${file}`;
      const html = typeof parsed.html === "string" ? parsed.html : "";
      const text = parsed.text || html.replace(/<[^>]+>/g, " ") || "";
      const outcome = await ingestMessage({
        source: "emlx",
        externalId,
        userId,
        receivedAt: parsed.date ? parsed.date.getTime() : undefined,
        subject: parsed.subject,
        from: parsed.from?.text,
        date: parsed.date?.toISOString(),
        text,
        html: html || undefined,
      });
      tally(summary, outcome);
      opts.onProgress?.(summary);
    }
  }
  recountReview(summary, userId); // reflect reservations merged out of review
  return summary;
}
