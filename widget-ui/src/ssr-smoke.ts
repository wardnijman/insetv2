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

// Douanestap: ProductStepBlock → SkeletonContainer (grid) met een non-EU-zending +
// één product; grid-chrome en productvelden moeten uit de catalogus/provider komen.
const prodMod = await import("./lib/components/ProductStepBlock.svelte");
const customsShipment = writable({
  shipperAddress: { ...emptyAddress(), country: "NL" },
  recipientAddress: { ...emptyAddress(), country: "US" },
  packages: [],
  products: [{
    sku: "SKU-1", name: "Boek", description: "Boek over schepen", hsCode: "490199",
    value: 25, weight: 0.8, originCountry: "NL", quantity: 2, category: "Products",
    send: true, materials: [], currency: "EUR", createdAt: "", updatedAt: "",
  }],
} as unknown as ShipmentTemplate);
const customs = render(prodMod.default, {
  props: { order: null, shipment: customsShipment, userId: "smoke", provider },
});
check("customs: grid rendert het product", customs.body.includes("Boek over schepen") || customs.body.includes("SKU-1") || customs.body.includes("490199"));
check("customs: HS/douane-chrome aanwezig", /HS|Douane|douane/.test(customs.body));

// Verzendstap: de ECHTE ShipStepBlock-port (rates komen client-side na mount;
// SSR moet de loader/chrome zonder crash renderen).
const shipMod = await import("./lib/components/ShipStepBlock.svelte");
const ship = render(shipMod.default, {
  props: { provider, shipment: recShipment, userId: "smoke" },
});
check("ship: rendert zonder crash met chrome", ship.body.length > 200 && /[Vv]erzend/.test(ship.body));

// RateChoiceModal (no_rule rate-picker): host de ECHTE ShipStepBlock in een dialog. SSR
// moet de dialog-chrome + de ship-stap renderen zonder crash (geen browser-API's).
const rcmMod = await import("./lib/components/RateChoiceModal.svelte");
const rcm = render(rcmMod.default, {
  props: {
    order: { orderId: "smoke-1", shippingAddress: { ...emptyAddress(), country: "NL" } } as any,
    provider,
    availableRates: [],
    partialTemplate: {
      shipperAddress: { ...emptyAddress(), country: "NL" },
      recipientAddress: { ...emptyAddress(), country: "NL" },
      packages: [],
      products: [],
      shipmentOptions: {},
    } as unknown as ShipmentTemplate,
    userId: "smoke",
    onClose: () => {},
    onSubmit: () => {},
  },
});
check('rate-picker: dialog-chrome ("Kies een verzendservice") zonder crash', rcm.body.includes("Kies een verzendservice"));

// Widget-ROOT (order-overview-slice): overview-chrome moet zichtbaar zijn zonder
// browser-API's — zoekbalk-placeholder, de "Handmatig"-knop (createShipment-key),
// lege-staat-tekst en de bulk-balk. Orders komen client-side (fetch in $effect draait
// niet op SSR), dus de lege staat is de verwachte render.
const widgetMod = await import("./lib/components/Widget.svelte");
const widget = render(widgetMod.default, {
  props: { tenant, provider, hostNotice: null, userId: "smoke" },
});
check('widget-root: zoekbalk rendert (placeholder "Zoek…")', widget.body.includes("Zoek…"));
check('widget-root: "Handmatig"-knop uit de catalogus (createShipment)', widget.body.includes("Handmatig"));
check('widget-root: lege-staat uit de catalogus ("Geen bestellingen gevonden")', widget.body.includes("Geen bestellingen gevonden"));
check('widget-root: bulk-balk + basket-footer ("Selecteer orders", "Printen")', widget.body.includes("Selecteer orders") && widget.body.includes("Printen"));

if (fail) {
  console.error(`SSR-smoke FAALT (${fail})`);
  process.exit(1);
}
console.log("SSR-smoke OK");
