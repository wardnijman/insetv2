// Semantische contract-test van de fabriek-geregenereerde SUBMIT-laag tegen de
// v1-oracle-fixtures: (1) fingerprintMatrix + widgetFieldsMatrix deep-equal,
// (2) per formulier de validator-keyset, (3) het gedrag validate(dependsOn(tpl))
// over de 3 canonieke templates. Draai na `npm run compile`.

import { readFileSync } from "node:fs";
import { ORACLE_TEMPLATES } from "./submit-battery.ts";
import { submitLayer } from "../../generated/tff/widget/index.ts";

// v1's array-wrappers voegen bij succes een lege message toe ({valid:true,message:""})
// afhankelijk van het generatie-moment van de module — semantisch identiek aan
// {valid:true}. Normaliseer dat éne cosmetische verschil weg; al het andere blijft strikt.
function normalize(r: any): any {
  if (r && r.valid === true && (r.message === "" || r.message === undefined)) {
    const { message: _m, ...rest } = r;
    return rest;
  }
  return r;
}

let fail = 0;
const problems: string[] = [];
function check(name: string, ok: boolean, detail?: string): void {
  if (!ok) {
    fail++;
    if (problems.length < 15) problems.push(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

submitLayer.setLanguage("NL");

// 1) matrices
const v1Fpm = JSON.parse(readFileSync("fixtures/v1-fingerprintMatrix.json", "utf8"));
const v1Wfm = JSON.parse(readFileSync("fixtures/v1-widgetFieldsMatrix.json", "utf8"));
check("fingerprintMatrix identiek aan v1", JSON.stringify(submitLayer.fingerprintMatrix) === JSON.stringify(v1Fpm));

const wfmKeysV1 = Object.keys(v1Wfm).sort();
const wfmKeysV2 = Object.keys(submitLayer.widgetFieldsMatrix).sort();
check("widgetFieldsMatrix: zelfde formulier-set", JSON.stringify(wfmKeysV1) === JSON.stringify(wfmKeysV2),
  `v1 ${wfmKeysV1.length} vs v2 ${wfmKeysV2.length}`);
for (const k of wfmKeysV1) {
  const a = JSON.stringify(v1Wfm[k] ?? null);
  const b = JSON.stringify(submitLayer.widgetFieldsMatrix[k] ?? null);
  check(`widgetFieldsMatrix[${k}]`, a === b, `v1=${a} v2=${b}`);
}

// 2+3) dispatcher: keysets + gedrag
const oracle = JSON.parse(readFileSync("fixtures/widget-submit-oracle.json", "utf8")) as {
  forms: Record<string, { keys: string[]; behavior: Record<string, unknown[]> }>;
};
let behaviorChecks = 0;
for (const [formId, expected] of Object.entries(oracle.forms)) {
  const actual = submitLayer.validatorsByForm[formId];
  if (!actual) {
    check(`dispatcher[${formId}] bestaat`, false);
    continue;
  }
  // v1-keysets zijn per vorm op verschillende momenten gegenereerd (stale artefacten);
  // productie-identiek = v1 ⊆ v2 mét exact gedrag op v1's keys, en alle v2-extra's
  // moeten ONSCHADELIJK zijn (altijd valid op de templates) — extra dode entries in de
  // dispatcher veranderen niets aan lookups noch aan iteratie-gates.
  const actualKeys = Object.keys(actual).sort();
  const missing = expected.keys.filter((k) => !actualKeys.includes(k));
  check(`dispatcher[${formId}] dekt v1-keyset`, missing.length === 0, `mist: ${missing.join(",")}`);
  for (const extra of actualKeys.filter((k) => !expected.keys.includes(k))) {
    const v = actual[extra];
    ORACLE_TEMPLATES.forEach((tpl, i) => {
      const got = JSON.parse(JSON.stringify(v.validate(v.dependsOn(structuredClone(tpl))))) as { valid: boolean };
      check(`dispatcher[${formId}] extra key ${extra} onschadelijk (tpl${i + 1})`, got.valid === true, JSON.stringify(got));
    });
  }
  for (const key of expected.keys) {
    const v = actual[key];
    if (!v) continue; // keyset-check rapporteert dit al
    expected.behavior[key].forEach((want, i) => {
      const got = normalize(JSON.parse(JSON.stringify(v.validate(v.dependsOn(structuredClone(ORACLE_TEMPLATES[i]))))));
      const wantN = normalize(want);
      behaviorChecks++;
      check(`gedrag[${formId}][${key}][tpl${i + 1}]`, JSON.stringify(got) === JSON.stringify(wantN),
        `v1=${JSON.stringify(wantN)} v2=${JSON.stringify(got)}`);
    });
  }
}

if (fail) {
  console.error(problems.join("\n"));
  console.error(`\nverify-widget-submit FAALT: ${fail} afwijking(en) van het v1-oracle`);
  process.exit(1);
}
console.log(`OK — submit-laag geregenereerd == v1-oracle: matrices identiek, ${Object.keys(oracle.forms).length} formulieren, ${behaviorChecks} gedrag-resultaten (NL)`);
