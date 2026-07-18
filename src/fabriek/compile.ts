// DE FABRIEK. Leest de declaratieve bron-config van een portaal-flow, valideert,
// en emit een gegenereerde module in generated/ (gitignored). De gegenereerde
// module is PURE LIJM: geen logica, alleen wiring die primitieven bij naam aanroept.
//
// Gebruik:  npm run compile            (default portaal 'tff')
//           node --experimental-strip-types src/fabriek/compile.ts <portaal>

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { primitives } from "../primitives/index.ts";
import type { Primitive } from "../primitives/index.ts";
import { validateFields } from "./schema.ts";
import { hashConfig } from "./helpers.ts";

const COMPILER_VERSION = 1; // hoort in de vergelijkingssleutel (R1.5): eigen wijziging ≠ portaal-drift

const portal = process.argv[2] ?? "tff";
const base = `portals/${portal}`;

const fields = JSON.parse(readFileSync(`${base}/fields.json`, "utf8"));

// Portaal-overrides dynamisch inladen; samen met de generieke primitieven vormen
// ze de bekende transform-namen.
const overridesMod = await import(`../../${base}/rules/overrides.ts`);
const overrides = overridesMod.overrides as Record<string, Primitive>;
const known = new Set([...Object.keys(primitives), ...Object.keys(overrides)]);

const cfg = validateFields(fields, known);

// Bouw de wiring-regels: één regel per outputveld, roept de transform bij naam aan.
const lines: string[] = [];
for (const [field, rule] of Object.entries(cfg.map)) {
  const argExprs = [
    `getPath(input, ${JSON.stringify(rule.from)})`,
    ...(rule.args ?? []).map((a) => `getPath(input, ${JSON.stringify(a)})`),
  ];
  lines.push(`  out[${JSON.stringify(field)}] = reg[${JSON.stringify(rule.transform)}](${argExprs.join(", ")});`);
}

const hash = hashConfig(cfg);
const src = `// AUTO-GEGENEREERD door de fabriek — NIET met de hand aanpassen (regeneratie overschrijft dit).
// Bron: ${base}/fields.json · flow: ${cfg.flow} · fingerprint: ${cfg.fingerprint}
// compiler v${COMPILER_VERSION} · config-hash ${hash}
import { primitives } from "../../src/primitives/index.ts";
import { overrides } from "../../${base}/rules/overrides.ts";
import { getPath } from "../../src/fabriek/helpers.ts";

const reg = { ...primitives, ...overrides };

export function transform(input: any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
${lines.join("\n")}
  return out;
}
`;

mkdirSync(`generated/${portal}`, { recursive: true });
const outPath = `generated/${portal}/${cfg.flow}.ts`;
writeFileSync(outPath, src);

console.log(`fabriek: ${portal}/${cfg.flow} -> ${outPath}`);
console.log(`  ${Object.keys(cfg.map).length} velden · ${known.size} transforms beschikbaar · config-hash ${hash}`);
