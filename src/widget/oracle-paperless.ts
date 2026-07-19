// PAPERLESS-ORACLE (ALLEEN lokaal — vereist ~/plugship). Bevriest per paperless-template
// twee dingen uit v1's ECHTE code:
//  1) de request-vorm van buildPaperlessInvoiceRequestFromShipment (utils/
//     paperlessInvoiceMapper.ts) — ShipmentTemplate -> ShipmentCreateRequest;
//  2) de invoice.php-FORMBODY: v1's generatePltInvoiceBlob (steps/paperlessInvoice.ts)
//     gedraaid met een capture-fetch die de URLSearchParams-body vastlegt en een nep-
//     base64-PDF ("JVBER...") teruggeeft — buildTffInvoicePhpPayload is privé in v1,
//     dus dit is de enige seam die 'm byte-voor-byte bevriest. Nooit netwerk.
// CI replayt via verify-paperless.ts tegen src/widget/paperless-mapper.ts.
//
// Gebruik: npm run oracle-paperless

import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { PAPERLESS_TEMPLATES } from "./payload-battery.ts";

const PLUGSHIP = process.env.PLUGSHIP_DIR ?? join(homedir(), "plugship");
const LIB = join(PLUGSHIP, "plugship-client-widget/src/lib");
const ESBUILD = join(PLUGSHIP, "plugship-client-widget/node_modules/.pnpm/node_modules/.bin/esbuild");
if (!existsSync(LIB)) {
  console.error(`oracle-paperless: v1-widget niet gevonden op ${LIB} (zet PLUGSHIP_DIR)`);
  process.exit(1);
}

// 1) mapper + blob-generator in één ESM-bundel (type-only imports erast esbuild)
const workdir = join(tmpdir(), "inset-oracle");
mkdirSync(workdir, { recursive: true });
const entry = join(workdir, "paperless-entry.ts");
writeFileSync(
  entry,
  `export { buildPaperlessInvoiceRequestFromShipment } from ${JSON.stringify(join(LIB, "utils/paperlessInvoiceMapper.ts"))};\n` +
    `export { generatePltInvoiceBlob } from ${JSON.stringify(join(LIB, "steps/paperlessInvoice.ts"))};\n`,
);
const out = join(workdir, "paperless-steps.mjs");
execFileSync(ESBUILD, [entry, "--bundle", "--format=esm", `--outfile=${out}`, "--log-level=error"]);
const { buildPaperlessInvoiceRequestFromShipment, generatePltInvoiceBlob } = await import(out);

// 2) capture-fetch: legt (url, formbody) vast en speelt invoice.php na met een nep-
//    base64-PDF — v1 valideert zelf op de "JVBER"-prefix (= "%PDF").
const FAKE_PDF_B64 = "JVBERi0xLjQ="; // base64("%PDF-1.4")
type Captured = { url: string; body: string };
function makeCaptureFetch(calls: Captured[]) {
  const fetchImpl = async (url: unknown, init: { body: unknown }) => {
    calls.push({ url: String(url), body: String(init.body) });
    return { ok: true, text: async () => FAKE_PDF_B64 };
  };
  return fetchImpl as unknown as typeof globalThis.fetch;
}

// 3) per template: request + invoice.php-body bevriezen
const templates: Record<string, { request: unknown; invoicePhpBody: string }> = {};
let phpUrl = "";
for (const [name, tpl] of Object.entries(PAPERLESS_TEMPLATES)) {
  const request = buildPaperlessInvoiceRequestFromShipment(
    structuredClone(tpl.shipment),
    structuredClone(tpl.buildOpts),
  );

  const calls: Captured[] = [];
  const result = await generatePltInvoiceBlob({
    req: structuredClone(request),
    ctx: { fetch: makeCaptureFetch(calls) },
    sessionkey: tpl.php.sessionkey,
    customerId: tpl.php.customerId,
    carrier: tpl.php.carrier,
    serviceDescription: tpl.php.serviceDescription,
  });
  if (calls.length !== 1) throw new Error(`${name}: verwacht 1 invoice.php-POST, kreeg ${calls.length}`);
  if (result?.invoice?.base64 !== FAKE_PDF_B64) throw new Error(`${name}: blob-resultaat kwam niet uit de capture-fetch`);
  if (phpUrl && phpUrl !== calls[0].url) throw new Error(`${name}: invoice.php-URL wijkt af (${calls[0].url})`);
  phpUrl = calls[0].url;

  templates[name] = { request, invoicePhpBody: calls[0].body };
}

writeFileSync(
  "fixtures/paperless-mapper-oracle.json",
  JSON.stringify(
    {
      source: "v1 buildPaperlessInvoiceRequestFromShipment + generatePltInvoiceBlob (esbuild-bundel, capture-fetch)",
      invoicePhpUrl: phpUrl,
      templates,
    },
    null,
    1,
  ) + "\n",
);
console.log(
  `oracle-paperless: ${Object.keys(templates).length} templates bevroren (request + invoice.php-formbody) -> fixtures/paperless-mapper-oracle.json`,
);
