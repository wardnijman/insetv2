// LIVE TFF booking runner (WRITE PATH) — DPD Classic NL->NL, guarded.
//
// Run from ~/inset (capabilities.ts reads portals/tff/capabilities.json relative to cwd):
//   node --experimental-strip-types --experimental-loader ./portals/tff/resolve-ts.mjs \
//        portals/tff/run-booking.ts <dry|book> [count]
//
//   dry        : login -> getRates -> pick DPD Classic -> chooseOption. NO submit. Nothing books.
//   book [n]   : same, then submitShipment n times (default 2), fresh login per booking.
//
// The capability guard (assertBookable) runs inside bookDpdClassic BEFORE every submit,
// and this runner also independently asserts carrier==DPD & service~=Classic before calling it.

import { readFileSync } from "node:fs";
import { loginAndWarm, fetchRates, jarToHeader, type CookieJar } from "./tff-live-transport.ts";
import { transformGetRatesInput } from "./adapter-live.ts";
import { createJarFetch } from "./tff-booking-transport.ts";
import { bookDpdClassic } from "./adapter-booking.ts";
import { assertBookable } from "../../src/runtime/capabilities.ts";

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

// ---- canonical NL->NL test shipment (small package, plausible test addresses) ----
const SHIPPER = {
  company: "Plugtech Test BV", firstName: "Ward", lastName: "Nijman", email: "test@plugtech.nl",
  street: ["Vrolikstraat", "305-4"], city: "Amsterdam", region: "", postalCode: "1091VD",
  country: "NL", phoneNumber: "0612345678",
};
const RECIPIENT = {
  company: "Ontvanger Test BV", firstName: "Jan", lastName: "Jansen", email: "ontvanger@example.nl",
  street: ["Coolsingel", "42"], city: "Rotterdam", region: "", postalCode: "3011AD",
  country: "NL", phoneNumber: "0612345678",
};

function makeInput() {
  return {
    shipperAddress: SHIPPER,
    recipientAddress: RECIPIENT,
    source: "inset-v2-live-test",
    packages: [{ name: "small-package", weight: 1, length: 40, width: 30, height: 30, type: "package", stackable: false }],
    shipmentOptions: {
      invoiceRef: "INSET-V2-TEST",
      chosenRate: { carrier: "", service: "", price: "", reusableData: undefined },
      incotermsGroupD: "DAP", description: "Kleding (test)", exportReason: "sale",
      shipmentOriginCountry: "NL", totalShipmentValue: 25,
      factuurAanwezig: "nee",
      truckShipmentInfo: { shipperForklift: false, shipperTaillift: false, recipientForklift: false, recipientTaillift: false, shipperVehicle: "car", recipientVehicle: "car" },
      insuranceValue: 0, signatureRequired: "none",
      sessionKey: "",
    },
    invoice: { filename: "", base64: "", contentType: "" },
    customsDocuments: [],
    orderId: "", source_meta: "",
  };
}

function pickDpdClassic(rates: any[]): any | null {
  // Ward's rule: DPD Classic only (ground/non-express, non-Mainfreight).
  const dpd = rates.filter((r) => String(r.carrier).toUpperCase() === "DPD");
  const classic = dpd.find((r) => /classic/i.test(String(r.service)));
  return classic ?? null;
}

