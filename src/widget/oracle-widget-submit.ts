// SUBMIT-ORACLE (ALLEEN lokaal — vereist ~/plugship). Bevriest v1's submit-artefacten
// als fixtures: (1) widgetFieldsMatrix + fingerprintMatrix (byte-waarheid), (2) per
// formulier de validator-KEYSET én het GEDRAG: validate(dependsOn(template)) voor elke
// key over 3 canonieke templates. CI replayt via verify-widget-submit.
//
// Gebruik: npm run oracle-submit

import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { ORACLE_TEMPLATES } from "./submit-battery.ts";

const PLUGSHIP = process.env.PLUGSHIP_DIR ?? join(homedir(), "plugship");
const WIDGET = join(PLUGSHIP, "plugship-client-widget/src/lib/steps");
const ESBUILD = join(PLUGSHIP, "plugship-client-widget/node_modules/.pnpm/node_modules/.bin/esbuild");
if (!existsSync(WIDGET)) {
  console.error(`oracle-submit: v1-widget niet gevonden op ${WIDGET} (zet PLUGSHIP_DIR)`);
  process.exit(1);
}

// 1) matrices verbatim bevriezen
mkdirSync("fixtures", { recursive: true });
writeFileSync("fixtures/v1-widgetFieldsMatrix.json", readFileSync(join(WIDGET, "widgetFieldsMatrix.json")));
writeFileSync("fixtures/v1-fingerprintMatrix.json", readFileSync(join(WIDGET, "fingerprintMatrix.json")));

// 2) dispatcher bundelen en gedrag bevriezen
const out = join(tmpdir(), "inset-oracle", "submit-dispatcher.mjs");
mkdirSync(join(tmpdir(), "inset-oracle"), { recursive: true });
execFileSync(ESBUILD, [join(WIDGET, "submitShipmentValidators.ts"), "--bundle", "--format=esm", `--outfile=${out}`, "--log-level=error"]);
const { submitShipmentValidators } = await import(out);

const forms: Record<string, { keys: string[]; behavior: Record<string, unknown[]> }> = {};
for (const [formId, validators] of Object.entries(submitShipmentValidators as Record<string, Record<string, any>>)) {
  const keys = Object.keys(validators).sort();
  const behavior: Record<string, unknown[]> = {};
  for (const key of keys) {
    const v = validators[key];
    behavior[key] = ORACLE_TEMPLATES.map((tpl) => {
      try {
        return JSON.parse(JSON.stringify(v.validate(v.dependsOn(structuredClone(tpl)))));
      } catch (e) {
        return { __threw: (e as Error).message };
      }
    });
  }
  forms[formId] = { keys, behavior };
}

writeFileSync(
  "fixtures/widget-submit-oracle.json",
  JSON.stringify({ source: "v1 submitShipmentValidators (esbuild-bundel, taal NL)", forms }, null, 1) + "\n",
);
const n = Object.keys(forms).length;
const nChecks = Object.values(forms).reduce((a, f) => a + f.keys.length, 0) * ORACLE_TEMPLATES.length;
console.log(`oracle-submit: ${n} formulieren, ${nChecks} gedrag-resultaten bevroren -> fixtures/`);
