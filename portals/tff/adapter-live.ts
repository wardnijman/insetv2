// LIVE TFF adapter — implements the portal-agnostic PortalAuthAdapter contract
// (src/runtime/adapter.ts) with a REAL fetch transport against tffxpress.com.
//
// Mirrors portals/tff/adapter.ts (the mock) exactly at the interface level:
// login() / submit() / isLoggedOut(). The only difference is the transport.
//
//   login()  -> loginAndWarm (GET /login -> CSRF -> POST /login -> warm /versturen)
//   submit(session,"getRates",payload) -> POST /versturen + GET ?s=2 + parse rates
//
// The `payload` submit receives is the transformed TFF wizard field dict, produced
// by transformGetRatesInput() below (a port of v1's getRates.ts transform block).
//
// READ-ONLY: login + getRates only. Never books.

import type { PortalAuthAdapter, Session, PortalResponse } from "../../src/runtime/adapter.ts";
import { loginAndWarm, fetchRates } from "./tff-live-transport.ts";
import landPcFormat from "./land-pcformat.json" with { type: "json" };

const BASE = "https://tffxpress.com";

// Credentials come from the environment (loaded from ~/inset/.env by the runner).
function creds(): { user: string; pass: string } {
  const user = process.env.TFF_EMAIL;
  const pass = process.env.TFF_PASS;
  if (!user || !pass) throw new Error("TFF_EMAIL / TFF_PASS not set in environment");
  return { user, pass };
}

// ---------------------------------------------------------------------------
// Transform: canonical shipment input -> TFF /versturen wizard field dict.
// Faithful port of the transform block in v1 getRates.ts (+ its transform helpers).
// ---------------------------------------------------------------------------
type Addr = {
  country: string;
  street: string[];
  city: string;
  region?: string;
  postalCode: string;
  company?: string;
  [k: string]: any;
};
type Pkg = { type: "package" | "pallet" | "document"; length: number; width: number; height: number; weight: number; stackable?: boolean };

const _1To1 = (v: string) => v;
const _1To1OrDash = (v: string) => (!v || v === "" ? "-" : v);
const onlyAlphanumeric = (v: any) => String(v).replace(/[^\w]/g, "");
const geenToNoString = (v: string) => (v === "geen" ? "" : v);

function selectLandValueToDataPcformat(country: string): string {
  const f = (landPcFormat as Record<string, string>)[country];
  if (f == null) throw new Error(`No matching data-pcformat found for country: ${country}`);
  return f;
}

// US full-state / CA province name -> 2-letter (only exercised for US/CA lanes).
const US_STATE_MAP: Record<string, string> = {
  Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA", Colorado: "CO",
  Connecticut: "CT", Delaware: "DE", Florida: "FL", Georgia: "GA", Hawaii: "HI", Idaho: "ID",
  Illinois: "IL", Indiana: "IN", Iowa: "IA", Kansas: "KS", Kentucky: "KY", Louisiana: "LA",
  Maine: "ME", Maryland: "MD", Massachusetts: "MA", Michigan: "MI", Minnesota: "MN", Mississippi: "MS",
  Missouri: "MO", Montana: "MT", Nebraska: "NE", Nevada: "NV", "New Hampshire": "NH", "New Jersey": "NJ",
  "New Mexico": "NM", "New York": "NY", "North Carolina": "NC", "North Dakota": "ND", Ohio: "OH",
  Oklahoma: "OK", Oregon: "OR", Pennsylvania: "PA", "Rhode Island": "RI", "South Carolina": "SC",
  "South Dakota": "SD", Tennessee: "TN", Texas: "TX", Utah: "UT", Vermont: "VT", Virginia: "VA",
  Washington: "WA", "West Virginia": "WV", Wisconsin: "WI", Wyoming: "WY", "District of Columbia": "DC",
};
const CA_PROVINCE_MAP: Record<string, string> = {
  Alberta: "AB", "British Columbia": "BC", Manitoba: "MB", "New Brunswick": "NB",
  "Newfoundland and Labrador": "NL", "Northwest Territories": "NT", "Nova Scotia": "NS", Nunavut: "NU",
  Ontario: "ON", "Prince Edward Island": "PE", Quebec: "QC", "Québec": "QC", Saskatchewan: "SK", Yukon: "YT",
};
const getStateCode = (name: string) => US_STATE_MAP[name.trim()] ?? CA_PROVINCE_MAP[name.trim()] ?? "";
const ifUsRegion = (region: string) => (region.length === 2 ? region : getStateCode(region));

const shipperToVsstates = (a: Addr) => (a?.country !== "US" ? "AL" : ifUsRegion(a.region ?? ""));
const shipperToCanadastates = (a: Addr) => (a?.country !== "CA" ? "QC" : a.region || "QC");
const recipientToVsstates = (a: Addr) => (a?.country !== "US" ? "AL" : ifUsRegion(a.region ?? ""));
const recipientToCanadastates = (a: Addr) => (a?.country !== "CA" ? "QC" : a.region || "QC");

