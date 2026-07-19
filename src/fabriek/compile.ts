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

  // Submit-laag (route 2): base-veldstel + varianten + matrices, indien geconfigureerd.
  const hasSubmit = existsSync(`${base}/widget/submit-base.json`);
  const submitBlock = hasSubmit
    ? `
import { buildSubmitLayer } from "../../../src/widget/submit-validation-engine.ts";

const submitBase = ${readFileSync(`${base}/widget/submit-base.json`, "utf8").trim()};

const submitVariants = ${readFileSync(`${base}/widget/submit-variants.json`, "utf8").trim()};

const fingerprintMatrix = ${readFileSync(`${base}/widget/fingerprint-matrix.json`, "utf8").trim()} as Record<string, string>;

const additionalFieldPolicies = ${readFileSync(`${base}/widget/additional-field-policies.json`, "utf8").trim()};

export const submitLayer = buildSubmitLayer({
  rules, domain: domain as any, messages,
  base: submitBase as any, variantsCfg: submitVariants as any,
  fingerprintMatrix, additionalFieldPolicies,
});
`
    : "";

  const widgetSrc = `// AUTO-GEGENEREERD door de fabriek — NIET met de hand aanpassen (regeneratie overschrijft dit).
// Bron: ${base}/widget/{validation,domain,messages${hasSubmit ? ",submit-base,submit-variants,fingerprint-matrix,additional-field-policies" : ""}}.json · compiler v${COMPILER_VERSION} · regels-hash ${widgetHash}
import { buildWidgetValidators } from "../../../src/widget/validation-engine.ts";
import type { WidgetValidationRules } from "../../../src/widget/validation-engine.ts";

const rules = ${rulesJson} as unknown as WidgetValidationRules;

export const domain = ${domainJson};

const messages = ${messagesJson};

export const widgetLayer = buildWidgetValidators({ rules, domain: domain as any, messages });
${submitBlock}`;
  mkdirSync(`generated/${portal}/widget`, { recursive: true });
  writeFileSync(`generated/${portal}/widget/index.ts`, widgetSrc);
  console.log(`fabriek: ${portal}/widget-laag -> generated/${portal}/widget/index.ts · regels-hash ${widgetHash}`);

  // ---- payload-builders (boek-keten): choose + submit uit dezelfde bronconfig -----
  if (hasSubmit && existsSync(`${base}/widget/choose-option.json`)) {
    const submitBaseCfg = JSON.parse(readFileSync(`${base}/widget/submit-base.json`, "utf8"));
    const variantsCfgJson = JSON.parse(readFileSync(`${base}/widget/submit-variants.json`, "utf8"));
    const chooseCfg = JSON.parse(readFileSync(`${base}/widget/choose-option.json`, "utf8"));

    const baseFields: Record<string, { source: string; transform: string }> = {};
    for (const [name, d] of Object.entries(submitBaseCfg.fields as Record<string, any>)) {
      if (d.source && d.transform) baseFields[name] = { source: d.source, transform: d.transform };
    }
    const variantFields: Record<string, string[]> = {};
    for (const [h, v] of Object.entries(variantsCfgJson.variants as Record<string, any>)) variantFields[h] = v.fields;

    const payloadSrc = `// AUTO-GEGENEREERD door de fabriek — NIET met de hand aanpassen (regeneratie overschrijft dit).
// Payload-builders voor de boek-keten (choose + submit). Bron: ${base}/widget/
// {submit-base,submit-variants,choose-option}.json + rules/widget-transforms.ts.
// Semantiek bewaakt door de payload-oracle (verify-widget-payloads).
import { widgetTransforms as reg } from "../../../${base}/rules/widget-transforms.ts";

const BASE_FIELDS: Record<string, { source: string; transform: string }> = ${JSON.stringify(baseFields)};

const VARIANT_FIELDS: Record<string, string[]> = ${JSON.stringify(variantFields)};

const CHOOSE_FIELDS: Record<string, { source: string; transform: string }> = ${JSON.stringify(chooseCfg.fields)};

function getPath(obj: any, path: string): any {
  return path.replace(/\\[(\\d+)\\]/g, ".$1").split(".").reduce((a, p) => a?.[p], obj);
}

function apply(chain: string, value: any): unknown {
  let v = value;
  for (const name of chain.split("|").map((s) => s.trim())) {
    const fn = reg[name];
    if (!fn) throw new Error(\`onbekende widget-transform: \${name}\`);
    v = fn(v);
  }
  return v;
}

/** chooseOption-payload: pure doorvertaling van rate.reusableData (13 velden). */
export function buildChoosePayload(input: { reusableData: Record<string, unknown> }): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [field, d] of Object.entries(CHOOSE_FIELDS)) out[field] = apply(d.transform, getPath(input, d.source));
  return out;
}

/** submit-payload voor één formulier-variant: veldstel van de variant × base-descriptoren. */
export function buildSubmitPayload(formId: string, input: any): Record<string, unknown> {
  const fields = VARIANT_FIELDS[formId];
  if (!fields) throw new Error(\`onbekend submit-formulier: \${formId}\`);
  const out: Record<string, unknown> = {};
  for (const name of fields) {
    const d = BASE_FIELDS[name];
    if (!d) continue; // veld zonder mapping — v1's step sloeg het ook over
    out[name] = apply(d.transform, getPath(input, d.source));
  }
  return out;
}

export const SUBMIT_FORM_IDS: string[] = Object.keys(VARIANT_FIELDS);
`;
    writeFileSync(`generated/${portal}/widget/payload.ts`, payloadSrc);
    console.log(`fabriek: ${portal}/payload-builders -> generated/${portal}/widget/payload.ts (${Object.keys(variantFields).length} formulieren)`);
  }
}