async function doOne(idx: number, dryRun: boolean) {
  console.log(`\n================= BOOKING ATTEMPT #${idx} (${dryRun ? "DRY" : "LIVE"}) =================`);
  // fresh login per booking (the wizard is single-use / stateful per PHPSESSID)
  const login = await loginAndWarm(globalThis.fetch, process.env.TFF_EMAIL!, process.env.TFF_PASS!);
  const jar: CookieJar = login.jar;
  const phpsessid = jar["PHPSESSID"] ?? login.phpsessid ?? "(none)";
  const jarFetch = createJarFetch(globalThis.fetch, jar);
  console.log(`  login OK  PHPSESSID=${phpsessid.slice(0, 10)}…`);

  const input = makeInput();
  const ratesResp = await fetchRates(jarFetch, jarToHeader(jar), transformGetRatesInput(input));
  if (ratesResp.loggedOut) { console.log(`  getRates: LOGGED OUT (${ratesResp.reason})`); return null; }
  const rates: any[] = ratesResp.result;
  console.log(`  getRates: ${rates.length} rates -> ${rates.map((r) => `${r.carrier}/${r.service}`).join(", ")}`);

  const rate = pickDpdClassic(rates);
  if (!rate) { console.log(`  NO DPD Classic rate available on this lane — skipping (nothing booked).`); return null; }
  console.log(`  chosen rate: carrier=${rate.carrier} service="${rate.service}" price=€${rate.price} noPickupPossible=${rate.noPickupPossible}`);

  // Independent runner-side guard assertion (belt + suspenders; bookDpdClassic asserts again).
  assertBookable("tff", { carrier: rate.carrier, service: rate.service });
  console.log(`  assertBookable("tff", {carrier:"${rate.carrier}", service:"${rate.service}"}) -> PASSED`);

  const outcome = await bookDpdClassic(jarFetch, rate, input, { dryRun });

  if (outcome.choose) {
    console.log(`  chooseOption: HTTP ${outcome.choose.status} loggedOut=${outcome.choose.loggedOut} sessionKey=${outcome.choose.sessionKey} paperless=${outcome.choose.paperlessAvailable}`);
  }
  if (dryRun) { console.log(`  DRY RUN — stopped before submit. Nothing booked.`); return outcome; }

  const s = outcome.submit;
  if (!s) { console.log(`  submit not reached (logged out during choose).`); return outcome; }
  if (!s.booked) {
    console.log(`  submit: NOT BOOKED. HTTP ${s.status} loggedOut=${s.loggedOut}\n    reason: ${s.error}`);
    return outcome;
  }
  console.log(`  ✅ BOOKED. HTTP ${s.status}`);
  console.log(`     TFF shipment id : ${s.shipmentId}`);
  console.log(`     forwarder ref   : ${s.forwarderRef ?? "(none)"}`);
  console.log(`     tracking number : ${s.trackingNumber ?? "(none yet)"}`);
  console.log(`     tracking url    : ${s.trackingUrl ?? "(none)"}`);
  console.log(`     label pdf       : ${s.labelUrl ?? "(none)"}`);
  console.log(`     confirmation pdf: ${s.confirmationUrl ?? "(none)"}`);
  console.log(`     redirect        : ${s.redirectUrl}`);
  return outcome;
}

const LIVE_ACK = "ik-weet-dat-dit-geld-kost";

async function main() {
  const mode = process.argv[2] ?? "dry";
  const count = Math.max(1, Math.min(3, parseInt(process.argv[3] ?? "2", 10) || 2));
  let dryRun = mode !== "book";

  // DERDE, ONAFHANKELIJKE REM (naast de twee capability-guards): een echte boeking
  // kost geld en verse DPD-labels zijn NIET annuleerbaar. `book` alléén is niet genoeg;
  // de env-ack moet er ook zijn. Ontbreekt die, dan degradeert de runner naar DRY.
  if (!dryRun && process.env.INSET_LIVE_BOOKING_ACK !== LIVE_ACK) {
    console.log("############################################################");
    console.log("# GEWEIGERD: 'book' zonder bevestiging.");
    console.log(`#   Zet INSET_LIVE_BOOKING_ACK="${LIVE_ACK}" om écht te boeken.`);
    console.log("#   Een boeking kost geld; verse DPD-labels zijn niet annuleerbaar.");
    console.log("#   -> Val terug op DRY RUN (niets wordt geboekt).");
    console.log("############################################################");
    dryRun = true;
  }

  console.log("############################################################");
  console.log(`# Inset v2 — LIVE TFF booking runner (DPD Classic NL->NL)`);
  console.log(`# mode=${dryRun ? "DRY (no submit)" : "BOOK"} count=${dryRun ? 1 : count}`);
  console.log("############################################################");

  // network sanity
  try {
    const r = await fetch("https://tffxpress.com/login", { method: "GET", redirect: "manual" });
    console.log(`network: GET tffxpress.com/login -> HTTP ${r.status}`);
  } catch (e: any) {
    console.log(`network FAILED: ${e.message}`); return;
  }

  const results: any[] = [];
  const n = dryRun ? 1 : count;
  for (let i = 1; i <= n; i++) {
    try {
      results.push(await doOne(i, dryRun));
    } catch (e: any) {
      console.log(`  ATTEMPT #${i} threw: ${e?.message || e}`);
      results.push({ error: e?.message || String(e) });
    }
  }

  console.log("\n############################################################");
  console.log("# SUMMARY");
  const booked = results.filter((r) => r?.submit?.booked);
  if (dryRun) {
    console.log(`# DRY RUN complete — flow reached chooseOption, nothing booked.`);
  } else {
    console.log(`# ${booked.length}/${n} booked:`);
    for (const b of booked) console.log(`#   shipment ${b.submit.shipmentId} | label ${b.submit.labelUrl ? "yes" : "no"} | tracking ${b.submit.trackingNumber ?? "-"}`);
  }
  console.log("############################################################");
}

main().catch((e) => { console.error("FATAL:", e?.stack || e?.message || e); process.exit(1); });
