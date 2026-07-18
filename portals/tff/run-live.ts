// LIVE read-only proof: run the v2 TFF adapter (real login + getRates) against
// tffxpress.com, and differentially validate it against v1's KNOWN-GOOD pipeline.
//
// Run with (from ~/inset):
//   node --experimental-strip-types \
//        --experimental-loader ./portals/tff/resolve-ts.mjs \
//        portals/tff/run-live.ts
//
// The loader hook lets us import v1's REAL transform module (built for a bundler,
// uses extensionless + JSON imports) straight from the plugship repo, so the
// oracle is genuinely v1 code — not a re-implementation.
//
// STRICT READ-ONLY: login + getRates only. No chooseOption, no submitShipment.

import { readFileSync } from "node:fs";
import { SessionPool } from "../../src/runtime/pool.ts";
import { adapterLive, transformGetRatesInput } from "./adapter-live.ts";
import { loginAndWarm, fetchRates } from "./tff-live-transport.ts";

// v1 KNOWN-GOOD transform module (imported live via the loader hook)
import * as V1 from "/Users/wardn/plugship/client-discovery/tff/src/lib/steps/transforms/tff/B_getRates_0.transforms.ts";

// ---- env ----
function loadEnv(path: string) {
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const s = line.trim();
    if (!s || s.startsWith("#")) continue;
    const i = s.indexOf("=");
    if (i === -1) continue;
    const k = s.slice(0, i).trim();
    const v = s.slice(i + 1).trim();
    if (!(k in process.env)) process.env[k] = v;
  }
}
loadEnv("/Users/wardn/inset/.env");

// ---- v1 transform assembly (exact copy of v1 getRates.ts lines building `transformed`) ----
function buildV1Transformed(input: any): Record<string, any> {
  const t: Record<string, any> = {};
  t["land"] = V1._1To1(input.shipperAddress.country);
  t["searchTextField"] = V1.tffGeocodedAddressToSearchtextfieldNoRegion(input.shipperAddress);
  t["searchTextField2"] = V1.tffGeocodedAddressToSearchtextfield(input.recipientAddress);
  t["vsstates"] = V1.shipperAddressToVsstates(input.shipperAddress);
  t["canadastates"] = V1.shipperAddressToCanadastates(input.shipperAddress);
  t["postcode"] = V1.onlyAlphanumeric(input.shipperAddress.postalCode);
  t["huisnummer"] = V1._1To1OrDash(input.shipperAddress.street[1]);
  t["postcode_formath"] = V1.geenToNoString(V1.selectLandValueToDataPcformat(input.shipperAddress.country));
  t["straat"] = V1._1To1(input.shipperAddress.street[0]);
  t["plaats"] = V1._1To1(input.shipperAddress.city);
  t["land2"] = V1._1To1(input.recipientAddress.country);
  t["vsstates2"] = V1.recipientAddressToVsstates(input.recipientAddress);
  t["canadastates2"] = V1.recipientAddressToCanadastates(input.recipientAddress);
  t["postcode2"] = V1.onlyAlphanumeric(input.recipientAddress.postalCode);
  t["huisnummer2"] = V1._1To1OrDash(input.recipientAddress.street[1]);
  t["postcode_format2h"] = V1.geenToNoString(V1.selectLandValueToDataPcformat(input.recipientAddress.country));
  t["straat2"] = V1._1To1(input.recipientAddress.street[0]);
  t["plaats2"] = V1._1To1(input.recipientAddress.city);
  t["goederen[]"] = V1.goederenSelectBoxTypeToArray(input.packages);
  t["packaging-type[]"] = V1.goederenSelectPackingTypeToArray(input.packages);
  t["lengte[]"] = V1.packageLengthToArray(input.packages);
  t["breedte[]"] = V1.packageWidthToArray(input.packages);
  t["hoogte[]"] = V1.packageHeightToArray(input.packages);
  t["gewicht[]"] = V1.packageWeightToArray(input.packages);
  t["stapelbaar[]"] = V1.packagesStackableBinaryToArray(input.packages);
  t["stapelbaarIndicator[]"] = V1.packagesStackableBinaryToArray(input.packages);
  t["tailgate"] = V1.truckshipmentinfoToTailgate(input.shipmentOptions.truckShipmentInfo);
  t["boxTruck"] = V1.truckshipmentinfoToBoxtruck(input.shipmentOptions.truckShipmentInfo);
  t["privateaddress2"] = V1.onOrEmpty(input.recipientAddress.company);
  return t;
}

