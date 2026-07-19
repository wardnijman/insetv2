// Geport uit v1 src/lib/utils/regionGroups.ts. Wijzigingen: geen (pure data + helpers).
// v1-notitie blijft gelden: mirror van plugship-client-app/src/lib/utils/regionGroups.ts.
// Gebruikt door de automationApplier bij het evalueren van `region`-matchers.

export type RegionKey =
  | "europe"
  | "eu"
  | "non_eu"
  | "north_america"
  | "south_america"
  | "asia"
  | "africa"
  | "oceania";

export const EU_COUNTRIES = [
  "AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU","IE","IT",
  "LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE",
] as const;

const EUROPE_EXTRA = [
  "GB","NO","CH","IS","LI","MC","AD","SM","VA",
  "AL","BA","BY","MD","ME","MK","RS","UA","RU","KV",
];

const NORTH_AMERICA = [
  "US","CA","MX",
  "GT","BZ","SV","HN","NI","CR","PA",
  "CU","JM","HT","DO","PR","BS","BB","TT","DM","GD","KN","LC","VC","AG",
];

const SOUTH_AMERICA = [
  "AR","BO","BR","CL","CO","EC","GY","PY","PE","SR","UY","VE","FK","GF",
];

const ASIA = [
  "CN","JP","KR","KP","MN","HK","MO","TW",
  "IN","PK","BD","LK","NP","BT","MV",
  "ID","TH","VN","PH","MY","SG","MM","KH","LA","BN","TL",
  "AF","KZ","KG","TJ","TM","UZ",
  "IR","IQ","IL","SY","JO","LB","SA","AE","QA","BH","OM","YE","KW","TR","CY","PS","AM","AZ","GE",
];

const AFRICA = [
  "DZ","AO","BJ","BW","BF","BI","CM","CV","CF","TD","KM","CG","CD","CI","DJ","EG","GQ","ER","SZ","ET",
  "GA","GM","GH","GN","GW","KE","LS","LR","LY","MG","MW","ML","MR","MU","MA","MZ","NA","NE","NG","RW",
  "ST","SN","SC","SL","SO","ZA","SS","SD","TZ","TG","TN","UG","ZM","ZW","EH",
];

const OCEANIA = [
  "AU","NZ","FJ","PG","SB","NC","PF","WS","TO","VU","KI","MH","FM","NR","PW","TV","CK","NU","TK","WF",
];

const REGION_LISTS: Record<Exclude<RegionKey, "non_eu">, readonly string[]> = {
  europe: [...EU_COUNTRIES, ...EUROPE_EXTRA],
  eu: [...EU_COUNTRIES],
  north_america: NORTH_AMERICA,
  south_america: SOUTH_AMERICA,
  asia: ASIA,
  africa: AFRICA,
  oceania: OCEANIA,
};

export const REGION_OPTIONS: Array<{ value: RegionKey; label: string }> = [
  { value: "europe",        label: "Europa" },
  { value: "eu",            label: "EU" },
  { value: "non_eu",        label: "Buiten EU" },
  { value: "north_america", label: "Noord-Amerika" },
  { value: "south_america", label: "Zuid-Amerika" },
  { value: "asia",          label: "Azië" },
  { value: "africa",        label: "Afrika" },
  { value: "oceania",       label: "Oceanië" },
];

export function countryInRegion(country: string | undefined | null, region: RegionKey): boolean {
  const c = String(country ?? "").trim().toUpperCase();
  if (!c) return false;
  if (region === "non_eu") return !EU_COUNTRIES.includes(c as any);
  const list = REGION_LISTS[region];
  return Array.isArray(list) && list.includes(c);
}

export function isRegionKey(value: unknown): value is RegionKey {
  return (
    typeof value === "string" &&
    (value === "europe" ||
      value === "eu" ||
      value === "non_eu" ||
      value === "north_america" ||
      value === "south_america" ||
      value === "asia" ||
      value === "africa" ||
      value === "oceania")
  );
}
