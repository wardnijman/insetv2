// Semantische contract-test van de fabriek-geëmitte widget-validators tegen de
// ORACLE-fixtures (uitkomsten van v1's echte generated validators, bevroren door
// oracle-widget-validators). Vergelijkt het VOLLEDIGE resultaat (valid, reason,
// path én message) — de messages bewijzen ook de catalogus-extractie.
// Draai na `npm run compile` (voor generated/tff/widget).

import { readFileSync } from "node:fs";
import { CASES } from "./validator-battery.ts";
import { widgetLayer } from "../../generated/tff/widget/index.ts";

const oracle = JSON.parse(readFileSync("fixtures/widget-validators-oracle.json", "utf8")) as {
  cases: { id: string; expected: unknown }[];
};
const expectedById = new Map(oracle.cases.map((c) => [c.id, c.expected]));

const suites: Record<string, Record<string, (...a: any[]) => unknown>> = {
  B: widgetLayer.fns as any,
  D: widgetLayer.gridFns as any,
};

widgetLayer.setLanguage("NL"); // oracle is op NL bevroren

let fail = 0;
let run = 0;
for (const c of CASES) {
  const expected = expectedById.get(c.id);
  if (expected === undefined) {
    console.error(`  ✗ ${c.id}: geen oracle-fixture (draai npm run oracle-widget)`);
    fail++;
    continue;
  }
  const fn = suites[c.suite][c.fn];
  if (typeof fn !== "function") {
    console.error(`  ✗ ${c.id}: widgetLayer mist ${c.suite}.${c.fn}`);
    fail++;
    continue;
  }
  const actual = JSON.parse(JSON.stringify(fn(...structuredClone(c.args))));
  run++;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error(`  ✗ ${c.id}\n      verwacht: ${JSON.stringify(expected)}\n      gekregen: ${JSON.stringify(actual)}`);
    fail++;
  }
}

if (fail) {
  console.error(`\nverify-widget-validators FAALT: ${fail} afwijking(en) van het v1-oracle (${run} cases gedraaid)`);
  process.exit(1);
}
console.log(`OK — widget-validators semantisch identiek aan v1-oracle (${run} cases, incl. messages/NL)`);
