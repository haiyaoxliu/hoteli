import type { ParsedStay } from "./extract";

type Channel = ParsedStay["channel"];

export interface SenderProfile {
  channel: Channel;
  /** A recognized travel/lodging sender domain (OTA or hotel chain). */
  known: boolean;
  /** A vacation-rental platform (listing title won't geocode; use the address). */
  rental: boolean;
}

const KNOWN: { re: RegExp; channel: Channel; rental?: boolean }[] = [
  { re: /airbnb\.com|airbnb\b/i, channel: "airbnb", rental: true },
  { re: /vrbo\.com|homeaway/i, channel: "other", rental: true },
  { re: /booking\.com/i, channel: "booking" },
  { re: /expedia\b/i, channel: "expedia" },
  { re: /hotels\.com/i, channel: "hotels" },
  { re: /agoda\b/i, channel: "other" },
  {
    re: /(marriott|hilton|hyatt|ihg|accor|radisson|wyndham|bestwestern|best-western|choicehotels|fourseasons|hotelbeds|sonder|selina|kimpton|fairmont|sofitel|intercontinental)/i,
    channel: "direct",
  },
];

/** Classify the sending domain into a booking channel. */
export function senderProfile(from = ""): SenderProfile {
  const f = from.toLowerCase();
  for (const k of KNOWN) {
    if (k.re.test(f)) return { channel: k.channel, known: true, rental: !!k.rental };
  }
  return { channel: null, known: false, rental: false };
}
