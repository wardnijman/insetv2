// Semantische contract-test van de fabriek-gegenereerde PAYLOAD-builders tegen de
// v1-payload-oracle-fixtures: per submit-formulier moet buildSubmitPayload(formId, tpl)
// byte-voor-byte (na JSON-roundtrip) dezelfde POST-body opleveren als v1's echte
// generated step; idem buildChoosePayload vs v1's chooseOption. Draai na `npm run compile`.
//
// Normalisatie: uitsluitend de JSON-roundtrip zelf — keys met waarde undefined vervallen
// aan BEIDE kanten, precies wat v1's JSON.stringify(body) ook deed. Verder niets.

import { readFileSync } from "node:fs";
import { PAYLOAD_TEMPLATES, chooseInputFrom } from "./payload-battery.ts";
import { buildSubmitPayload, buildChoosePayload, SUBMIT_FORM_IDS } from "../../generated/tff/widget/payload.ts";

type FrozenCall = { template: string; url: string; payload: Record<string, unknown> };
const oracle = JSON.parse(readFileSync("fixtures/widget-payloads-oracle.json", "utf8")) as {
  choose: FrozenCall;
  forms: Record<string, FrozenCall>;
};

// JSON-roundtrip: dropt undefined-keys (v1's JSON.stringify deed dat ook) en dwingt
// pure-JSON-vergelijkbaarheid af.
const roundtrip = (v: unknown): Record<string, unknown> => JSON.parse(JSON.stringify(v));

let fail = 0;
const problems: string[] = [];
function check(name: string, ok: boolean, detail?: string): void {
  if (!ok) {
    fail++;
    if (problems.length < 15) problems.push(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function diffFields(name: string, want: Record<string, unknown>, got: Record<string, unknown>): void {
  const before = fail;
  const keys = [...new Set([...Object.keys(want), ...Object.keys(got)])].sort();
  for (const k of keys) {
    const w = k in want ? JSON.stringify(want[k]) : "<ontbreekt>";
    const g = k in got ? JSON.stringify(got[k]) : "<ontbreekt>";
    check(`${name}[${k}]`, w === g, `v1=${w} v2=${g}`);
  }
  // alle velden gelijk maar bytes niet → volgorde-afwijking (POST-body is byte-voor-byte)
  check(`${name} veldvolgorde identiek`, fail > before || JSON.stringify(Object.keys(want)) === JSON.stringify(Object.keys(got)),
    `v1=${Object.keys(want).join(",")} v2=${Object.keys(got).join(",")}`);
}

// 1) formulier-set: fixture == generator
const fxIds = Object.keys(oracle.forms).sort();
const v2Ids = [...SUBMIT_FORM_IDS].sort();
check("submit-formulier-set identiek aan v1-dispatcher", JSON.stringify(fxIds) === JSON.stringify(v2Ids),
  `v1 ${fxIds.length} vs v2 ${v2Ids.length}`);

// 2) per formulier: payload byte-identiek
let nFields = 0;
for (const [formId, frozen] of Object.entries(oracle.forms)) {
  const tpl = PAYLOAD_TEMPLATES[frozen.template as "EXPORT" | "EU"];
  if (!tpl) {
    check(`fixture[${formId}] kent template ${frozen.template}`, false);
    continue;
  }
  let got: Record<string, unknown>;
  try {
    got = roundtrip(buildSubmitPayload(formId, structuredClone(tpl)));
  } catch (e) {
    check(`buildSubmitPayload(${formId})`, false, (e as Error).message);
    continue;
  }
  const want = roundtrip(frozen.payload);
  nFields += Object.keys(want).length;
  if (JSON.stringify(got) !== JSON.stringify(want)) diffFields(`payload[${formId}]`, want, got);
}

// 3) chooseOption
{
  const tpl = PAYLOAD_TEMPLATES[oracle.choose.template as "EXPORT" | "EU"];
  const got = roundtrip(buildChoosePayload(chooseInputFrom(tpl)));
  const want = roundtrip(oracle.choose.payload);
  if (JSON.stringify(got) !== JSON.stringify(want)) diffFields("choose", want, got);
}

if (fail) {
  console.error(problems.join("\n"));
  console.error(`\nverify-widget-payloads FAALT: ${fail} afwijking(en) van het v1-payload-oracle`);
  process.exit(1);
}
console.log(`OK — payload-builders == v1-oracle: ${fxIds.length} submit-formulieren (${nFields} velden) + chooseOption byte-identiek`);
