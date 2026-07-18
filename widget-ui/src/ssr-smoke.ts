// SSR-smoke: rendert de complete WizardShell (engine + geporte componenten) buiten de
// browser en asserteert op zichtbare output. Bewijst runtime-gedrag dat build/check niet
// dekken: catalogus-keys bestaan echt, de provider-laag levert de landenlijst (Intl),
// en de engine kiest de sender-stap als eerste render. Draait in CI (widget-ui job).

import { render } from "svelte/server";
import WizardShell from "./lib/WizardShell.svelte";
import { setLang } from "./lib/state/messageStore";
import { getWidgetProvider } from "./lib/providers/registry";
import devTenant from "../../tenants/dev-standalone.json";
import type { TenantConfig } from "../../src/widget/tenant.ts";

setLang("NL");
const tenant = devTenant as unknown as TenantConfig;
const provider = getWidgetProvider(tenant.providers[0]);

const { body } = render(WizardShell, { props: { tenant, provider } });

let fail = 0;
function check(name: string, ok: boolean): void {
  console.log(`  ${ok ? "✓" : "✗"} ${name}`);
  if (!ok) fail++;
}

check('sender-stap rendert (catalogus: "Verzender")', body.includes("Verzender"));
check('veldlabels uit de catalogus ("Postcode", "Voornaam")', body.includes("Postcode") && body.includes("Voornaam"));
check('landenlijst uit de provider-laag (Intl: "Nederland")', body.includes("Nederland"));
check('footer uit de catalogus ("Verder"/"Vorige")', body.includes("Verder") && body.includes("Vorige"));
check('progress toont douanestap NIET (EU-default-route)', !body.includes("Douanegegevens"));
check("branding uit tenant-config", body.includes("Inset dev"));

if (fail) {
  console.error(`SSR-smoke FAALT (${fail})`);
  process.exit(1);
}
console.log("SSR-smoke OK");