// ---- test inputs ----
const NL_SHIPPER = {
  company: "Plugtech Test Company",
  firstName: "Ward",
  lastName: "Nijman",
  email: "test@plugtech.nl",
  street: ["Vrolikstraat", "305-4"],
  city: "Amsterdam",
  region: "",
  postalCode: "1091VD",
  country: "NL",
  phoneNumber: "0612345678",
};

function makeInput(recipient: any) {
  return {
    shipperAddress: NL_SHIPPER,
    recipientAddress: recipient,
    packages: [
      { templateId: "", userId: "", name: "small-package", productSkus: [],
        weight: 1, length: 40, width: 30, height: 30, type: "package",
        dangerousGoods: false, bioGoods: false, createdAt: "", updatedAt: "" },
    ],
    shipmentOptions: {
      invoiceRef: "abc",
      chosenRate: { carrier: "", service: "", price: "", reusableData: undefined },
      incotermsGroupD: "DAP", description: "", exportReason: "sale",
      shipmentOriginCountry: "NL", totalShipmentValue: 10,
      registrationNumberTypeShipper: "EOR", registrationNumberShipper: "",
      registrationNumberTypeRecipient: "EIN", registrationNumberRecipient: "",
      deliveryInstructions: "",
      truckShipmentInfo: { shipperForklift: false, shipperTaillift: false, recipientForklift: false, recipientTaillift: false },
      insuranceValue: 0, signatureRequired: "none",
      carrierAccountNumber: { specifyCarrierAccountNumber: false, carrierAccountNumber: "", carrierAccountNumberCountry: "", carrierAccountNumberPostalCode: "" },
      sessionKey: "",
    },
    invoice: { filename: "", base64: "" }, orderId: "", source: "",
  };
}

const LANES: Record<string, any> = {
  "NL->NL": makeInput({
    company: "Ontvanger Test BV", firstName: "Jan", lastName: "Jansen", email: "ontvanger@example.nl",
    street: ["Coolsingel", "42"], city: "Rotterdam", region: "", postalCode: "3011AD", country: "NL", phoneNumber: "0612345678",
  }),
  "NL->DE": makeInput({
    company: "Empfaenger GmbH", firstName: "Max", lastName: "Muster", email: "empfaenger@example.de",
    street: ["Marienplatz", "8"], city: "Muenchen", region: "", postalCode: "80331", country: "DE", phoneNumber: "0612345678",
  }),
};