const searchNoRegion = (a: Addr) => `${a.street.join(" ")}, ${a.city}, ${a.country}`;
const searchWithRegion = (a: Addr) => `${a.street.join(" ")}, ${a.city}, ${a.region}, ${a.country}`;

function goederenBoxType(pkgs: Pkg[]): string[] {
  return pkgs.map((p) => {
    if (p.type === "package") return "Box (max 70kg)";
    if (p.type === "pallet") return "Afwijkend pallet";
    if (p.type === "document") return "Document(en)";
    throw new Error("goederenBoxType: unknown type");
  });
}
function goederenPackingType(pkgs: Pkg[]): string[] {
  return pkgs.map((p) => {
    if (p.type === "package") return "colli";
    if (p.type === "pallet") return "pallet";
    if (p.type === "document") return "docs";
    throw new Error("goederenPackingType: unknown type");
  });
}
const onOrEmpty = (company?: string) => (!company || company === "" ? "on" : "");

function tailgateOf(t: any): string {
  if (t.shipperTaillift && t.recipientTaillift) return "both";
  if (t.shipperTaillift) return "load";
  if (t.recipientTaillift) return "unload";
  return "off";
}
function boxTruckOf(t: any): string {
  if (t.shipperVehicle === "box truck" && t.recipientVehicle === "box truck") return "both";
  if (t.shipperVehicle === "box truck") return "load";
  if (t.recipientVehicle === "box truck") return "unload";
  return "off";
}

export function transformGetRatesInput(input: any): Record<string, any> {
  const sa: Addr = input.shipperAddress;
  const ra: Addr = input.recipientAddress;
  const pkgs: Pkg[] = input.packages;
  const t: Record<string, any> = {};

  t["land"] = _1To1(sa.country);
  t["searchTextField"] = searchNoRegion(sa);
  t["searchTextField2"] = searchWithRegion(ra);
  t["vsstates"] = shipperToVsstates(sa);
  t["canadastates"] = shipperToCanadastates(sa);
  t["postcode"] = onlyAlphanumeric(sa.postalCode);
  t["huisnummer"] = _1To1OrDash(sa.street[1]);
  t["postcode_formath"] = geenToNoString(selectLandValueToDataPcformat(sa.country));
  t["straat"] = _1To1(sa.street[0]);
  t["plaats"] = _1To1(sa.city);
  t["land2"] = _1To1(ra.country);
  t["vsstates2"] = recipientToVsstates(ra);
  t["canadastates2"] = recipientToCanadastates(ra);
  t["postcode2"] = onlyAlphanumeric(ra.postalCode);
  t["huisnummer2"] = _1To1OrDash(ra.street[1]);
  t["postcode_format2h"] = geenToNoString(selectLandValueToDataPcformat(ra.country));
  t["straat2"] = _1To1(ra.street[0]);
  t["plaats2"] = _1To1(ra.city);
  t["goederen[]"] = goederenBoxType(pkgs);
  t["packaging-type[]"] = goederenPackingType(pkgs);
  t["lengte[]"] = pkgs.map((p) => p.length.toString());
  t["breedte[]"] = pkgs.map((p) => p.width.toString());
  t["hoogte[]"] = pkgs.map((p) => p.height.toString());
  t["gewicht[]"] = pkgs.map((p) => p.weight.toString());
  t["stapelbaar[]"] = pkgs.map((p) => (p.stackable ? "1" : "0"));
  t["stapelbaarIndicator[]"] = pkgs.map((p) => (p.stackable ? "1" : "0"));
  t["tailgate"] = tailgateOf(input.shipmentOptions.truckShipmentInfo);
  t["boxTruck"] = boxTruckOf(input.shipmentOptions.truckShipmentInfo);
  t["privateaddress2"] = onOrEmpty(ra.company);
  return t;
}

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------

// We stash the live cookie header on the Session.cookie field; the versturen
// wizard authenticates purely by cookie (no per-request CSRF token), so
// csrfField is a no-op placeholder kept only for contract compatibility.
export const adapterLive: PortalAuthAdapter & { portal: string } = {
  portal: "tff",

  async login(): Promise<Session> {
    const { user, pass } = creds();
    const { jar, phpsessid, csrf } = await loginAndWarm(globalThis.fetch, user, pass);
    const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
    return { id: phpsessid ?? "no-phpsessid", csrf: csrf ?? "", cookie };
  },

  async submit(session: Session, flow: string, payload: Record<string, unknown>): Promise<PortalResponse> {
    if (flow !== "getRates") throw new Error(`adapter-live only implements getRates (read-only), got: ${flow}`);
    // The adapter owns auth (cookie header via session.cookie); the pool injects nothing.
    const fields = payload as any;
    const r = await fetchRates(globalThis.fetch, session.cookie, fields);
    return {
      status: r.status,
      loggedOut: r.loggedOut,
      body: { result: r.result, reason: r.reason },
    };
  },

  isLoggedOut(resp: PortalResponse): boolean {
    return resp.loggedOut === true;
  },
};

export { BASE };
