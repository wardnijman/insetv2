// RECORDER — INGEST van een submit-formulier-OPNAME (route 2): HTML-capture van een
// portaal-formulier -> veldstel voor submit-variants.json. Dit is het regeneratie-pad
// bij drift: nieuwe opname -> zelfde config-vorm -> compile emit alles opnieuw.
// Zelfde extractieregel als v1's generator (name-attributen van input/select/textarea).
//
// Gebruik:
//   node --experimental-strip-types src/recorder/ingest-submit-form.ts <form.html> <getekende-hash> [--write]
// Zonder --write: print het veldstel en (indien de hash al bestaat) de diff met de
// huidige config — dat is meteen de drift-weergave op veldstel-niveau.

import { readFileSync, writeFileSync } from "node:fs";

const [htmlPath, hash, flag] = process.argv.slice(2);
if (!htmlPath || !hash) {
  console.error("gebruik: ingest-submit-form <form.html> <getekende-hash> [--write]");
  process.exit(1);
}

const html = readFileSync(htmlPath, "utf8");
const names: string[] = [];
const seen = new Set<string>();
for (const m of html.matchAll(/<(?:input|select|textarea)[^>]*\bname="([^"]+)"/g)) {
  if (!seen.has(m[1])) {
    seen.add(m[1]);
    names.push(m[1]);
  }
}

const cfgPath = "portals/tff/widget/submit-variants.json";
const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
const current: string[] | undefined = cfg.variants[hash]?.fields;

console.log(`ingest-submit-form: ${htmlPath} -> ${names.length} velden (hash ${hash})`);
if (current) {
  const cur = new Set(current);
  const nw = new Set(names);
  const added = names.filter((n) => !cur.has(n));
  const removed = current.filter((n) => !nw.has(n));
  if (!added.length && !removed.length) console.log("  geen veldstel-drift t.o.v. huidige config");
  else {
    if (added.length) console.log(`  NIEUW in opname: ${added.join(", ")}`);
    if (removed.length) console.log(`  WEG in opname: ${removed.join(", ")}`);
  }
} else {
  console.log("  nieuwe variant (hash onbekend in config)");
}

if (flag === "--write") {
  cfg.variants[hash] = { fields: names };
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n");
  console.log(`  geschreven -> ${cfgPath} (draai npm run compile + verify)`);
}