// ---- helpers ----
function deepEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => deepEqual(x, b[i]));
  }
  if (a && b && typeof a === "object") {
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

function diffFields(v2: Record<string, any>, v1: Record<string, any>): string[] {
  const keys = new Set([...Object.keys(v2), ...Object.keys(v1)]);
  const out: string[] = [];
  for (const k of keys) {
    if (!deepEqual(v2[k], v1[k])) out.push(`    ${k}: v2=${JSON.stringify(v2[k])} v1=${JSON.stringify(v1[k])}`);
  }
  return out;
}

const rateKey = (r: any) => `${r.carrier} | ${r.service} | €${r.price}`;
function summarizeRates(rates: any[]): string[] {
  return rates.map(rateKey).sort();
}

// ---- run ----
async function main() {
  console.log("############################################################");
  console.log("# Inset v2 — LIVE read-only TFF adapter proof + v1 diff");
  console.log("############################################################\n");

  // (a) network / IP-binding sanity
  let net = false;
  try {
    const r = await fetch("https://tffxpress.com/login", { method: "GET", redirect: "manual" });
    net = r.status > 0;
    console.log(`(a) NETWORK: GET tffxpress.com/login -> HTTP ${r.status} (reachable from this process/IP)\n`);
  } catch (e: any) {
    console.log(`(a) NETWORK: FAILED -> ${e.message}\nBLOCKER: no network to tffxpress.com from this process. Stopping.`);
    return;
  }
  if (!net) return;

  // (b) v2 login via the real SessionPool + the LIVE adapter
  const pool = new SessionPool(adapterLive);
  const session = await pool.lease();
  console.log(`(b) LOGIN (v2 adapter via SessionPool): PHPSESSID=${session.id?.slice(0, 10)}… csrf=${session.csrf ? "captured" : "none"}`);
  console.log(`    authenticated /versturen confirmed by loginAndWarm (throws otherwise)\n`);

  const report: Record<string, any> = {};

  for (const [lane, input] of Object.entries(LANES)) {
    console.log(`==================== LANE ${lane} ====================`);

    // Deterministic transform diff: v2 port vs v1 real transforms
    const payloadV2 = transformGetRatesInput(input);
    const payloadV1 = buildV1Transformed(input);
    const payloadMatch = deepEqual(payloadV2, payloadV1);
    console.log(`  transform payload (v2 port) vs (v1 real module): ${payloadMatch ? "IDENTICAL ✅" : "DIFFERENT ❌"}`);
    if (!payloadMatch) console.log(diffFields(payloadV2, payloadV1).join("\n"));

    // v2 live getRates through the pool (session reused across lanes)
    const respV2 = await pool.submit("getRates", payloadV2);
    const ratesV2: any[] = (respV2.body as any)?.result ?? [];
    console.log(`  (c) v2 getRates: HTTP ${respV2.status}, loggedOut=${respV2.loggedOut}, ${ratesV2.length} rates`);
    if ((respV2.body as any)?.reason) console.log(`      reason: ${(respV2.body as any).reason}`);

    // v1 oracle live getRates: own fresh login (same machine/IP), v1 real transform, shared scrape
    const login1 = await loginAndWarm(globalThis.fetch, process.env.TFF_EMAIL!, process.env.TFF_PASS!);
    const cookie1 = Object.entries(login1.jar).map(([k, v]) => `${k}=${v}`).join("; ");
    const oracle = await fetchRates(globalThis.fetch, cookie1, payloadV1);
    const ratesV1: any[] = oracle.result;
    console.log(`  (d) v1 getRates (oracle, own session PHPSESSID=${login1.phpsessid?.slice(0, 10)}…): HTTP ${oracle.status}, ${ratesV1.length} rates`);
    if (oracle.reason) console.log(`      reason: ${oracle.reason}`);

    const sumV2 = summarizeRates(ratesV2);
    const sumV1 = summarizeRates(ratesV1);
    console.log(`      v2 carriers+prices: ${sumV2.length ? sumV2.join("  ·  ") : "(none)"}`);
    console.log(`      v1 carriers+prices: ${sumV1.length ? sumV1.join("  ·  ") : "(none)"}`);

    const ratesMatch = deepEqual(sumV2, sumV1);
    console.log(`  (e) RATE MATCH (carrier+service+price): ${ratesMatch ? "YES ✅" : "NO ❌"}`);
    if (!ratesMatch) {
      const onlyV2 = sumV2.filter((x) => !sumV1.includes(x));
      const onlyV1 = sumV1.filter((x) => !sumV2.includes(x));
      if (onlyV2.length) console.log(`      only in v2: ${onlyV2.join("  ·  ")}`);
      if (onlyV1.length) console.log(`      only in v1: ${onlyV1.join("  ·  ")}`);
    }
    console.log("");

    report[lane] = { payloadMatch, v2Count: ratesV2.length, v1Count: ratesV1.length, ratesMatch, sumV2, sumV1 };
  }

  // (f) demonstrate the v2 pool's auto re-login with the LIVE adapter
  console.log("==================== v2 pool re-login (live) ====================");
  const before = session.id?.slice(0, 10);
  pool.retire();
  const s2 = await pool.lease();
  console.log(`  retired ${before}… -> fresh login ${s2.id?.slice(0, 10)}… (new PHPSESSID: ${s2.id !== session.id ? "yes ✅" : "no"})\n`);

  console.log("############################################################");
  console.log("# SUMMARY");
  for (const [lane, r] of Object.entries(report)) {
    console.log(`#  ${lane}: payload ${r.payloadMatch ? "OK" : "DIFF"} | v2 ${r.v2Count} rates | v1 ${r.v1Count} rates | rates ${r.ratesMatch ? "MATCH" : "MISMATCH"}`);
  }
  console.log("############################################################");
}

main().catch((e) => {
  console.error("FATAL:", e?.stack || e?.message || e);
  process.exit(1);
});
