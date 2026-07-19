// ORACLE-runner (ALLEEN lokaal, niet in CI — vereist ~/plugship). Bundelt v1's echte
// generated validators met v1's eigen esbuild, draait de gedeelde case-batterij erdoor
// en bevriest de uitkomsten in fixtures/widget-validators-oracle.json. Draai opnieuw
// wanneer v1's validators veranderen (of bij een bewuste semantiek-wijziging) en
// commit de fixtures; CI replayt ze via verify-widget-validators.
//
// Gebruik: npm run oracle-widget   (schrijft fixtures + rapporteert per case)

import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { CASES } from "./validator-battery.ts";

const PLUGSHIP = process.env.PLUGSHIP_DIR ?? join(homedir(), "plugship");
const V1 = join(PLUGSHIP, "plugship-client-widget/src/lib/steps/validations/tff");
const ESBUILD = join(PLUGSHIP, "plugship-client-widget/node_modules/.pnpm/node_modules/.bin/esbuild");

if (!existsSync(V1)) {
  console.error(`oracle: v1-validators niet gevonden op ${V1} (zet PLUGSHIP_DIR)`);
  process.exit(1);
}

const outDir = join(tmpdir(), "inset-oracle");
mkdirSync(outDir, { recursive: true });

function bundle(name: string, entry: string): string {
  const out = join(outDir, `${name}.mjs`);
  execFileSync(ESBUILD, [entry, "--bundle", "--format=esm", `--outfile=${out}`, "--log-level=error"]);
  return out;
}

const bPath = bundle("oracle-B", join(V1, "B_getRates_0.validations.ts"));
const dPath = bundle("oracle-D", join(V1, "D_submitShipmentbase_0.validations.ts"));
const suites: Record<string, any> = {
  B: await import(bPath),
  D: await import(dPath),
};

const fixtures: { id: string; expected: unknown }[] = [];
let miss = 0;
for (const c of CASES) {
  const fn = suites[c.suite][c.fn];
  if (typeof fn !== "function") {
    console.error(`  ✗ ${c.id}: ${c.suite}-suite heeft geen ${c.fn}`);
    miss++;
    continue;
  }
  const result = fn(...structuredClone(c.args));
  fixtures.push({ id: c.id, expected: JSON.parse(JSON.stringify(result)) });
}

if (miss) {
  console.error(`oracle: ${miss} cases niet uitvoerbaar — fixtures NIET geschreven`);
  process.exit(1);
}

mkdirSync("fixtures", { recursive: true });
writeFileSync(
  "fixtures/widget-validators-oracle.json",
  JSON.stringify({ source: "v1 B_getRates_0 + D_submitShipmentbase_0 (esbuild-bundel, taal NL)", cases: fixtures }, null, 2) + "\n",
);
console.log(`oracle: ${fixtures.length} cases bevroren -> fixtures/widget-validators-oracle.json`);
