// SSR-smoke: rendert de complete WizardShell (engine + geporte componenten) buiten de
// browser en asserteert op zichtbare output. Bewijst runtime-gedrag dat build/check niet
// dekken: catalogus-keys bestaan echt, de provider-laag levert de landenlijst (Intl),
// en de engine kiest de sender-stap als eerste render. Draait in CI (widget-ui job).

import { render } from "svelte/server";
import { writable } from "svelte/store";
import WizardShell from "./lib/WizardShell.svelte";
import ReceiverStepBlock from "./lib/components/ReceiverStepBlock.svelte";
import PackageTableStepBlock from "./lib/components/PackageTableStepBlock.svelte";
import { setLang } from "./lib/state/messageStore";
import { getWidgetProvider } from "./lib/providers/registry";
import devTenant from "../../tenants/dev-standalone.json";
import type { TenantConfig } from "../../src/widget/tenant.ts";
import type { ShipmentTemplate } from "./lib/types/config";

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

// Receiver-stap los renderen (de shell start op sender): NL-modus, type-toggle, adresboek.
const emptyAddress = () => ({
  company: "", firstName: "", lastName: "", email: "", phoneNumber: "",
  street: ["", ""], postalCode: "", city: "", country: "", region: "",
});
const recShipment = writable({
  shipperAddress: { ...emptyAddress(), country: "NL" },
  recipientAddress: { ...emptyAddress(), country: "NL" },
  packages: [],
  products: [],
} as unknown as ShipmentTemplate);
const rec = render(ReceiverStepBlock, {
  props: { shipment: recShipment, provider, userId: "smoke" },
});
check('receiver: NL-modus toont postcode+huisnummer-rij ("Huisnummer")', rec.body.includes("Huisnummer"));
check('receiver: type-toggle ("Bedrijf"/"Particulier")', rec.body.includes("Bedrijf") && rec.body.includes("Particulier"));
check('receiver: adresboek + paste-vak', rec.body.includes("Adresboek") && rec.body.includes("Plak hier"));

// Pakkettenstap (rows worden in onMount opgebouwd, dus SSR toont de lege tabel-chrome).
const pkg = render(PackageTableStepBlock, {
  props: { order: null, shipment: recShipment, provider, userId: "smoke" },
});
check('packages: sectie + tabelkop ("Verpakkingen", "Afmetingen")', pkg.body.includes("Verpakkingen") && pkg.body.includes("Afmetingen"));
check('packages: regel-toevoegen-actie', pkg.body.includes("Regel toevoegen"));

if (fail) {
  console.error(`SSR-smoke FAALT (${fail})`);
  process.exit(1);
}
console.log("SSR-smoke OK");
