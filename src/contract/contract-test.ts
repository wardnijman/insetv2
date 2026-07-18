// CONTRACT-TEST (laag 0 uit de testpiramide). Draait de gecompileerde transform
// op bekende inputs en toetst de GECANONICALISEERDE payload veld-voor-veld met
// matching rules. Dit is de O19-vanger: een boeking die structureel "slaagt" maar
// de verkeerde WAARDE verstuurt, valt hier rood.
//
// Gebruik:  npm run contract-test      (draai eerst `npm run compile`)

import { readFileSync } from "node:fs";
import { transform } from "../../generated/tff/getRates.ts";
import { canonicalize } from "../fabriek/helpers.ts";
import { matchField } from "./matchers.ts";

const fields = JSON.parse(readFileSync("portals/tff/fields.json", "utf8"));
const drop: string[] = fields.canonicalize?.dropFields ?? [];
const golden = JSON.parse(readFileSync("portals/tff/fixtures/getRates.golden.json", "utf8"));

let failures = 0;

for (const c of golden.cases) {
  const payload = canonicalize(transform(c.input), drop);
  const errs: string[] = [];

  for (const [field, expected] of Object.entries(c.expect)) {
    const err = matchField(payload[field], expected);
    if (err) errs.push(`      ${field}: ${err}`);
  }
  // Onverwachte extra velden na canonicalisatie = ook drift.
  for (const field of Object.keys(payload)) {
    if (!(field in c.expect)) errs.push(`      ${field}: onverwacht veld in payload (${JSON.stringify(payload[field])})`);
  }

  if (errs.length) {
    failures++;
    console.log(`  ✗ ${c.name}\n${errs.join("\n")}`);
  } else {
    console.log(`  ✓ ${c.name}`);
  }
}

console.log(failures ? `\nFAIL — ${failures} case(s) rood` : `\nOK — alle contract-cases groen`);
process.exit(failures ? 1 : 0);
