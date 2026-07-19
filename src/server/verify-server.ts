// Test van de widget-proxy (proxy-first): widget-shaped requests → server → runtime
// (pool + transform + mock-portaal) → antwoord. Offline: draait tegen de mock-adapter,
// dus dit is de end-to-end DATA-route van de widget minus de browser.

import { rmSync } from "node:fs";
import { startServer } from "./server.ts";

let fail = 0;
function check(n: string, ok: boolean): void {
  console.log(`  ${ok ? "✓" : "✗"} ${n}`);
  if (!ok) fail++;
}

const TENANT = "dev-standalone";
rmSync(`.data/${TENANT}.db`, { force: true });

const { port, close } = await startServer(0);
const base = `http://127.0.0.1:${port}/t/${TENANT}`;

// 1) rates: canoniek zendingsmodel in, tarieven uit (via pool + transform + mock-portaal)
const shipment = {
  shipperAddress: { country: "NL", postalCode: "1011AB", street: ["Damrak 1", ""] },
  recipientAddress: { country: "DE", postalCode: "10115", street: ["Unter den Linden 5", ""] },
  packages: [{ weight: 2 }, { weight: 0.5 }],
};
const ratesRes = await fetch(`${base}/api/rates`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ shipment }),
});
const rates = (await ratesRes.json()) as { rates?: { carrier: string; price: number }[] };
check("rates: 200 + tarievenlijst uit het (mock-)portaal", ratesRes.status === 200 && (rates.rates?.length ?? 0) >= 1);
check("rates: gewicht geaggregeerd over colli (prijs > basistarief)", (rates.rates?.[0]?.price ?? 0) > 5);

// 2) config-roundtrip: v1-contract (update met pad → get levert 'm terug)
await fetch(`${base}/api/config/update`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ userId: "u1", update: { "preferences.receiverProfiles": [{ label: "Acme • 1011AB" }] } }),
});
const cfg = (await (
  await fetch(`${base}/api/config/get`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: "u1" }),
  })
).json()) as any;
check("config: roundtrip via per-tenant SQLite", cfg.preferences?.receiverProfiles?.[0]?.label === "Acme • 1011AB");

// 3) tenant-isolatie: andere tenant ziet de prefs niet
const other = (await (
  await fetch(`http://127.0.0.1:${port}/t/tff-forwarder/api/config/get`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: "u1" }),
  })
).json()) as any;
check("config: tenant-geïsoleerd (andere tenant leeg)", !other.preferences);

// 4) regio's + parse-address-contract
const us = (await (await fetch(`${base}/api/domain/country-and-region?country=US`)).json()) as any[];
check("regio's: US bevat California→CA", us.some((r) => r.value === "CA" && r.label === "California"));
const parse = await fetch(`${base}/api/ai/parse-address`, { method: "POST", body: "{}" });
check("parse-address: 503 ai_not_configured (v1-contract)", parse.status === 503);

// 5) product-profielen: learn (per-veld merge) → get
await fetch(`${base}/api/product-profiles/learn`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ userId: "u1", products: [{ sku: "SKU-9", hsCode: "490199", value: 25, weight: 0.8, originCountry: "NL" }] }),
});
await fetch(`${base}/api/product-profiles/learn`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ userId: "u1", products: [{ sku: "SKU-9", value: 30 }] }), // deeldata
});
const profiles = (await (await fetch(`${base}/api/product-profiles/get?userId=u1`)).json()) as any;
check("product-profielen: per-veld merge (deeldata wist hsCode niet)", profiles["SKU-9"]?.hsCode === "490199" && profiles["SKU-9"]?.value === 30);

// 6) DE BOEK-KETEN end-to-end tegen het mock-portaal: verrijkte rates -> choose -> book.
check("rates: verrijkt met reusableData (load-bearing voor boeken)",
  typeof (rates.rates?.[0] as any)?.reusableData?.choose_carrier === "string");
const dpd = (rates.rates as any[]).find((r) => r.carrier === "DPD" && r.service === "Classic");
check("rates: mock biedt guard-veilige DPD Classic", !!dpd);

