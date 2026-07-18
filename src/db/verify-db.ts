// Test van SQLite-per-tenant (O6/§10): per-tenant isolatie, "laatste mislukte zending
// van klant X", en een eigen .db-bestand per tenant (backup = bestand kopiëren).
// Draai met: node --experimental-strip-types --experimental-sqlite src/db/verify-db.ts

import { rmSync, existsSync } from "node:fs";
import { recordShipment, listShipments, lastFailedShipment } from "./tenant-db.ts";

rmSync(".data", { recursive: true, force: true }); // schone start

recordShipment("acme", { portal: "tff", carrier: "DPD", service: "Classic", shipmentRef: "80834015", labelUrl: "https://…/80834015.pdf", status: "ok" });
recordShipment("acme", { portal: "tff", carrier: "DPD", service: "Classic", shipmentRef: "", status: "error" });
recordShipment("globex", { portal: "transheroes", carrier: "TransHeroes", service: "Road", shipmentRef: "Q1", status: "ok" });

let fail = 0;
function check(n: string, ok: boolean): void {
  console.log(`  ${ok ? "✓" : "✗"} ${n}`);
  if (!ok) fail++;
}

check("per-tenant isolatie (acme=2 zendingen, globex=1)", listShipments("acme").length === 2 && listShipments("globex").length === 1);

const lf = lastFailedShipment("acme");
check("lastFailedShipment(acme) vindt de mislukte boeking", lf?.status === "error");

check("globex heeft geen mislukte boeking", lastFailedShipment("globex") === undefined);

check("eigen .db-bestand per tenant (backup = bestand kopiëren)", existsSync(".data/acme.db") && existsSync(".data/globex.db"));

console.log(fail ? `\nFAIL — ${fail} check(s) fout` : "\nOK — SQLite-per-tenant: isolatie, 'laatste mislukte zending van klant X', bestand-per-tenant");
process.exit(fail ? 1 : 0);
