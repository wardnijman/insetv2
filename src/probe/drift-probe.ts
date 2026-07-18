// DRIFT-PROBE (laag 3 uit de testpiramide; R1.2/R1.6/R1.7). Haalt de HUIDIGE
// portaal-form op, herberekent de fingerprint AAN DE PORTAALKANT en vergelijkt met
// wat de config verwacht. Structurele drift -> rood + een veld-diff die de
// reparatie-sessie voedt. (Semantische drift wordt door de contract-test gevangen.)
//
// Gebruik: node --experimental-strip-types src/probe/drift-probe.ts [portaal] [flow]
//   INSET_DRIFT=add-btw|rename-gewicht|extra-honeypot  simuleert een portaal-wijziging.

import { readFileSync } from "node:fs";
import { classify, fingerprintOf } from "../shared/fingerprint.ts";
import { fetchCurrentForm } from "./form-source.ts";

const portal = process.argv[2] ?? "tff";
const flow = process.argv[3] ?? "getRates";

// Wat de config verwacht: de map-velden minus de (Claude-vastgestelde) volatiele.
const fields = JSON.parse(readFileSync(`portals/${portal}/fields.json`, "utf8"));
const drop: string[] = fields.canonicalize?.dropFields ?? [];
const expectedStable = Object.keys(fields.map).filter((n) => !drop.includes(n)).sort();
const expectedFp = fingerprintOf(expectedStable);

// Wat het portaal nu heeft.
const live = await fetchCurrentForm(portal, flow);
const { stable: liveStable, volatile: liveVolatile } = classify(live.fields);
const liveFp = fingerprintOf(liveStable);

console.log(`drift-probe: ${portal}/${flow}${process.env.INSET_DRIFT ? `  [sim: ${process.env.INSET_DRIFT}]` : ""}`);
console.log(`  config-fingerprint : ${expectedFp}  (${expectedStable.length} stabiele velden)`);
console.log(`  live-fingerprint   : ${liveFp}  (${liveStable.length} stabiele; ${liveVolatile.length} volatiel genegeerd)`);

if (expectedFp === liveFp) {
  console.log(`\nOK — geen structurele drift.`);
  process.exit(0);
}

const added = liveStable.filter((n) => !expectedStable.includes(n));
const removed = expectedStable.filter((n) => !liveStable.includes(n));
console.log(`\nDRIFT — structurele wijziging gedetecteerd:`);
if (added.length) console.log(`  + nieuw veld:      ${added.join(", ")}`);
if (removed.length) console.log(`  - verdwenen veld:  ${removed.join(", ")}`);
console.log(`  -> reparatie: authoring-sessie met Claude, config bijwerken (from/transform voor nieuwe velden), hercompileren, contract-test.`);
process.exit(1);
