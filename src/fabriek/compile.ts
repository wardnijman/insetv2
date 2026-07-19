// DE FABRIEK. Leest de declaratieve bron-config van een portaal-flow, valideert, en
// emit een gegenereerde module in generated/ (gitignored). De gegenereerde module is
// PURE LIJM: geen logica, alleen wiring die primitieven bij naam aanroept.
//
// v2 (na §4.6): emit geneste target-paden (setPath), `const`-cellen en een `arrays`-blok
// (canonieke collectie -> lijst objecten). De {from,transform,args}-taal is ongewijzigd.
//
// Gebruik:  npm run compile [portaal]   (default 'tff')

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { primitives } from "../primitives/index.ts";
import type { Primitive } from "../primitives/index.ts";
import { validateFields } from "./schema.ts";
import type { FieldRule } from "./schema.ts";
import { hashConfig } from "./helpers.ts";

const COMPILER_VERSION = 2; // hoort in de vergelijkingssleutel (R1.5)

const portal = process.argv[2] ?? "tff";
const base = `portals/${portal}`;

const fields = JSON.parse(readFileSync(`${base}/fields.json`, "utf8"));

const overridesMod = await import(`../../${base}/rules/overrides.ts`);
const overrides = overridesMod.overrides as Record<string, Primitive>;
const known = new Set([...Object.keys(primitives), ...Object.keys(overrides)]);

const cfg = validateFields(fields, known);

// Eén cel -> JS-expressie, gegeven de bron-expressie (`input` of, in een array, `item`).
function ruleExpr(rule: FieldRule, src: string): string {
  if ("const" in rule) return JSON.stringify(rule.const ?? null);
  const fromExpr = rule.from === "*" ? src : `getPath(${src}, ${JSON.stringify(rule.from)})`;
  const args = (rule.args ?? []).map((a) => `getPath(${src}, ${JSON.stringify(a)})`);
  return `reg[${JSON.stringify(rule.transform)}](${[fromExpr, ...args].join(", ")})`;
}

const lines: string[] = [];
for (const [key, rule] of Object.entries(cfg.map)) {
  lines.push(`  setPath(out, ${JSON.stringify(key)}, ${ruleExpr(rule, "input")});`);
}
for (const [key, spec] of Object.entries(cfg.arrays ?? {})) {
  const itemLines = Object.entries(spec.item).map(
    ([subk, subrule]) => `    setPath(it, ${JSON.stringify(subk)}, ${ruleExpr(subrule, "item")});`,
  );
  lines.push(
    `  setPath(out, ${JSON.stringify(key)}, ((getPath(input, ${JSON.stringify(spec.from)}) ?? []) as any[]).map((item: any) => {\n` +
      `    const it: Record<string, unknown> = {};\n` +
      itemLines.join("\n") + `\n` +
      `    return it;\n` +
      `  }));`,
  );
}

const hash = hashConfig(cfg);
const src = `// AUTO-GEGENEREERD door de fabriek — NIET met de hand aanpassen (regeneratie overschrijft dit).
// Bron: ${base}/fields.json · flow: ${cfg.flow} · fingerprint: ${cfg.fingerprint}
// compiler v${COMPILER_VERSION} · config-hash ${hash}
import { primitives } from "../../src/primitives/index.ts";
import { overrides } from "../../${base}/rules/overrides.ts";
import { getPath, setPath } from "../../src/fabriek/helpers.ts";

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

const nArr = Object.keys(cfg.arrays ?? {}).length;
console.log(`fabriek: ${portal}/${cfg.flow} -> ${outPath}`);
console.log(`  ${Object.keys(cfg.map).length} map-velden${nArr ? ` + ${nArr} array(s)` : ""} · ${known.size} transforms beschikbaar · config-hash ${hash}`);

// ---- widget-laag (indien geconfigureerd): regels + domein + messages -> generated -
// Zelfde principe als de transform: bron = declaratieve config, emit = PURE LIJM die
// de gedeelde engine aanroept. Data wordt GEÏNLINED zodat het generated-bestand
// self-contained is (importeerbaar door node én vite, geen JSON-import-attributes).
if (existsSync(`${base}/widget/validation.json`)) {
  const rulesJson = readFileSync(`${base}/widget/validation.json`, "utf8").trim();
  const domainJson = readFileSync(`${base}/widget/domain.json`, "utf8").trim();
  const messagesJson = readFileSync(`${base}/widget/messages.json`, "utf8").trim();
  const widgetHash = hashConfig(JSON.parse(rulesJson));

  const widgetSrc = `// AUTO-GEGENEREERD door de fabriek — NIET met de hand aanpassen (regeneratie overschrijft dit).
// Bron: ${base}/widget/{validation,domain,messages}.json · compiler v${COMPILER_VERSION} · regels-hash ${widgetHash}
import { buildWidgetValidators } from "../../../src/widget/validation-engine.ts";
import type { WidgetValidationRules } from "../../../src/widget/validation-engine.ts";

const rules = ${rulesJson} as unknown as WidgetValidationRules;

export const domain = ${domainJson};

const messages = ${messagesJson};

export const widgetLayer = buildWidgetValidators({ rules, domain: domain as any, messages });
`;
  mkdirSync(`generated/${portal}/widget`, { recursive: true });
  writeFileSync(`generated/${portal}/widget/index.ts`, widgetSrc);
  console.log(`fabriek: ${portal}/widget-laag -> generated/${portal}/widget/index.ts · regels-hash ${widgetHash}`);
}
