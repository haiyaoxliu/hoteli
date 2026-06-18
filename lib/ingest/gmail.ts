import { google, type gmail_v1 } from "googleapis";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { users } from "../db/schema";
import { tagFromRecipient } from "./alias";
import {
  ingestMessage,
  emptySummary,
  tally,
  noteDate,
  type IngestSummary,
} from "./pipeline";

function getGmail(): gmail_v1.Gmail {
  const { GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN } = process.env;
  if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN) {
    throw new Error(
      "Gmail not configured. Set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, " +
        "GMAIL_REFRESH_TOKEN (and GMAIL_ADDRESS). See README for the one-time " +
        "OAuth setup.",
    );
  }
  const oauth = new google.auth.OAuth2(GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET);
  oauth.setCredentials({ refresh_token: GMAIL_REFRESH_TOKEN });
  return google.gmail({ version: "v1", auth: oauth });
}

function header(msg: gmail_v1.Schema$Message, name: string): string | undefined {
  const h = msg.payload?.headers?.find(
    (x) => x.name?.toLowerCase() === name.toLowerCase(),
  );
  return h?.value ?? undefined;
}

/** Walk the MIME tree, collecting decoded plaintext and raw HTML separately. */
function walkBodies(
  payload: gmail_v1.Schema$MessagePart | undefined,
  acc: { text: string; html: string },
): void {
  if (!payload) return;
  const decode = (data?: string | null) =>
    data ? Buffer.from(data, "base64url").toString("utf8") : "";

  if (payload.mimeType === "text/plain") {
    acc.text += decode(payload.body?.data) + "\n";
  } else if (payload.mimeType === "text/html") {
    acc.html += decode(payload.body?.data) + "\n";
  }
  for (const part of payload.parts ?? []) {
    if (acc.text.length + acc.html.length > 60_000) break;
    walkBodies(part, acc);
  }
}

function extractBodies(payload?: gmail_v1.Schema$MessagePart): {
  text: string;
  html: string;
} {
  const acc = { text: "", html: "" };
  walkBodies(payload, acc);
  if (!acc.text && acc.html) acc.text = acc.html.replace(/<[^>]+>/g, " ");
  return acc;
}

/** Resolve which user a message belongs to via the +tag in its recipients. */
function resolveUserId(msg: gmail_v1.Schema$Message): number | null {
  const recipients = [
    header(msg, "delivered-to"),
    header(msg, "to"),
    header(msg, "x-original-to"),
    header(msg, "x-forwarded-to"),
  ].filter(Boolean) as string[];

  for (const r of recipients) {
    const tag = tagFromRecipient(r);
    if (!tag) continue;
    const user = db.select().from(users).where(eq(users.forwardTag, tag)).get();
    if (user) return user.id;
  }
  return null;
}

const QUERY =
  "newer_than:3y (reservation OR confirmation OR booking OR itinerary OR hotel)";

/**
 * Poll the shared dummy inbox, route each message to a user by +alias, and
 * ingest. Idempotent via raw_messages (Gmail message id). Returns counts.
 */
export async function syncGmail(maxMessages = 50): Promise<IngestSummary> {
  const gmail = getGmail();
  const summary = emptySummary();

  let pageToken: string | undefined;
  let processed = 0;

  while (processed < maxMessages) {
    const list = await gmail.users.messages.list({
      userId: "me",
      q: QUERY,
      maxResults: Math.min(100, maxMessages - processed),
      pageToken,
    });
    const ids = list.data.messages ?? [];
    if (ids.length === 0) break;

    for (const { id } of ids) {
      if (!id || processed >= maxMessages) break;
      processed++;
      const full = await gmail.users.messages.get({
        userId: "me",
        id,
        format: "full",
      });
      const msg = full.data;
      const userId = resolveUserId(msg);
      if (userId == null) {
        // Couldn't route to a user (no +alias) — count as skipped.
        tally(summary, "no_match");
        continue;
      }
      const bodies = extractBodies(msg.payload);
      noteDate(summary, msg.internalDate ? Number(msg.internalDate) : null);
      const outcome = await ingestMessage({
        source: "gmail",
        externalId: `gmail:${id}`,
        userId,
        receivedAt: msg.internalDate ? Number(msg.internalDate) : undefined,
        subject: header(msg, "subject"),
        from: header(msg, "from"),
        date: header(msg, "date"),
        text: bodies.text,
        html: bodies.html || undefined,
      });
      tally(summary, outcome);
    }

    pageToken = list.data.nextPageToken ?? undefined;
    if (!pageToken) break;
  }

  return summary;
}
