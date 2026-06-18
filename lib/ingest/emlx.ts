import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { simpleParser } from "mailparser";
import { pickHeadersFromLines } from "../parse/headers";
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

interface WalkState {
  permissionDenied: boolean;
}

function* walkEmlx(root: string, state: WalkState): Generator<string> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "EPERM" || code === "EACCES") state.permissionDenied = true;
    return; // unreadable dir — skip
  }
  for (const e of entries) {
    const full = path.join(root, e.name);
    if (e.isDirectory()) {
      yield* walkEmlx(full, state);
    } else if (e.isFile() && e.name.endsWith(".emlx")) {
      yield full;
    }
  }
}

/** Derive a readable mailbox label from a .emlx path, e.g. "[Gmail]/All Mail". */
function mailboxLabel(file: string): string {
  const parts = file.split(path.sep);
  const boxes = parts
    .filter((p) => p.endsWith(".mbox"))
    .map((p) => p.slice(0, -".mbox".length));
  return boxes.length ? boxes.join("/") : "(unknown)";
}

export interface EmlxOptions {
  /** Mail root(s); defaults to ~/Library/Mail. */
  roots?: string[];
  /** Max candidate messages to fully parse (cost guard for LLM mode). */
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
  const max = opts.maxCandidates ?? 5000;
  const summary = emptySummary();
  const state: WalkState = { permissionDenied: false };
  const boxCounts = new Map<string, number>();
  let candidates = 0;
  let anyRootExists = false;

  for (const root of roots) {
    // Distinguish "Mail not set up" (ENOENT) from "no Full Disk Access" (EPERM)
    // at the top level, before walking.
    try {
      fs.readdirSync(root);
      anyRootExists = true;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "EPERM" || code === "EACCES") state.permissionDenied = true;
      continue;
    }

    for (const file of walkEmlx(root, state)) {
      summary.filesSeen++;
      boxCounts.set(mailboxLabel(file), (boxCounts.get(mailboxLabel(file)) ?? 0) + 1);

      let raw: Buffer;
      try {
        raw = fs.readFileSync(file);
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (code === "EPERM" || code === "EACCES") state.permissionDenied = true;
        continue;
      }
      const msg = emlxToRfc822(raw);
      if (!msg) continue;

      const head = msg.subarray(0, 8192).toString("utf8");
      // Record the date of every scanned message so the range reflects the full
      // mailbox window the parser looked at (even messages we don't ingest).
      noteDate(summary, dateFromHead(head));

      // Cheap pre-filter on the raw header/body text before full parse.
      if (!KEYWORDS.test(head)) continue;
      // Past the candidate cap: keep scanning for the range, skip the expensive
      // parse (only relevant in LLM mode; heuristic mode uses a very high cap).
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
        headers: pickHeadersFromLines(parsed.headerLines),
      });
      tally(summary, outcome);
      opts.onProgress?.(summary);
    }
  }

  recountReview(summary, userId); // reflect reservations merged out of review
  summary.permissionDenied = state.permissionDenied;
  summary.mailboxes = [...boxCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  // Explain the outcome — especially zero results.
  if (state.permissionDenied && summary.filesSeen === 0) {
    summary.note =
      "Couldn't read your Mail folder. Grant Full Disk Access to your terminal " +
      "(System Settings → Privacy & Security → Full Disk Access), then fully quit " +
      "and reopen it and run this again.";
  } else if (!anyRootExists) {
    summary.note =
      "No Mail app data found (~/Library/Mail). Add your email account to the " +
      "macOS Mail app and let it finish downloading, then try again.";
  } else if (summary.filesSeen === 0) {
    summary.note =
      "No messages found in the Mail app yet. If you just added your account, " +
      "open Mail and let it finish downloading your email (for Gmail, make sure " +
      "'All Mail' is syncing), then try again.";
  } else if (summary.scanned === 0) {
    summary.note = `Scanned ${summary.filesSeen} emails but found no hotel confirmations.`;
  } else if (summary.created === 0 && summary.review > 0) {
    summary.note = `Found ${summary.review} possible stay(s) that need review.`;
  }

  return summary;
}
