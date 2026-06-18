import type { ParseInput, ParsedStay } from "./extract";
import { extractStayAuto } from "./extract";
import { extractStayHeuristic, isComplete } from "./heuristic";

export type { ParsedStay, ParseInput } from "./extract";

export type ParserName = "heuristic" | "llm" | "none";

export interface ParseResult {
  parsed: ParsedStay | null;
  parser: ParserName;
  /** True when the result is good enough to auto-create a stay (name + check-in). */
  complete: boolean;
}

function mode(): string {
  return (process.env.PARSER ?? "auto").toLowerCase();
}

/**
 * The LLM is allowed ONLY when an API key is present AND local-only mode is off.
 * Email subject/body is sent to Anthropic only on this path — so with no key
 * (or LOCAL_ONLY=1) email content never leaves the machine. The deterministic
 * parser is 100% on-device.
 */
function llmAllowed(): boolean {
  return process.env.LOCAL_ONLY !== "1" && !!process.env.ANTHROPIC_API_KEY;
}

const TRAVELISH =
  /(reservation|booking|hotel|stay|itinerary|airbnb|expedia|booking\.com|hotels?\.com|check[- ]?in)/i;

function llmComplete(p: ParsedStay | null): boolean {
  return (
    !!p &&
    p.isHotelConfirmation &&
    !!p.hotelName &&
    !!p.checkIn &&
    !!p.checkOut &&
    !!p.confirmationNo
  );
}

function fieldScore(s: ParsedStay | null): number {
  if (!s) return -1;
  let n = 0;
  for (const k of ["hotelName", "checkIn", "checkOut", "confirmationNo", "city"] as const) {
    if (s[k]) n++;
  }
  return n;
}

/**
 * Parse a stay according to the PARSER env mode:
 *   - "heuristic": deterministic only (free/offline).
 *   - "llm": LLM only (legacy behaviour).
 *   - "auto" (default): heuristic first; escalate to the LLM only when the
 *     heuristic is incomplete, a key is set, and the message looks travel-related.
 */
export async function parseStay(input: ParseInput): Promise<ParseResult> {
  const m = mode();

  // LLM-only requested but not allowed (no key / LOCAL_ONLY): fall back to the
  // on-device parser rather than sending email content anywhere.
  if (m === "llm" && llmAllowed()) {
    const p = await extractStayAuto(input);
    return { parsed: p, parser: p ? "llm" : "none", complete: llmComplete(p) };
  }

  const h = extractStayHeuristic(input);
  if (isComplete(h)) return { parsed: h, parser: "heuristic", complete: true };

  if (m === "heuristic" || !llmAllowed()) {
    return { parsed: h, parser: "heuristic", complete: false };
  }

  // auto: escalate to the LLM only when it's allowed and the message looks
  // travel-related (avoids sending unrelated mail off-device).
  const travelish =
    h.isHotelConfirmation ||
    TRAVELISH.test(`${input.subject ?? ""} ${input.from ?? ""}`);
  if (travelish) {
    const p = await extractStayAuto(input);
    if (llmComplete(p)) return { parsed: p, parser: "llm", complete: true };
    // Keep whichever extraction has more usable fields.
    if (fieldScore(p) > fieldScore(h)) {
      return { parsed: p, parser: "llm", complete: false };
    }
  }
  return { parsed: h, parser: "heuristic", complete: false };
}