const chosen = (await (
  await fetch(`${base}/api/choose`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chosenRate: dpd }),
  })
).json()) as any;
check("choose: sessionKey uit het portaal", typeof chosen.sessionKey === "string" && chosen.sessionKey.startsWith("srk-"));

const bookShipment = {
  source: "manual",
  ...shipment,
  recipientAddress: { ...shipment.recipientAddress, email: "klant@example.com", firstName: "Franz", lastName: "Meier", phoneNumber: "+4930123" },
  invoice: {},
  customsDocuments: [],
  products: [],
  shipmentOptions: {
    insuranceValue: 0, truckShipmentInfo: {}, signatureRequired: "none",
    shipmentOriginCountry: "", totalShipmentValue: 0, incotermsGroupD: "",
    description: "Samples", invoiceRef: "", factuurAanwezig: "nee",
    chosenRate: { ...dpd },
  },
};
const booked = await fetch(`${base}/api/book`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ shipment: bookShipment, fingerprint: "-1100307470", chosenRate: dpd, userId: "u1" }),
});
const bookedBody = (await booked.json()) as any;
check("book: 200 + zendingnummer uit het (mock-)portaal", booked.status === 200 && /^\d+$/.test(String(bookedBody.zendingnummer ?? "")));
check("book: mail-finalisatie naar portaal (defaults aan)", bookedBody.mailFinalization === "sent-to-portal");

// mail-voorkeuren UIT → finalisatie wordt geskipt (v1's flags, nu serverside)
await fetch(`${base}/api/config/update`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ userId: "u2", update: { trackingMailEnabled: false, labelConfirmationMailEnabled: false } }),
});
const bookedNoMail = (await (
  await fetch(`${base}/api/book`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ shipment: bookShipment, fingerprint: "-1100307470", chosenRate: dpd, userId: "u2" }),
  })
).json()) as any;
check("book: mail-finalisatie geskipt bij uitgezette voorkeuren", bookedNoMail.mailFinalization === "skipped");

// capability-guard: express-service moet GEBLOKKEERD worden (Wards boek-beleid, R1.3)
const dhl = (rates.rates as any[]).find((r) => r.carrier === "DHL");
const blocked = await fetch(`${base}/api/book`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ shipment: bookShipment, fingerprint: "-1100307470", chosenRate: dhl }),
});
check("book: capability-guard blokkeert DHL Express (403)", blocked.status === 403);

// 6c) PAPERLESS-factuur: shipment -> mapper (serverside) -> pool ("invoice.php"-mock)
// -> geldige base64-PDF + attach. contentType is load-bearing (v1-les).
const pltShipment = {
  ...bookShipment,
  orderId: "ORD-PLT-1",
  recipientAddress: { ...bookShipment.recipientAddress, company: "Bremer Buchhandel" },
  products: [{ sku: "SKU-1", description: "Boek", hsCode: "490199", value: 25, weight: 0.8, originCountry: "NL", quantity: 2 }],
  shipmentOptions: { ...bookShipment.shipmentOptions, invoiceRef: "INV-PLT", exportReason: "sale", incotermsGroupD: "DAP" },
  paperlessInvoice: { invoiceType: "commercial_invoice", currency: "EUR", declarantName: "Jan Jansen" },
};
const plt = await fetch(`${base}/api/paperless/generate`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ shipment: pltShipment, sessionkey: "SK-TEST-1", customerId: "u1", attach: true }),
});
const pltBody = (await plt.json()) as any;
const pltPdf = Buffer.from(String(pltBody?.invoice?.base64 ?? ""), "base64").toString("latin1");
check("paperless: 200 + geldige base64-PDF (%PDF) met contentType",
  plt.status === 200 && pltPdf.startsWith("%PDF") && pltBody.invoice?.contentType === "application/pdf");
check("paperless: attach uitgevoerd + data-url voor preview",
  pltBody.attached === true && String(pltBody.url ?? "").startsWith("data:application/pdf;base64,"));

