/**
 * Email-header signals for separating bulk/marketing mail from transactional
 * confirmations. Marketing mail is required (Gmail/Yahoo bulk-sender rules) to
 * carry List-Unsubscribe and typically rides an ESP/campaign stream; real
 * reservation confirmations do not. This is the single strongest noise filter.
 */

// Header keys (lowercased) we keep from each message.
export const WANTED_HEADERS = [
  "list-unsubscribe",
  "list-unsubscribe-post",
  "precedence",
  "list-id",
  "feedback-id",
  "x-feedback-id",
  "x-campaign",
  "x-campaignid",
  "x-mailchimp-id",
  "x-mc-user",
  "x-mailgun-sid",
  "x-sg-eid",
  "x-csa-complaints",
  "auto-submitted",
] as const;

const WANTED = new Set<string>(WANTED_HEADERS);

/** Build the header subset from {name,value} pairs (Gmail API shape). */
export function pickHeadersFromPairs(
  pairs: { name?: string | null; value?: string | null }[] = [],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of pairs) {
    const k = (p.name ?? "").toLowerCase();
    if (WANTED.has(k) && p.value) out[k] = p.value;
  }
  return out;
}

/** Build the header subset from mailparser headerLines ({key,line}). */
export function pickHeadersFromLines(
  lines: ReadonlyArray<{ key?: string; line?: string }> = [],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of lines) {
    const k = (h.key ?? "").toLowerCase();
    if (WANTED.has(k) && h.line) {
      // line is "Key: value" — keep the value part.
      const idx = h.line.indexOf(":");
      out[k] = idx >= 0 ? h.line.slice(idx + 1).trim() : h.line;
    }
  }
  return out;
}

const MARKETING_SENDER =
  /(email\.campaign|eg\.hotels\.com|discover[_.]at[_.]|deals?[_.]at[_.]|\bmkt\.|newsletter|no-?reply\.marketing)/i;

/**
 * Is this message bulk/marketing per its headers (and sender)?
 *
 * Reliable marketing signals only. NOTE: ESP *delivery* markers (Feedback-ID,
 * X-SG-EID, X-Mailgun-SID, etc.) appear on transactional mail too — e.g. real
 * Airbnb reservation emails carry X-SG-EID — so they are deliberately NOT used.
 * List-Unsubscribe is required for marketing and exempt for transactional, which
 * makes it the cleanest separator.
 */
export function isBulk(headers: Record<string, string> = {}, from = ""): boolean {
  if (headers["list-unsubscribe"]) return true;
  if (headers["list-id"]) return true; // a mailing list
  const prec = (headers["precedence"] ?? "").toLowerCase();
  if (/bulk|list|junk/.test(prec)) return true;
  return MARKETING_SENDER.test(from);
}
