// Test van de widget-seam (stap 1): de widget resolveert zijn provider via PARAMETER
// (tenant-config → registry), niet via een hardcoded tff-importpad. Bewijs met twee
// echte providers (tff én transheroes) op dezelfde registry.
//
// Draai na `npm run compile` (voor de tff-transform). In npm test staat compile ervóór.

import { loadTenant } from "./tenant.ts";
import { getProvider, hasProvider } from "./provider-registry.ts";

let fail = 0;
function check(n: string, ok: boolean): void {
  console.log(`  ${ok ? "✓" : "✗"} ${n}`);
  if (!ok) fail++;
}

// tenant -> provider via config, niet via import
const tenant = loadTenant("tff-forwarder");
check("tenant-config laadt de provider(s)", tenant.providers[0] === "tff" && tenant.widgetBehavior.labelFormat === "a6");

const tff = getProvider(tenant.providers[0]);
check("registry resolveert 'tff' via parameter", tff.providerId === "tff" && tff.fieldNames.includes("verzender_land"));

const transform = await tff.loadTransform();
const out = transform({
  shipper: { country: "NL", postcode: "1011AB", street: "Damrak" },
  recipient: { country: "US", postcode: "10001", street: "5th Ave" },
  package: { weightKg: 1 },
});
check("provider-transform via registry uitvoerbaar", typeof transform === "function" && (out as any).verzender_land === "NL");

// TWEEDE provider op dezelfde registry, puur via parameter -> provider-parameterisatie bewezen
check("registry laadt óók een 2e provider (transheroes) via parameter",
  hasProvider("transheroes") && getProvider("transheroes").providerId === "transheroes" && getProvider("transheroes").fieldNames.length > 0);

console.log(fail ? `\nFAIL — ${fail} check(s) fout` : "\nOK — widget-seam: provider via parameter (tff + transheroes op dezelfde registry), tenant-config los van de engine");
process.exit(fail ? 1 : 0);
