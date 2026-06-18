import type { ParsedStay } from "./extract";

type Channel = ParsedStay["channel"];

/**
 * Per-provider parsing profiles (Flighty-style). Each profile recognizes a
 * provider/chain by sender (and sometimes subject) and supplies provider-tuned
 * hints: the booking channel, whether it's a vacation rental, and subject
 * patterns that carry the property name. Extend these from real samples
 * gathered via `npm run debug-export`.
 */
export interface SenderProfile {
  id: string;
  channel: Channel;
  known: boolean;
  rental: boolean;
  /** Subject patterns whose group 1 is the property name. Tried in order. */
  nameFromSubject: RegExp[];
}

interface ProfileDef {
  id: string;
  match: RegExp; // tested against the From header
  channel: Channel;
  rental?: boolean;
  nameFromSubject?: RegExp[];
}

const PROFILES: ProfileDef[] = [
  {
    id: "airbnb",
    match: /airbnb/i,
    channel: "airbnb",
    rental: true,
    nameFromSubject: [
      /reservation (?:for|at)\s+(.+?)(?:,\s*[A-Za-z]{3,9}\.?\s+\d|\s*[-–|·]|$)/i,
    ],
  },
  { id: "vrbo", match: /vrbo|homeaway/i, channel: "other", rental: true },
  // Anchor OTA domains to "@…domain" / ".domain" so brand names that merely
  // contain them (e.g. "cordishotels.com") don't match the wrong profile.
  { id: "booking", match: /(?:@|\.)booking\.com/i, channel: "booking" },
  { id: "expedia", match: /(?:@|\.)expedia\./i, channel: "expedia" },
  { id: "hotels", match: /(?:@|\.)hotels\.com/i, channel: "hotels" },
  { id: "agoda", match: /(?:@|\.)agoda\./i, channel: "other" },
  {
    id: "hyatt",
    match: /hyatt/i,
    channel: "direct",
    nameFromSubject: [
      /(?:upcoming stay at|your stay at|reservation (?:details )?for your (?:upcoming )?stay at)\s+(.+?)$/i,
    ],
  },
  {
    id: "langham", // Langham Hospitality: The Langham, Cordis, Eaton
    match: /langham|cordis|eaton/i,
    channel: "direct",
    nameFromSubject: [
      /welcoming you to\s+(.+?)$/i,
      /your (?:upcoming )?stay at\s+(.+?)$/i,
    ],
  },
  {
    id: "marriott",
    match: /marriott|ritzcarlton|ritz-carlton|stregis|st-regis|westin|sheraton|courtyard/i,
    channel: "direct",
  },
  {
    id: "hilton",
    match: /hilton|waldorf|conrad|doubletree|embassysuites/i,
    channel: "direct",
  },
  { id: "ihg", match: /ihg|intercontinental|kimpton|holidayinn|crowneplaza/i, channel: "direct" },
  { id: "accor", match: /accor|sofitel|fairmont|raffles|novotel|pullman/i, channel: "direct" },
  { id: "radisson", match: /radisson/i, channel: "direct" },
  { id: "fourseasons", match: /fourseasons|four-seasons/i, channel: "direct" },
  // Card / travel intermediaries that book hotels on your behalf. The property
  // is named in the subject/body; treat as a known travel sender ("portal").
  {
    id: "amex",
    match: /amextravel|americanexpress|\bamex[_.]|aexp\.com|fine hotels|@.*\bfhr\b/i,
    channel: "portal",
    nameFromSubject: [
      /(?:reservation|stay|booking) (?:for|at)\s+(.+?)(?:\s+is\b|\s*[-–|·]|$)/i,
    ],
  },
  { id: "chase", match: /chasetravel|chase\.com|ultimate rewards/i, channel: "portal" },
  { id: "capitalone", match: /capitalone(?:travel)?\.com|capital one travel/i, channel: "portal" },
  { id: "citi", match: /thankyou\.com|citi(?:travel)?\.com|citi travel/i, channel: "portal" },
];

const GENERIC: SenderProfile = {
  id: "generic",
  channel: null,
  known: false,
  rental: false,
  nameFromSubject: [],
};

export function getProfile(from = ""): SenderProfile {
  const f = from.toLowerCase();
  for (const p of PROFILES) {
    if (p.match.test(f)) {
      return {
        id: p.id,
        channel: p.channel,
        known: true,
        rental: !!p.rental,
        nameFromSubject: p.nameFromSubject ?? [],
      };
    }
  }
  return GENERIC;
}