// zonder paperlessInvoice-blok faalt de mapper gesloten (v1-fout doorgegeven als 422)
const pltBad = await fetch(`${base}/api/paperless/generate`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ shipment: { ...pltShipment, paperlessInvoice: undefined }, sessionkey: "SK-TEST-1", customerId: "u1" }),
});
check("paperless: 422 zonder paperlessInvoice-blok (fail-closed)", pltBad.status === 422);

const sp = (await (await fetch(`${base}/api/service-points?postalCode=1011AB`)).json()) as unknown[];
check("service-points: lege lijst (interim)", Array.isArray(sp) && sp.length === 0);

const ordEmpty = (await (await fetch(`${base}/api/orders?userId=u-fresh`)).json()) as unknown[];
check("orders: lege lijst voor een verse gebruiker", Array.isArray(ordEmpty) && ordEmpty.length === 0);

// 7) order-persistentie: manuele order + shipment-status persisteren en teruglezen
await fetch(`${base}/api/orders/set`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ userId: "u1", order: { orderId: "ORD-1", orderPlatform: "manual", manuallyCreated: true, orderStatus: "processing" } }),
});
await fetch(`${base}/api/orders/shipment/set`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ userId: "u1", orderId: "ORD-1", orderPlatform: "manual", shipment: { status: "CREATED", forwarderRef: "80812345" } }),
});
const ordList = (await (await fetch(`${base}/api/orders?userId=u1`)).json()) as any[];
check("orders: manuele order + shipment-status teruggelezen (persistent)",
  ordList.length === 1 && ordList[0].orderId === "ORD-1" && ordList[0].shipment?.status === "CREATED");

// error/set + sync-now + widget-init
const errRes = await fetch(`${base}/api/error/set`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ userId: "u1", error: "boom", token: "t1", shipment: {} }),
});
check("error/set: 200 + gelogd", errRes.status === 200 && (await errRes.json()).ok === true);
const syncRes = (await (await fetch(`${base}/api/orders/sync-now`, { method: "POST", body: "{}" })).json()) as any;
check("sync-now: 200 + synced-count (interim)", syncRes.ok === true && syncRes.synced === 0);
const initRes = (await (await fetch(`${base}/api/widget-init?userId=u1`)).json()) as any;
check("widget-init: ready ack", initRes.ready === true);

// 7b) ANNULEREN met body-inspectie (de v1-les): archiveerbaar vs vers label
const delOk = (await (
  await fetch(`${base}/api/shipments/delete`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: "u1", shipmentRef: "80812345" }),
  })
).json()) as any;
check("annuleren: archiveerbare zending → ok", delOk.ok === true);
const delRes = await fetch(`${base}/api/shipments/delete`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ userId: "u1", shipmentRef: "80899999-live" }),
});
const delBody = (await delRes.json()) as any;
// De mock geeft 200 + error-body; de proxy MOET dat als mislukt zien (v1 zag vals succes).
check("annuleren: vers label (200 + error-body) → 409, GEEN vals succes", delRes.status === 409 && delBody.ok !== true);

// labels + label-document (mock-PDF via de pool)
const merge = (await (await fetch(`${base}/api/labels/merge`, { method: "POST", body: "{}" })).json()) as any;
check("labels/merge: mock-PDF (base64 %PDF)", Buffer.from(String(merge.pdfBase64 ?? ""), "base64").toString("latin1").startsWith("%PDF"));
const doc = (await (await fetch(`${base}/integrations/v1/documents/label?url=x&format=a6`)).json()) as any;
check("label-document: a6-formaat-contract behouden + PDF", doc.documentResponse?.labelFormat === "a6" && Buffer.from(String(doc.documentResponse?.base64 ?? ""), "base64").toString("latin1").startsWith("%PDF"));

// 8) onbekende tenant faalt gesloten
const bad = await fetch(`http://127.0.0.1:${port}/t/bestaat-niet/api/rates`, { method: "POST", body: "{}" });
check("onbekende tenant → 404", bad.status === 404);

await close();

if (fail) {
  console.error(`verify-server FAALT (${fail})`);
  process.exit(1);
}
console.log("OK — widget-proxy: rates via runtime-pool, config per-tenant, paperless-PDF via pool, fail-closed routes.");
