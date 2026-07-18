// Runtime-demo: voert de gecompileerde getRates-flow uit tegen het (mock-)portaal via
// de sessiepool. Toont na §4.6: geen body-injectie meer (de adapter doet auth zelf),
// plus token-lifecycle — proactieve refresh, en refresh/re-login-fallback bij logout.
// Draai eerst `npm run compile`.

import { SessionPool } from "./pool.ts";
import { loadAdapter, runFlow } from "./execute.ts";
import { __mockExpireAll, __mockExpireSoon } from "../../portals/tff/adapter.ts";

const input = {
  shipper: { country: "NL", postcode: "1011AB", street: "Damrak 1" },
  recipient: { country: "US", postcode: "10001", street: "5th Ave" },
  package: { weightKg: 2.5 },
};

const adapter = await loadAdapter("tff");
const pool = new SessionPool(adapter);

console.log("=== 1: getRates (happy path, verse login) ===");
console.log("  rates:", JSON.stringify(await runFlow(pool, "demo-forwarder", "tff", "getRates", input)));

console.log("\n=== 2: tweede call — sessie hergebruikt (geen nieuwe login) ===");
console.log("  rates:", JSON.stringify(await runFlow(pool, "demo-forwarder", "tff", "getRates", input)));

console.log("\n=== 3: server-side logout -> refresh faalt -> re-login-fallback + retry ===");
__mockExpireAll();
console.log("  rates:", JSON.stringify(await runFlow(pool, "demo-forwarder", "tff", "getRates", input)));

console.log("\n=== 4: token bijna verlopen -> proactieve refresh vóór de call ===");
__mockExpireSoon(pool.session!);
console.log("  rates:", JSON.stringify(await runFlow(pool, "demo-forwarder", "tff", "getRates", input)));

console.log("\nOK — pool zonder body-injectie; token-lifecycle: proactieve refresh + refresh/re-login-fallback.");
