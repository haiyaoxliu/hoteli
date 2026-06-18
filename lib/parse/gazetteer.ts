/**
 * A focused city → country gazetteer for resolving hotel locations. The city is
 * very often embedded in the hotel name/subject ("Park Hyatt Guangzhou",
 * "Cordis, Hong Kong"), and adding the country makes geocoding reliable
 * ("Park Hyatt Guangzhou" → Chennai (!) vs "...Guangzhou, China" → correct).
 *
 * Not exhaustive — covers major hotel destinations. Extend from real samples
 * surfaced by `npm run debug-export`.
 */
export const CITY_COUNTRY: Record<string, string> = {
  // Greater China / HK / Asia
  "hong kong": "Hong Kong",
  kowloon: "Hong Kong",
  macau: "Macau",
  macao: "Macau",
  guangzhou: "China",
  shenzhen: "China",
  shanghai: "China",
  beijing: "China",
  chengdu: "China",
  hangzhou: "China",
  "xi'an": "China",
  taipei: "Taiwan",
  tokyo: "Japan",
  osaka: "Japan",
  kyoto: "Japan",
  seoul: "South Korea",
  singapore: "Singapore",
  bangkok: "Thailand",
  "kuala lumpur": "Malaysia",
  jakarta: "Indonesia",
  bali: "Indonesia",
  manila: "Philippines",
  "ho chi minh city": "Vietnam",
  hanoi: "Vietnam",
  "new delhi": "India",
  delhi: "India",
  mumbai: "India",
  bengaluru: "India",
  bangalore: "India",
  chennai: "India",
  dubai: "United Arab Emirates",
  "abu dhabi": "United Arab Emirates",
  doha: "Qatar",
  // Europe
  london: "United Kingdom",
  edinburgh: "United Kingdom",
  paris: "France",
  nice: "France",
  rome: "Italy",
  milan: "Italy",
  venice: "Italy",
  florence: "Italy",
  madrid: "Spain",
  barcelona: "Spain",
  lisbon: "Portugal",
  amsterdam: "Netherlands",
  berlin: "Germany",
  munich: "Germany",
  frankfurt: "Germany",
  zurich: "Switzerland",
  geneva: "Switzerland",
  vienna: "Austria",
  prague: "Czechia",
  budapest: "Hungary",
  istanbul: "Turkey",
  athens: "Greece",
  dublin: "Ireland",
  copenhagen: "Denmark",
  stockholm: "Sweden",
  oslo: "Norway",
  reykjavik: "Iceland",
  // Americas
  "buenos aires": "Argentina",
  "rio de janeiro": "Brazil",
  "sao paulo": "Brazil",
  "mexico city": "Mexico",
  cancun: "Mexico",
  "cabo san lucas": "Mexico",
  toronto: "Canada",
  vancouver: "Canada",
  montreal: "Canada",
  // Oceania / Africa
  sydney: "Australia",
  melbourne: "Australia",
  auckland: "New Zealand",
  queenstown: "New Zealand",
  "cape town": "South Africa",
  marrakech: "Morocco",
};

// Country names to detect directly in the body.
const COUNTRIES = [
  "China",
  "Hong Kong",
  "Japan",
  "Singapore",
  "Thailand",
  "Vietnam",
  "Taiwan",
  "South Korea",
  "Malaysia",
  "Indonesia",
  "Philippines",
  "India",
  "United Arab Emirates",
  "Qatar",
  "United Kingdom",
  "France",
  "Italy",
  "Spain",
  "Portugal",
  "Germany",
  "Switzerland",
  "Austria",
  "Argentina",
  "Brazil",
  "Mexico",
  "Canada",
  "Australia",
  "New Zealand",
];

const cityKeys = Object.keys(CITY_COUNTRY).sort((a, b) => b.length - a.length);

/** Find a known city (and its country) anywhere in the given text. */
export function findCityCountry(text: string): { city: string; country: string } | null {
  const t = text.toLowerCase();
  for (const key of cityKeys) {
    const re = new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (re.test(t)) {
      const proper = key.replace(/\b\w/g, (c) => c.toUpperCase());
      return { city: proper, country: CITY_COUNTRY[key] };
    }
  }
  return null;
}

/** Find a country named directly in the text (fallback when no city matches). */
export function findCountry(text: string): string | null {
  for (const c of COUNTRIES) {
    if (new RegExp(`\\b${c}\\b`, "i").test(text)) return c;
  }
  return null;
}
