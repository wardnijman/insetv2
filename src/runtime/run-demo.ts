// Runtime-demo: voert de gecompileerde getRates-flow uit tegen het (mock-)portaal via
// de sessiepool. Toont: happy path, sessie-hergebruik, en auto re-login na een
// server-side logout. Draai eerst `npm run compile`.

import { SessionPool } from "./pool.ts";
import { loadAdapter, runFlow } from "./execute.ts";
import { __mockExpireAll } from "../../portals/tff/adapter.ts";

// Widget-input (canoniek). Let op: GEEN session.token hier — de CSRF komt uit de pool.
const input = {
  shipper: { country: "NL", postcode: "1011AB", street: "Damrak 1" },
  recipient: { country: "US", postcode: "10001", street: "5th Ave" },
  package: { weightKg: 2.5 },
};

const adapter = await loadAdapter("tff");
const pool = new SessionPool(adapter);

console.log("=== Scenario 1: getRates (happy path, verse login) ===");
console.log("  rates:", JSON.stringify(await runFlow(pool, "tff", "getRates", input)));

console.log("\n=== Scenario 2: tweede call — sessie hergebruikt (geen nieuwe login) ===");
console.log("  rates:", JSON.stringify(await runFlow(pool, "tff", "getRates", input)));

console.log("\n=== Scenario 3: portaal logt de sessie server-side uit -> auto re-login + retry ===");
__mockExpireAll();
console.log("  rates:", JSON.stringify(await runFlow(pool, "tff", "getRates", input)));

console.log("\nOK — runtime draaide getRates deterministisch: sessiepool, CSRF-injectie, auto re-login.");
