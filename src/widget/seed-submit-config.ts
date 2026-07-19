// SEED-tool (ALLEEN lokaal, eenmalig/bij-drift): converteert de v1-bronnen naar de
// v2-fabriek-BRONCONFIG voor de submit-laag. Provenance:
//  - submit-base.json      <- v1's HANDGESCHREVEN base-fieldmap (source/partial per veld)
//  - submit-variants.json  <- per-variant veldstellen uit de v1-variant-fieldmaps
//                             (zelf afgeleid uit portaal-HTML-opnames; toekomstige refresh
//                             loopt via de HTML-ingest, zie ingest-submit-form)
//  - fingerprint-matrix.json <- discovery-OPNAME (combo -> getekende form-hash), pass-through
//  - additional-field-policies.json <- v1's HANDGESCHREVEN policies
// De 4 velden van v1's handmatige "partial-toggle dans" worden hier DECLARATIEF:
// forceInAllVariants — de dans is daarmee weg als proces.
//
// Gebruik: npm run seed-submit   (schrijft portals/tff/widget/*, daarna npm run compile)

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PLUGSHIP = process.env.PLUGSHIP_DIR ?? join(homedir(), "plugship");
const GEN = join(PLUGSHIP, "client-config-gen/clients/tff");
if (!existsSync(GEN)) {
  console.error(`seed: v1-bronnen niet gevonden op ${GEN} (zet PLUGSHIP_DIR)`);
  process.exit(1);
}

const OUT = "portals/tff/widget";

// v1's dans-velden: in élke variant geforceerd, ongeacht de opname.
const FORCE_IN_ALL_VARIANTS = ["leveringscondities", "waardevangoederen", "factuurreferentie", "goederenomschrijving"];

// ---- submit-base: veld -> { source, partial, transform } uit de handgeschreven base
const baseFm = JSON.parse(readFileSync(join(GEN, "fieldmaps/D_submitShipmentbase_0.form-fieldmap.json"), "utf8")) as Record<string, any>;
const baseFields: Record<string, { source?: string; partial?: boolean; transform?: string }> = {};
for (const [name, d] of Object.entries(baseFm)) {
  baseFields[name] = {
    ...(d.source !== undefined && d.source !== "" ? { source: d.source } : {}),
    ...(d.partial === "yes" ? { partial: true } : {}),
    ...(d.transform !== undefined && d.transform !== "" ? { transform: d.transform } : {}),
  };
}
writeFileSync(`${OUT}/submit-base.json`, JSON.stringify({
  schemaVersion: 1,
  forceInAllVariants: FORCE_IN_ALL_VARIANTS,
  fields: baseFields,
}, null, 2) + "\n");

// ---- submit-variants: per getekende hash het veldstel (volgorde = opname-volgorde)
// BELANGRIJK (gemeten): v1's uitgeleverde widgetFieldsMatrix is een STALE artefact
// t.o.v. de huidige v1-bronbestanden (cache-gate + graft-runbook) — v1's eigen regel
// op de huidige fieldmaps reproduceert 'm 0/77. Productie-gedrag is de waarheid.
// De ontbrekende informatie is per variant: welke PARTIAL base-velden zaten er écht
// in het formulier. Bron daarvoor: (1) de HTML-opname als die er is, anders
// (2) het productie-artefact als laatst-bekende afleiding (provenance gemarkeerd).
const htmlIndexPath = join(GEN, "carrier-forms/fingerprintHtmlIndex.json");
const htmlIndex: Record<string, string> = existsSync(htmlIndexPath) ? JSON.parse(readFileSync(htmlIndexPath, "utf8")) : {};
const v1Matrix: Record<string, string[]> = JSON.parse(
  readFileSync(join(PLUGSHIP, "plugship-client-widget/src/lib/steps/widgetFieldsMatrix.json"), "utf8"),
);
const safeName = (s: string) => s.replace(/\W/g, "_");
const partialFields = Object.entries(baseFields).filter(([, d]) => d.partial).map(([n]) => n);

