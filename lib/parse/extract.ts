import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

/**
 * Structured extraction of a hotel stay from a confirmation email.
 * Default model is Haiku 4.5 (cheap, high-volume); callers may escalate the
 * model for low-confidence results.
 */
const StaySchema = z.object({
  isHotelConfirmation: z
    .boolean()
    .describe("True only if this email confirms/modifies a hotel/lodging stay."),
  hotelName: z.string().nullable().describe("Hotel/property name, no city."),
  brand: z.string().nullable().describe("Chain/brand, e.g. Marriott, Hilton."),
  address: z.string().nullable(),
  city: z.string().nullable(),
  country: z.string().nullable(),
  checkIn: z.string().nullable().describe("Check-in date as YYYY-MM-DD."),
  checkOut: z.string().nullable().describe("Check-out date as YYYY-MM-DD."),
  confirmationNo: z.string().nullable(),
  roomType: z.string().nullable(),
  total: z.number().nullable().describe("Total amount paid/charged, numeric."),
  currency: z.string().nullable().describe("ISO currency code, e.g. USD, EUR."),
  channel: z
    .enum(["booking", "expedia", "airbnb", "hotels", "direct", "other"])
    .nullable()
    .describe("Booking channel."),
  confidence: z.number().describe("0..1 confidence in this extraction."),
});

export type ParsedStay = z.infer<typeof StaySchema>;

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic(); // reads ANTHROPIC_API_KEY
  return client;
}

const SYSTEM = `You extract structured hotel-stay records from emails (booking
confirmations, itineraries, receipts) that may come from OTAs (Booking.com,
Expedia, Hotels.com, Airbnb) or directly from hotels/chains. Return null for any
field you cannot determine with confidence. Dates must be ISO YYYY-MM-DD. If the
email is not a lodging confirmation (flight, car, newsletter, marketing, generic
receipt), set isHotelConfirmation=false and leave other fields null.`;

export interface ParseInput {
  subject?: string;
  from?: string;
  date?: string;
  text: string;
  /** Raw HTML body, when available. Used by the heuristic parser; LLM ignores it. */
  html?: string;
  /**
   * Lowercased subset of email headers used to detect bulk/marketing mail
   * (list-unsubscribe, precedence, list-id, feedback-id, x-campaign, etc.).
   * Used by the heuristic parser; the LLM ignores it.
   */
  headers?: Record<string, string>;
}

/**
 * Extract a stay. Returns null on hard failure. `model` defaults to Haiku 4.5;
 * pass "claude-opus-4-8" to escalate.
 */
export async function extractStay(
  input: ParseInput,
  model = "claude-haiku-4-5",
): Promise<ParsedStay | null> {
  // Cap the body so a giant HTML email can't blow the context/cost.
  const body = input.text.slice(0, 24_000);
  const userContent = [
    input.subject ? `Subject: ${input.subject}` : null,
    input.from ? `From: ${input.from}` : null,
    input.date ? `Date: ${input.date}` : null,
    "",
    body,
  ]
    .filter((l) => l !== null)
    .join("\n");

  try {
    const res = await getClient().messages.parse({
      model,
      max_tokens: 2000,
      system: SYSTEM,
      messages: [{ role: "user", content: userContent }],
      output_config: { format: zodOutputFormat(StaySchema) },
    });
    return res.parsed_output ?? null;
  } catch (err) {
    console.error("extractStay failed:", (err as Error).message);
    return null;
  }
}

/**
 * Extract with auto-escalation: try Haiku first; if it's unsure (low confidence
 * but thinks it's a confirmation), retry once on Opus for a better read.
 */
export async function extractStayAuto(input: ParseInput): Promise<ParsedStay | null> {
  const first = await extractStay(input);
  if (first && first.isHotelConfirmation && first.confidence < 0.6) {
    const second = await extractStay(input, "claude-opus-4-8");
    if (second) return second;
  }
  return first;
}
