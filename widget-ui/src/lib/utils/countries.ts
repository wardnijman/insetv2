export function getCountryOptions(codes: string[], locale: string = "en") {
  const regionNames = new Intl.DisplayNames([locale], { type: "region" });
  return codes
    .map(code => ({
      value: code,
      label: code === "KV" ? "Kosovo" : (regionNames.of(code) ?? code),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, locale));
}


export const EU = ["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE"];

// EU member-state territories outside the EU VAT/customs territory. They carry the member
// state's country code (carriers have no separate ISO code for them), so the only way to
// recognise them is by postal-code prefix. Shipments to/from these areas need customs
// paperwork even though the country pair looks domestic or intra-EU.
const SPECIAL_CUSTOMS_TERRITORIES: Record<string, string[]> = {
  ES: ["35", "38", "51", "52"], // Canary Islands (35xxx/38xxx), Ceuta (51xxx), Melilla (52xxx)
  FR: ["97", "984", "986", "987", "988"], // overseas departments/territories; Monaco (980xx) deliberately not matched
  DE: ["27498", "78266"], // Helgoland, Büsingen
  IT: ["23041", "22061"], // Livigno, Campione d'Italia
  GR: ["63086"], // Mount Athos
  FI: ["22"], // Åland Islands
};

export function isSpecialCustomsTerritory(country?: string | null, postalCode?: string | null): boolean {
  const prefixes = SPECIAL_CUSTOMS_TERRITORIES[String(country ?? "").trim().toUpperCase()];
  if (!prefixes) return false;
  const pc = String(postalCode ?? "").replace(/\s+/g, "");
  return !!pc && prefixes.some((p) => pc.startsWith(p));
}

// True when the address lies inside the EU customs/VAT territory — i.e. an EU country code
// AND not one of the special territories above. Use this (not a bare EU.includes) wherever
// customs/export behaviour is decided.
export function isInEUCustomsTerritory(country?: string | null, postalCode?: string | null): boolean {
  const code = String(country ?? "").trim().toUpperCase();
  return EU.includes(code) && !isSpecialCustomsTerritory(code, postalCode);
}

// TFF serves different booking forms for these territories than for the parent country's
// mainland, so the fingerprintMatrix keys them under a suffixed label (discovered with the
// territory's real postal code). The label is ONLY for fingerprint-key lookup — the address
// sent to TFF keeps the real ISO country code.
const TERRITORY_KEY_LABELS: Record<string, Array<{ prefixes: string[]; label: string }>> = {
  ES: [
    { prefixes: ["35", "38"], label: "ES-IC" }, // Canary Islands
    { prefixes: ["51"], label: "ES-CE" }, // Ceuta
    { prefixes: ["52"], label: "ES-ML" }, // Melilla
  ],
  DE: [
    { prefixes: ["27498"], label: "DE-HG" }, // Helgoland
    { prefixes: ["78266"], label: "DE-BU" }, // Büsingen
  ],
  IT: [
    { prefixes: ["23041"], label: "IT-LI" }, // Livigno
    { prefixes: ["22061"], label: "IT-CA" }, // Campione d'Italia
  ],
  GR: [{ prefixes: ["63086"], label: "GR-AT" }], // Mount Athos
  FI: [{ prefixes: ["22"], label: "FI-AX" }], // Åland (TFF has no AX country code)
};

// Country label to use when composing fingerprintMatrix keys (origin/destination slots).
export function tffRouteCountry(country?: string | null, postalCode?: string | null): string {
  const code = String(country ?? "").trim().toUpperCase();
  const entries = TERRITORY_KEY_LABELS[code];
  if (!entries) return code;
  const pc = String(postalCode ?? "").replace(/\s+/g, "");
  if (!pc) return code;
  for (const { prefixes, label } of entries) {
    if (prefixes.some((p) => pc.startsWith(p))) return label;
  }
  return code;
}

// French overseas departments/collectivities have their own ISO codes in TFF's country
// dropdown, but webshop orders often arrive as FR + a 97x/98x postal code. Booking those
// under FR yields mainland-France rates (carriers that don't even serve the territory), so
// rewrite the country to the territory's ISO code before validation/getRates. PM/MF/TF are
// not in TFF's dropdown; they'll fail validation with "unknown country", which is the
// truthful outcome (TFF cannot ship there).
const FR_OVERSEAS_BY_PREFIX: Array<[string, string]> = [
  ["971", "GP"], ["972", "MQ"], ["973", "GF"], ["974", "RE"], ["975", "PM"],
  ["976", "YT"], ["977", "BL"], ["978", "MF"], ["984", "TF"], ["986", "WF"],
  ["987", "PF"], ["988", "NC"],
];

export function canonicalShippingCountry(country?: string | null, postalCode?: string | null): string {
  const code = String(country ?? "").trim().toUpperCase();
  // Kosovo: ISO 3166-1 alpha-2 is XK, but TFF's dropdown uses the non-standard code KV.
  if (code === "XK") return "KV";
  if (code !== "FR") return code;
  const pc = String(postalCode ?? "").replace(/\s+/g, "");
  for (const [prefix, iso] of FR_OVERSEAS_BY_PREFIX) {
    if (pc.startsWith(prefix)) return iso;
  }
  return code;
}

const US_STATE_MAP: Record<string, string> = {
  "Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR",
  "California": "CA", "Colorado": "CO", "Connecticut": "CT", "Delaware": "DE",
  "Florida": "FL", "Georgia": "GA", "Hawaii": "HI", "Idaho": "ID",
  "Illinois": "IL", "Indiana": "IN", "Iowa": "IA", "Kansas": "KS",
  "Kentucky": "KY", "Louisiana": "LA", "Maine": "ME", "Maryland": "MD",
  "Massachusetts": "MA", "Michigan": "MI", "Minnesota": "MN", "Mississippi": "MS",
  "Missouri": "MO", "Montana": "MT", "Nebraska": "NE", "Nevada": "NV",
  "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY",
  "North Carolina": "NC", "North Dakota": "ND", "Ohio": "OH", "Oklahoma": "OK",
  "Oregon": "OR", "Pennsylvania": "PA", "Rhode Island": "RI", "South Carolina": "SC",
  "South Dakota": "SD", "Tennessee": "TN", "Texas": "TX", "Utah": "UT",
  "Vermont": "VT", "Virginia": "VA", "Washington": "WA", "West Virginia": "WV",
  "Wisconsin": "WI", "Wyoming": "WY", "District of Columbia": "DC"
};

// Canadian provinces (full name -> 2-letter). Lets `staat2`/region transforms resolve
// full province names the same way US states are resolved (2-letter codes pass through).
const CA_PROVINCE_MAP: Record<string, string> = {
  "Alberta": "AB", "British Columbia": "BC", "Manitoba": "MB",
  "New Brunswick": "NB", "Newfoundland and Labrador": "NL", "Northwest Territories": "NT",
  "Nova Scotia": "NS", "Nunavut": "NU", "Ontario": "ON", "Prince Edward Island": "PE",
  "Quebec": "QC", "Québec": "QC", "Saskatchewan": "SK", "Yukon": "YT",
};

export function getStateCode(stateName: string): string {
  const s = stateName.trim();
  return US_STATE_MAP[s] ?? CA_PROVINCE_MAP[s] ?? "";
}

export const countriesRequiringRegion = new Set([
    "US", "CA", "AU"
]);
