// Semantische contract-test van de geporte paperless-mapper (src/widget/
// paperless-mapper.ts) tegen de v1-oracle-fixtures: per template moet
//  1) buildPaperlessInvoiceRequestFromShipment byte-voor-byte (na JSON-roundtrip)
//     dezelfde request opleveren als v1's mapper, en
//  2) buildTffInvoicePhpPayload + encodeInvoicePhpBody exact dezelfde invoice.php-
//     FORMBODY als v1's generatePltInvoiceBlob (URLSearchParams-bytes).
// CI-veilig: replayt uitsluitend fixtures — geen ~/plugship, geen netwerk.

import { readFileSync } from "node:fs";
import { PAPERLESS_TEMPLATES } from "./payload-battery.ts";
import {
  buildPaperlessInvoiceRequestFromShipment,
  buildTffInvoicePhpPayload,
  encodeInvoicePhpBody,
  INVOICE_PHP_URL,
  type PaperlessShipmentLike,
} from "./paperless-mapper.ts";

const oracle = JSON.parse(readFileSync("fixtures/paperless-mapper-oracle.json", "utf8")) as {
  invoicePhpUrl: string;
  templates: Record<string, { request: Record<string, unknown>; invoicePhpBody: string }>;
};

let fail = 0;
const problems: string[] = [];
function check(name: string, ok: boolean, detail?: string): void {
  if (!ok) {
    fail++;
    if (problems.length < 15) problems.push(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// Eerste afwijkende pad in twee JSON-bomen (incl. sleutelVOLGORDE: de request wordt
// als JSON verstuurd en de fixture bevriest v1's volgorde).
function firstDiff(want: unknown, got: unknown, path = "$"): string | null {
  const w = JSON.stringify(want);
  const g = JSON.stringify(got);
  if (w === g) return null;
  if (want && got && typeof want === "object" && typeof got === "object" && !Array.isArray(want) && !Array.isArray(got)) {
    const wk = Object.keys(want as object);
    const gk = Object.keys(got as object);
    if (JSON.stringify(wk) !== JSON.stringify(gk)) {
      return `${path}: sleutels/volgorde v1=[${wk.join(",")}] v2=[${gk.join(",")}]`;
    }
    for (const k of wk) {
      const d = firstDiff((want as any)[k], (got as any)[k], `${path}.${k}`);
      if (d) return d;
    }
  }
  if (Array.isArray(want) && Array.isArray(got)) {
    if (want.length !== got.length) return `${path}: lengte v1=${want.length} v2=${got.length}`;
    for (let i = 0; i < want.length; i++) {
      const d = firstDiff(want[i], got[i], `${path}[${i}]`);
      if (d) return d;
    }
  }
  return `${path}: v1=${w?.slice(0, 120)} v2=${g?.slice(0, 120)}`;
}

const roundtrip = (v: unknown): unknown => JSON.parse(JSON.stringify(v));

// 0) template-set fixture == battery, en de bevroren pdf-service-URL == onze constante
const fxNames = Object.keys(oracle.templates).sort();
const batNames = Object.keys(PAPERLESS_TEMPLATES).sort();
check("template-set identiek aan battery", JSON.stringify(fxNames) === JSON.stringify(batNames),
  `fixture=[${fxNames.join(",")}] battery=[${batNames.join(",")}]`);
check("invoice.php-URL == INVOICE_PHP_URL", oracle.invoicePhpUrl === INVOICE_PHP_URL,
  `fixture=${oracle.invoicePhpUrl} v2=${INVOICE_PHP_URL}`);

// 1) per template: request byte-identiek + invoice.php-formbody byte-identiek
let nBodies = 0;
for (const [name, frozen] of Object.entries(oracle.templates)) {
  const tpl = PAPERLESS_TEMPLATES[name];
  if (!tpl) continue; // set-verschil is hierboven al geflagd

  let got: ReturnType<typeof buildPaperlessInvoiceRequestFromShipment>;
  try {
    got = buildPaperlessInvoiceRequestFromShipment(
      structuredClone(tpl.shipment) as PaperlessShipmentLike,
      structuredClone(tpl.buildOpts),
    );
  } catch (e) {
    check(`request[${name}]`, false, (e as Error).message);
    continue;
  }
  const want = roundtrip(frozen.request);
  const reqDiff = firstDiff(want, roundtrip(got));
  check(`request[${name}] byte-identiek aan v1-mapper`, reqDiff === null, reqDiff ?? undefined);

  // Formbody bouwen op de VERIFIEERDE v2-request (zelfde input als v1's blob-pad kreeg).
  const body = encodeInvoicePhpBody(
    buildTffInvoicePhpPayload({
      req: got,
      customerId: tpl.php.customerId,
      sessionkey: tpl.php.sessionkey,
      carrier: tpl.php.carrier,
      serviceDescription: tpl.php.serviceDescription,
    }),
  );
  if (body !== frozen.invoicePhpBody) {
    // eerste afwijkende param zichtbaar maken (de body is één lange urlencoded string)
    const wantParts = frozen.invoicePhpBody.split("&");
    const gotParts = body.split("&");
    let detail = `lengte v1=${wantParts.length} v2=${gotParts.length}`;
    for (let i = 0; i < Math.max(wantParts.length, gotParts.length); i++) {
      if (wantParts[i] !== gotParts[i]) {
        detail = `param ${i}: v1=${wantParts[i] ?? "<ontbreekt>"} v2=${gotParts[i] ?? "<ontbreekt>"}`;
        break;
      }
    }
    check(`invoice.php-body[${name}] byte-identiek aan v1`, false, detail);
  } else {
    nBodies++;
  }
}

if (fail) {
  console.error(problems.join("\n"));
  console.error(`\nverify-paperless FAALT: ${fail} afwijking(en) van het v1-paperless-oracle`);
  process.exit(1);
}
console.log(
  `OK — paperless-mapper == v1-oracle: ${fxNames.length} templates, request + invoice.php-formbody (${nBodies}×) byte-identiek`,
);
