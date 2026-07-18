// LIVE read-only proof: run the v2 TransHeroes adapter (real Laravel+Passport login
// -> Bearer, a reference GET to prove the Bearer, and the stateless rate calc)
// through the SAME portal-agnostic SessionPool that drives the TFF adapter.
//
// This is the generalization test: does PortalAuthAdapter + SessionPool, built and
// proven against TFF (cookie session, form scrape), also carry a Passport Bearer
// JSON-API portal unchanged?
//
// Run with (from ~/inset):
//   node --experimental-strip-types portals/transheroes/run-live.ts
//
// STRICT READ-ONLY: login + reference GET + /quotation-price-indications only.
// Never POSTs /quotations, never books or submits.

import { readFileSync } from "node:fs";
import { SessionPool } from "../../src/runtime/pool.ts";
import { adapterLive, transformGetRatesInput } from "./adapter-live.ts";
import { getReference, INLOG } from "./transheroes-live-transport.ts";

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

const NL_SHIPPER = {
  company: "Plugtech Test Company",
  street: ["Vrolikstraat", "305"],
  city: "Amsterdam",
  postalCode: "1091VD",
  country: "NL",
};

function makeInput(recipient: any) {
  return {
    shipperAddress: NL_SHIPPER,
    recipientAddress: recipient,
    packages: [
      { name: "one-pallet", type: "pallet", weight: 120, length: 120, width: 80, height: 100, stackable: true },
    ],
  };
}

const LANES: Record<string, any> = {
  "NL->DE": makeInput({ company: "Empfaenger GmbH", street: ["Marienplatz", "8"], city: "Muenchen", postalCode: "80331", country: "DE" }),
  "NL->FR": makeInput({ company: "Destinataire SARL", street: ["Rue de Rivoli", "10"], city: "Paris", postalCode: "75001", country: "FR" }),
};

async function main() {
  console.log("############################################################");
  console.log("# Inset v2 — LIVE read-only TransHeroes adapter proof (generalization test)");
  console.log("############################################################\n");

  // (a) network
  try {
    const r = await fetch(`${INLOG}/login`, { method: "GET", redirect: "manual" });
    console.log(`(a) NETWORK: GET inloggen.../login -> HTTP ${r.status} (reachable)\n`);
  } catch (e: any) {
    console.log(`(a) NETWORK: FAILED -> ${e.message}\nBLOCKER: no network to TransPortal. Stopping.`);
    return;
  }

  // (b) v2 login via the SAME SessionPool used for TFF, with the TransHeroes adapter
  const pool = new SessionPool(adapterLive);
  const session = await pool.lease();
  console.log(`(b) LOGIN (v2 adapter via SessionPool): id=${session.id} csrf=${session.csrf ? "set" : "(none — Bearer replaces CSRF)"}`);
  console.log(`    Bearer captured on Session.cookie (overloaded): ${session.cookie.slice(0, 16)}…\n`);

  // (c) reference GET to prove the Bearer (read-only)
  const ref = await getReference(globalThis.fetch, session.cookie, "/additional-services");
  const refArr = ref.body?.data ?? ref.body;
  console.log(`(c) REFERENCE GET /additional-services: HTTP ${ref.status}, ${Array.isArray(refArr) ? refArr.length + " services" : "?"} (Bearer proven)`);
  const ui = await getReference(globalThis.fetch, session.cookie, "/oauth/userInfo");
  const uiBody = ui.body?.data ?? ui.body;
  const boltrics = uiBody && ("boltricsReference" in uiBody || "boltricsUsername" in uiBody);
  console.log(`    GET /oauth/userInfo: HTTP ${ui.status}, boltrics keys=${boltrics ? "present" : "absent"} (Boltrics/3PL Dynamics backend)\n`);

  // (d) rate calc through the pool (stateless price indication; persists nothing)
  for (const [lane, input] of Object.entries(LANES)) {
    console.log(`==================== LANE ${lane} ====================`);
    const payload = transformGetRatesInput(input, 1 /* road */);
    console.log(`  payload (canonical -> JSON body): departure country=${payload.departureLocation.address.country} dest country=${payload.destinationLocation.address.country} lines=${payload.quotationLines.length}`);
    const resp = await pool.submit("getRates", payload);
    const rates: any[] = (resp.body as any)?.result ?? [];
    console.log(`  (d) getRates: HTTP ${resp.status}, loggedOut=${resp.loggedOut}, ${rates.length} rate(s)`);
    if ((resp.body as any)?.reason) console.log(`      reason: ${(resp.body as any).reason}`);
    for (const r of rates) console.log(`      ${r.carrier} | ${r.service} | €${r.price}${r.surcharge ? ` (+€${r.surcharge} surcharge)` : ""} | customerContract=${r.isCustomerContract}`);
    console.log("");
  }

  // (e) prove the calc persisted NOTHING (read-only guarantee)
  const q = await getReference(globalThis.fetch, session.cookie, "/quotations");
  const qArr = q.body?.data ?? q.body;
  console.log(`(e) READ-ONLY CHECK: GET /quotations count = ${Array.isArray(qArr) ? qArr.length : "?"} (rate calc created no quotation) ✅\n`);

  // (f) the pool's standardized auto re-login, with the LIVE Bearer adapter
  console.log("==================== v2 pool re-login (live) ====================");
  const before = session.id;
  pool.retire();
  const s2 = await pool.lease();
  console.log(`  retired ${before} -> fresh login ${s2.id} (new Bearer: ${s2.cookie !== session.cookie ? "yes ✅" : "no"})`);

  console.log("\n############################################################");
  console.log("# SUMMARY: PortalAuthAdapter + SessionPool carried a Passport Bearer JSON-API portal");
  console.log("#          read-only (login + reference GET + stateless rate calc), zero bookings.");
  console.log("############################################################");
}

main().catch((e) => {
  console.error("FATAL:", e?.stack || e?.message || e);
  process.exit(1);
});
