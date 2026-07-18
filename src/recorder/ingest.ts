// RECORDER — INGEST (slice 2). Neemt een opgenomen portaal-request (de output van
// een recorder/MITM-proxy) en zet 'm om naar COMPACTE, gestructureerde input voor
// Claude (R6.4/R5.1): het ontdekte veld-stel, een GENORMALISEERDE fingerprint
// (volatiele velden gestript -> stabiel over captures heen), en een draft
// fields-config die Claude invult (from/transform).
//
// Gebruik: node --experimental-strip-types src/recorder/ingest.ts <capture.json>

import { readFileSync, writeFileSync } from "node:fs";
import { classify, fingerprintOf } from "../shared/fingerprint.ts";

const capturePath = process.argv[2] ?? "portals/tff/captures/getRates.capture-1.json";
const cap = JSON.parse(readFileSync(capturePath, "utf8"));

const fields: Record<string, unknown> = cap.request?.fields ?? {};

// Dezelfde fingerprint-logica als de drift-probe (gedeeld, R1.6).
const { stable, volatile } = classify(fields);
const fingerprint = fingerprintOf(stable);

// Draft fields-config: stabiele velden met from/transform = TODO (Claude vult in),
// volatiele velden landen in canonicalize.dropFields.
const draft = {
  schemaVersion: 1,
  flow: cap.flow,
  fingerprint,
  canonicalize: { dropFields: volatile },
  map: Object.fromEntries(
    stable.map((n) => [n, { from: "TODO", transform: "TODO", observed: fields[n] }]),
  ),
};
const draftPath = `portals/${cap.portal}/${cap.flow}.draft.json`;
writeFileSync(draftPath, JSON.stringify(draft, null, 2) + "\n");

console.log(`ingest: ${capturePath}`);
console.log(`  fingerprint (stabiel veld-stel): ${fingerprint}`);
console.log(`  ${stable.length} stabiele velden, ${volatile.length} volatiel gemarkeerd: ${volatile.join(", ") || "(geen)"}`);
console.log(`  draft -> ${draftPath} (from/transform = TODO, in te vullen door Claude)`);
