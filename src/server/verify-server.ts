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

// 6) onbekende tenant faalt gesloten
const bad = await fetch(`http://127.0.0.1:${port}/t/bestaat-niet/api/rates`, { method: "POST", body: "{}" });
check("onbekende tenant → 404", bad.status === 404);

await close();

if (fail) {
  console.error(`verify-server FAALT (${fail})`);
  process.exit(1);
}
console.log("OK — widget-proxy: rates via runtime-pool, config per-tenant, fail-closed routes.");