function htmlFieldNames(hash: string): Set<string> | null {
  const rel = htmlIndex[hash];
  if (!rel) return null;
  const p = join(GEN, "carrier-forms", rel);
  if (!existsSync(p)) return null;
  const html = readFileSync(p, "utf8");
  const names = new Set<string>();
  for (const m of html.matchAll(/<(?:input|select|textarea)[^>]*\bname="([^"]+)"/g)) names.add(m[1]);
  return names;
}

const variantFiles = readdirSync(join(GEN, "fieldmaps"))
  .filter((f) => /^D_submitShipment-?\d+_0\.form-fieldmap\.json$/.test(f));
const variants: Record<string, {
  fields: string[];
  widgetFields?: string[];
  partialPresent?: string[];
  presenceSource?: "html" | "v1-artifact";
  overrides?: Record<string, { source?: string; transform?: string }>;
}> = {};
for (const f of variantFiles) {
  const hash = f.replace(/^D_submitShipment/, "").replace(/_0\.form-fieldmap\.json$/, "");
  const fm = JSON.parse(readFileSync(join(GEN, "fieldmaps", f), "utf8")) as Record<string, any>;
  // Overrides: descriptor-info die van base afwijkt (variant-únieke velden met een
  // hand-ingevulde source, of per-variant afwijkende source) — anders gaat die
  // informatie verloren en klopt de widgetFieldsMatrix-afleiding niet.
  const overrides: Record<string, { source?: string; transform?: string }> = {};
  for (const [name, d] of Object.entries(fm)) {
    const b = baseFields[name];
    const src = d.source !== undefined && d.source !== "" ? String(d.source) : undefined;
    const tr = d.transform !== undefined && d.transform !== "" ? String(d.transform) : undefined;
    if ((src && src !== b?.source) || (tr && tr !== b?.transform)) {
      overrides[name] = { ...(src ? { source: src } : {}), ...(tr ? { transform: tr } : {}) };
    }
  }
  // partialPresent: welke partial base-velden zitten NATIEF in dit formulier.
  const names = htmlFieldNames(hash);
  let partialPresent: string[];
  let presenceSource: "html" | "v1-artifact";
  if (names) {
    presenceSource = "html";
    partialPresent = partialFields.filter((n) => names.has(n));
  } else {
    presenceSource = "v1-artifact";
    const entry = new Set(v1Matrix[hash] ?? []);
    partialPresent = partialFields.filter((n) => {
      const src = baseFields[n]?.source;
      return src ? entry.has(safeName(src)) : false;
    });
  }

  variants[hash] = {
    fields: Object.keys(fm),
    // CURATED bronconfig: de daadwerkelijke extra-widget-velden van dit formulier.
    // Het productie-artefact is bewezen GEEN pure functie van de overlevende bronnen
    // (bronnen evolueerden ná generatie: private-flag-fix, customs-upload). Daarom is
    // deze lijst zelf bron (reviewbaar); partialPresent/presenceSource blijven als
    // capture-metadata voor het ingest-diff-pad bij drift/nieuwe formulieren.
    widgetFields: v1Matrix[hash] ?? [],
    partialPresent,
    presenceSource,
    ...(Object.keys(overrides).length ? { overrides } : {}),
  };
}
writeFileSync(`${OUT}/submit-variants.json`, JSON.stringify({ schemaVersion: 1, variants }, null, 2) + "\n");

// ---- fingerprint-matrix (opname, pass-through) + policies (handgeschreven bron)
const fpm = readFileSync(join(GEN, "carrier-forms/fingerprintMatrix.json"), "utf8");
writeFileSync(`${OUT}/fingerprint-matrix.json`, fpm.trim() + "\n");
const pol = readFileSync(join(GEN, "additionalFieldPolicies.json"), "utf8");
writeFileSync(`${OUT}/additional-field-policies.json`, pol.trim() + "\n");

console.log(`seed: ${Object.keys(baseFields).length} base-velden, ${Object.keys(variants).length} varianten, ` +
  `${Object.keys(JSON.parse(fpm)).length} fingerprint-combos -> ${OUT}/`);
