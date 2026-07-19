// PAYLOAD-ORACLE (ALLEEN lokaal — vereist ~/plugship). Bevriest de payloads die v1's
// ECHTE generated steps bouwen: per submitShipment-formulier de POST-body + URL, en
// idem voor chooseOption — via een capture-fetch die nooit het netwerk raakt.
// Per formulier: eerst het EXPORT-template, bij throw (VALIDATION_ERROR/transform-
// error) het EU-template; falen beide dan is dat een template-gat en faalt de run.
// CI replayt via verify-widget-payloads tegen generated/tff/widget/payload.ts.
//
// Gebruik: npm run oracle-payloads

import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { PAYLOAD_TEMPLATES, chooseInputFrom } from "./payload-battery.ts";

const PLUGSHIP = process.env.PLUGSHIP_DIR ?? join(homedir(), "plugship");
const WIDGET = join(PLUGSHIP, "plugship-client-widget/src/lib/steps");
const ESBUILD = join(PLUGSHIP, "plugship-client-widget/node_modules/.pnpm/node_modules/.bin/esbuild");
if (!existsSync(WIDGET)) {
  console.error(`oracle-payloads: v1-widget niet gevonden op ${WIDGET} (zet PLUGSHIP_DIR)`);
  process.exit(1);
}

// 1) dispatcher + chooseOption in één ESM-bundel
const workdir = join(tmpdir(), "inset-oracle");
mkdirSync(workdir, { recursive: true });
const entry = join(workdir, "payload-entry.ts");
writeFileSync(
  entry,
  `export { submitShipmentHandlers } from ${JSON.stringify(join(WIDGET, "submitShipmentHandlers.ts"))};\n` +
    `export { chooseOption } from ${JSON.stringify(join(WIDGET, "chooseOption.ts"))};\n`,
);
const out = join(workdir, "payload-steps.mjs");
execFileSync(ESBUILD, [entry, "--bundle", "--format=esm", `--outfile=${out}`, "--log-level=error"]);
const { submitShipmentHandlers, chooseOption } = await import(out);

// 2) capture-fetch: legt (url, body) vast, raakt nooit het netwerk
type Captured = { url: string; payload: Record<string, unknown> };
function makeCtx(calls: Captured[]) {
  const fetchImpl = async (url: unknown, init: { body: string }) => {
    calls.push({ url: String(url), payload: JSON.parse(init.body) });
    return { ok: true, json: async () => ({ ok: true }) };
  };
  return { fetch: fetchImpl as typeof globalThis.fetch, cookieHeader: "", baseUrl: "http://oracle" };
}

// 3) chooseOption bevriezen (EXPORT-template)
const chooseCalls: Captured[] = [];
await chooseOption(chooseInputFrom(PAYLOAD_TEMPLATES.EXPORT), makeCtx(chooseCalls));
if (chooseCalls.length !== 1) throw new Error(`chooseOption: verwacht 1 POST, kreeg ${chooseCalls.length}`);
const choose = { template: "EXPORT" as const, ...chooseCalls[0] };

// 4) alle submit-formulieren bevriezen: EXPORT, anders EU, anders template-gat
const forms: Record<string, { template: string; url: string; payload: Record<string, unknown> }> = {};
const gaps: { formId: string; export: string; eu: string }[] = [];
const formIds = Object.keys(submitShipmentHandlers as Record<string, unknown>).sort();
let nExport = 0;
let nEu = 0;
for (const formId of formIds) {
  const handler = (submitShipmentHandlers as Record<string, (input: any, ctx: any) => Promise<unknown>>)[formId];
  let exportErr = "";
  for (const template of ["EXPORT", "EU"] as const) {
    const calls: Captured[] = [];
    try {
      await handler(structuredClone(PAYLOAD_TEMPLATES[template]), makeCtx(calls));
      if (calls.length !== 1) throw new Error(`verwacht 1 POST, kreeg ${calls.length}`);
      forms[formId] = { template, ...calls[0] };
      template === "EXPORT" ? nExport++ : nEu++;
      break;
    } catch (e) {
      const msg = (e as Error).message;
      if (template === "EXPORT") exportErr = msg;
      else gaps.push({ formId, export: exportErr, eu: msg });
    }
  }
}

if (gaps.length) {
  console.error(`oracle-payloads: ${gaps.length} template-gat(en) — verrijk payload-battery.ts:`);
  for (const g of gaps) console.error(`  ✗ ${g.formId}\n      EXPORT: ${g.export}\n      EU:     ${g.eu}`);
  process.exit(1);
}

writeFileSync(
  "fixtures/widget-payloads-oracle.json",
  JSON.stringify({ source: "v1 submitShipmentHandlers + chooseOption (esbuild-bundel, capture-fetch)", choose, forms }, null, 1) + "\n",
);
console.log(
  `oracle-payloads: ${formIds.length}/${formIds.length} formulieren bevroren (${nExport}× EXPORT, ${nEu}× EU) + chooseOption -> fixtures/widget-payloads-oracle.json`,
);
