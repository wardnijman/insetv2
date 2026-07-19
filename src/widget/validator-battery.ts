// Gedeelde case-batterij voor de widget-validators. De ORACLE-runner draait deze
// cases door v1's ECHTE generated validators (esbuild-bundel uit ~/plugship) en
// bevriest de uitkomsten in fixtures/widget-validators-oracle.json; de CI-verify
// (verify-widget-validators) replayt dezelfde cases tegen de fabriek-emit.
// Cases zijn puur JSON-serialiseerbaar en deterministisch.

export interface BatteryCase {
  id: string;
  suite: "B" | "D";
  fn: string;
  args: unknown[];
}

const addr = (over: Record<string, unknown> = {}) => ({
  company: "Acme BV", firstName: "Jan", lastName: "Jansen", email: "jan@acme.nl",
  phoneNumber: "+31612345678", street: ["Damrak 1", ""], city: "Amsterdam",
  region: "", postalCode: "1011 AB", country: "NL", ...over,
});

const product = (over: Record<string, unknown> = {}) => ({
  sku: "SKU-1", name: "Boek", description: "Boek over schepen", hsCode: "490199",
  value: 25, weight: 0.8, originCountry: "NL", quantity: 2, currency: "EUR",
  send: true, materials: [], ...over,
});

export const CASES: BatteryCase[] = [
  // ---- landen ----
  { id: "b-shipper-country-leeg", suite: "B", fn: "validateShipperAddressCountry", args: [""] },
  { id: "b-shipper-country-ok", suite: "B", fn: "validateShipperAddressCountry", args: ["NL"] },
  { id: "b-shipper-country-onbekend", suite: "B", fn: "validateShipperAddressCountry", args: ["XX"] },
  { id: "b-shipper-country-lowercase", suite: "B", fn: "validateShipperAddressCountry", args: ["nl"] },
  { id: "b-recipient-country-leeg", suite: "B", fn: "validateRecipientAddressCountry", args: [""] },
  { id: "b-recipient-country-ok", suite: "B", fn: "validateRecipientAddressCountry", args: ["US"] },

  // ---- postcodes (patroon-DSL) ----
  { id: "b-postal-geen-land-leeg", suite: "B", fn: "validateShipperAddressPostalCode", args: ["", ""] },
  { id: "b-postal-geen-land-gevuld", suite: "B", fn: "validateShipperAddressPostalCode", args: ["1234", ""] },
  { id: "b-postal-nl-ok-spatie", suite: "B", fn: "validateShipperAddressPostalCode", args: ["1011 AB", "NL"] },
  { id: "b-postal-nl-ok-compact", suite: "B", fn: "validateShipperAddressPostalCode", args: ["1011AB", "NL"] },
  { id: "b-postal-nl-fout", suite: "B", fn: "validateShipperAddressPostalCode", args: ["999", "NL"] },
  { id: "b-postal-nl-leeg", suite: "B", fn: "validateShipperAddressPostalCode", args: ["", "NL"] },
  { id: "b-postal-nl-lowercase", suite: "B", fn: "validateShipperAddressPostalCode", args: ["1011 ab", "NL"] },
  { id: "b-postal-de-ok", suite: "B", fn: "validateShipperAddressPostalCode", args: ["10115", "DE"] },
  { id: "b-postal-de-kort", suite: "B", fn: "validateShipperAddressPostalCode", args: ["1011", "DE"] },
  { id: "b-postal-gb-ok", suite: "B", fn: "validateRecipientAddressPostalCode", args: ["SW1A 1AA", "GB"] },
  { id: "b-postal-gb-fout", suite: "B", fn: "validateRecipientAddressPostalCode", args: ["12345", "GB"] },
  { id: "b-postal-pt-ok", suite: "B", fn: "validateRecipientAddressPostalCode", args: ["1234-567", "PT"] },
  { id: "b-postal-ae-geen-ok", suite: "B", fn: "validateRecipientAddressPostalCode", args: ["12345678", "AE"] },
  { id: "b-postal-ae-geen-te-lang", suite: "B", fn: "validateRecipientAddressPostalCode", args: ["123456789", "AE"] },
  { id: "b-postal-us-ok", suite: "B", fn: "validateRecipientAddressPostalCode", args: ["10001", "US"] },
  { id: "b-postal-binnenwit-genormaliseerd", suite: "B", fn: "validateShipperAddressPostalCode", args: ["1011  AB", "NL"] },

  // ---- straat / plaats (35-limiet) ----
  { id: "b-straat-leeg", suite: "B", fn: "validateShipperAddressStreet0_", args: [""] },
  { id: "b-straat-ok", suite: "B", fn: "validateShipperAddressStreet0_", args: ["Damrak 1"] },
  { id: "b-straat-36", suite: "B", fn: "validateShipperAddressStreet0_", args: ["A".repeat(36)] },
  { id: "b-straat-35", suite: "B", fn: "validateShipperAddressStreet0_", args: ["A".repeat(35)] },
  { id: "b-toevoeging-36", suite: "B", fn: "validateShipperAddressStreet1_", args: ["B".repeat(36)] },
  { id: "b-toevoeging-leeg", suite: "B", fn: "validateShipperAddressStreet1_", args: [""] },
  { id: "b-plaats-leeg", suite: "B", fn: "validateRecipientAddressCity", args: [""] },
  { id: "b-plaats-36", suite: "B", fn: "validateRecipientAddressCity", args: ["C".repeat(36)] },
  { id: "b-plaats-ok", suite: "B", fn: "validateRecipientAddressCity", args: ["Berlijn"] },
  { id: "b-r-straat-leeg", suite: "B", fn: "validateRecipientAddressStreet0_", args: [""] },
  { id: "b-r-toevoeging-36", suite: "B", fn: "validateRecipientAddressStreet1_", args: ["B".repeat(36)] },

  // ---- regio (US/CA/AU) ----
  { id: "b-regio-us-leeg", suite: "B", fn: "validateRecipientAddressRegion", args: ["", addr({ country: "US" })] },
  { id: "b-regio-us-ok", suite: "B", fn: "validateRecipientAddressRegion", args: ["CA", addr({ country: "US" })] },
  { id: "b-regio-au-leeg", suite: "B", fn: "validateRecipientAddressRegion", args: ["", addr({ country: "AU" })] },
  { id: "b-regio-nl-leeg", suite: "B", fn: "validateRecipientAddressRegion", args: ["", addr({ country: "NL" })] },

  // ---- telefoon ----
  { id: "b-telefoon-shipper-leeg", suite: "B", fn: "validateShipperAddressPhoneNumber", args: [""] },
  { id: "b-telefoon-shipper-spatie", suite: "B", fn: "validateShipperAddressPhoneNumber", args: [" "] },
  { id: "b-telefoon-recipient-ok", suite: "B", fn: "validateRecipientAddressPhoneNumber", args: ["+31612345678"] },
  { id: "b-telefoon-recipient-leeg", suite: "B", fn: "validateRecipientAddressPhoneNumber", args: [""] },

  // ---- naam-paar (totaal incl. spatie max 30) ----
  { id: "b-voornaam-leeg", suite: "B", fn: "validateRecipientFirstName", args: ["", addr()] },
  { id: "b-voornaam-ok", suite: "B", fn: "validateRecipientFirstName", args: ["Jan", addr()] },
  { id: "b-naam-totaal-30-ok", suite: "B", fn: "validateRecipientFirstName", args: ["A".repeat(14), addr({ lastName: "B".repeat(15) })] },
  { id: "b-naam-totaal-31-fout", suite: "B", fn: "validateRecipientFirstName", args: ["A".repeat(15), addr({ lastName: "B".repeat(15) })] },
  { id: "b-achternaam-leeg", suite: "B", fn: "validateRecipientLastName", args: ["", addr()] },
  { id: "b-achternaam-totaal-31-fout", suite: "B", fn: "validateRecipientLastName", args: ["B".repeat(15), addr({ firstName: "A".repeat(15) })] },

  // ---- aggregaten ----
  { id: "b-agg-shipper-ok", suite: "B", fn: "validateShipperAddress", args: [addr()] },
  { id: "b-agg-shipper-slechte-postcode", suite: "B", fn: "validateShipperAddress", args: [addr({ postalCode: "999" })] },
  { id: "b-agg-shipper-geen-telefoon", suite: "B", fn: "validateShipperAddress", args: [addr({ phoneNumber: "" })] },
  { id: "b-agg-recipient-ok", suite: "B", fn: "validateRecipientAddress", args: [addr()] },
  { id: "b-agg-recipient-geen-voornaam", suite: "B", fn: "validateRecipientAddress", args: [addr({ firstName: "" })] },
  { id: "b-agg-recipient-us-zonder-regio", suite: "B", fn: "validateRecipientAddress", args: [addr({ country: "US", postalCode: "10001" })] },

  // ---- pakketten (aggregaat; let op document-quirk 120 vs 100) ----
  { id: "b-pkg-agg-ok", suite: "B", fn: "validatePackages", args: [[{ type: "package", length: 30, width: 20, height: 10, weight: 5 }]] },
  { id: "b-pkg-agg-zonder-type", suite: "B", fn: "validatePackages", args: [[{ length: 30, width: 20, height: 10, weight: 5 }]] },
  { id: "b-pkg-agg-onbekend-type", suite: "B", fn: "validatePackages", args: [[{ type: "krat", length: 30, width: 20, height: 10, weight: 5 }]] },
  { id: "b-pkg-agg-pallet-201", suite: "B", fn: "validatePackages", args: [[{ type: "pallet", length: 201, width: 100, height: 100, weight: 200 }]] },
  { id: "b-pkg-agg-pallet-451kg", suite: "B", fn: "validatePackages", args: [[{ type: "pallet", length: 120, width: 100, height: 100, weight: 451 }]] },
  { id: "b-pkg-agg-doc-110-lang", suite: "B", fn: "validatePackages", args: [[{ type: "document", length: 110, width: 30, height: 1, weight: 1 }]] },
  { id: "b-pkg-agg-doc-3kg", suite: "B", fn: "validatePackages", args: [[{ type: "document", length: 30, width: 21, height: 1, weight: 3 }]] },
  { id: "b-pkg-agg-pakket-71kg", suite: "B", fn: "validatePackages", args: [[{ type: "package", length: 30, width: 20, height: 10, weight: 71 }]] },
  { id: "b-pkg-agg-meerdere", suite: "B", fn: "validatePackages", args: [[{ type: "package", length: 30, width: 20, height: 10, weight: 5 }, { type: "pallet", length: 120, width: 100, height: 100, weight: 500 }]] },

  // ---- pakketten per veld ----
  { id: "b-pkg-lengte-null", suite: "B", fn: "validatePackageLength", args: [{ type: "package", length: null }] },
  { id: "b-pkg-lengte-0", suite: "B", fn: "validatePackageLength", args: [{ type: "package", length: 0 }] },
  { id: "b-pkg-lengte-301", suite: "B", fn: "validatePackageLength", args: [{ type: "package", length: 301 }] },
  { id: "b-pkg-lengte-300", suite: "B", fn: "validatePackageLength", args: [{ type: "package", length: 300 }] },
  { id: "b-pkg-lengte-pallet-201", suite: "B", fn: "validatePackageLength", args: [{ type: "pallet", length: 201 }] },
  { id: "b-pkg-lengte-doc-110", suite: "B", fn: "validatePackageLength", args: [{ type: "document", length: 110 }] },
  { id: "b-pkg-lengte-onbekend-type", suite: "B", fn: "validatePackageLength", args: [{ type: "krat", length: 10 }] },
  { id: "b-pkg-breedte-doc-101", suite: "B", fn: "validatePackageWidth", args: [{ type: "document", width: 101 }] },
  { id: "b-pkg-breedte-ok", suite: "B", fn: "validatePackageWidth", args: [{ type: "package", width: 50 }] },
  { id: "b-pkg-hoogte-pakket-201", suite: "B", fn: "validatePackageHeight", args: [{ type: "package", height: 201 }] },
  { id: "b-pkg-hoogte-pallet-201", suite: "B", fn: "validatePackageHeight", args: [{ type: "pallet", height: 201 }] },
  { id: "b-pkg-gewicht-pallet-451", suite: "B", fn: "validatePackageWeight", args: [{ type: "pallet", weight: 451 }] },
  { id: "b-pkg-gewicht-doc-3", suite: "B", fn: "validatePackageWeight", args: [{ type: "document", weight: 3 }] },
  { id: "b-pkg-gewicht-pakket-71", suite: "B", fn: "validatePackageWeight", args: [{ type: "package", weight: 71 }] },
  { id: "b-pkg-gewicht-ok", suite: "B", fn: "validatePackageWeight", args: [{ type: "package", weight: 5 }] },

  // ---- D-suite: douane-grid (product-line, §4) ----
  { id: "d-item-desc-leeg", suite: "D", fn: "validateItemDescription", args: [{ description: "" }] },
  { id: "d-item-desc-101", suite: "D", fn: "validateItemDescription", args: [{ description: "X".repeat(101) }] },
  { id: "d-item-desc-ok", suite: "D", fn: "validateItemDescription", args: [{ description: "Boek" }] },
  { id: "d-item-gewicht-null", suite: "D", fn: "validateItemWeight", args: [{ weight: null }] },
  { id: "d-item-gewicht-te-licht", suite: "D", fn: "validateItemWeight", args: [{ weight: 0.005 }] },
  { id: "d-item-gewicht-te-zwaar", suite: "D", fn: "validateItemWeight", args: [{ weight: 1000 }] },
  { id: "d-item-gewicht-ok", suite: "D", fn: "validateItemWeight", args: [{ weight: 2.5 }] },
  { id: "d-item-gewicht-string", suite: "D", fn: "validateItemWeight", args: [{ weight: "2.5" }] },
  { id: "d-item-waarde-null", suite: "D", fn: "validateItemValue", args: [{ value: null }] },
  { id: "d-item-waarde-0", suite: "D", fn: "validateItemValue", args: [{ value: 0 }] },
  { id: "d-item-waarde-te-hoog", suite: "D", fn: "validateItemValue", args: [{ value: 100001 }] },
  { id: "d-item-waarde-ok", suite: "D", fn: "validateItemValue", args: [{ value: 50 }] },
  { id: "d-origin-leeg", suite: "D", fn: "validateOriginCountry", args: [{ originCountry: "" }] },
  { id: "d-origin-lowercase-ok", suite: "D", fn: "validateOriginCountry", args: [{ originCountry: "nl" }] },
  { id: "d-origin-3-letters", suite: "D", fn: "validateOriginCountry", args: [{ originCountry: "NLD" }] },
  { id: "d-hs-leeg", suite: "D", fn: "validateHsCode", args: [{ hsCode: "" }] },
  { id: "d-hs-5-cijfers", suite: "D", fn: "validateHsCode", args: [{ hsCode: "12345" }] },
  { id: "d-hs-6-cijfers", suite: "D", fn: "validateHsCode", args: [{ hsCode: "490199" }] },
  { id: "d-hs-met-punten-ok", suite: "D", fn: "validateHsCode", args: [{ hsCode: "4901.99 00" }] },
  { id: "d-hs-21-cijfers", suite: "D", fn: "validateHsCode", args: [{ hsCode: "1".repeat(21) }] },
  { id: "d-hs-letters", suite: "D", fn: "validateHsCode", args: [{ hsCode: "ABC123" }] },

  // ---- D-suite: validateProducts (aggregaat) ----
  { id: "d-products-ok", suite: "D", fn: "validateProducts", args: [[product()]] },
  { id: "d-products-geen-desc", suite: "D", fn: "validateProducts", args: [[product({ description: "  " })]] },
  { id: "d-products-slechte-hs", suite: "D", fn: "validateProducts", args: [[product({ hsCode: "12" })]] },
  { id: "d-products-geen-origin", suite: "D", fn: "validateProducts", args: [[product({ originCountry: "" })]] },
  { id: "d-products-gewicht-0", suite: "D", fn: "validateProducts", args: [[product({ weight: 0 })]] },
  { id: "d-products-waarde-0", suite: "D", fn: "validateProducts", args: [[product({ value: 0 })]] },
  { id: "d-products-geen-valuta", suite: "D", fn: "validateProducts", args: [[product({ currency: "" })]] },
  { id: "d-products-assignments-0", suite: "D", fn: "validateProducts", args: [[product({ packageAssignments: [{ "SKU-1": { p1: 0 } }] })]] },
  { id: "d-products-assignments-2", suite: "D", fn: "validateProducts", args: [[product({ packageAssignments: [{ "SKU-1": { p1: 2 } }] })]] },

  // ---- D-suite: shipment-opties (EU-gated) ----
  { id: "d-opties-desc-leeg", suite: "D", fn: "validateShipmentOptionsDescription", args: [""] },
  { id: "d-opties-desc-101", suite: "D", fn: "validateShipmentOptionsDescription", args: ["X".repeat(101)] },
  { id: "d-opties-desc-ok", suite: "D", fn: "validateShipmentOptionsDescription", args: ["Samples"] },
  { id: "d-totaal-0-export", suite: "D", fn: "validateShipmentOptionsTotalShipmentValue", args: [0, addr(), addr({ country: "US" })] },
  { id: "d-totaal-ok-export", suite: "D", fn: "validateShipmentOptionsTotalShipmentValue", args: [10, addr(), addr({ country: "US" })] },
  { id: "d-totaal-0-eu", suite: "D", fn: "validateShipmentOptionsTotalShipmentValue", args: [0, addr(), addr({ country: "DE" })] },
  { id: "d-incoterm-dpu-export", suite: "D", fn: "validateShipmentOptionsIncotermsGroupD", args: ["DPU", addr(), addr({ country: "US" })] },
  { id: "d-incoterm-dap-export", suite: "D", fn: "validateShipmentOptionsIncotermsGroupD", args: ["DAP", addr(), addr({ country: "US" })] },
  { id: "d-incoterm-ddp-export", suite: "D", fn: "validateShipmentOptionsIncotermsGroupD", args: ["DDP", addr(), addr({ country: "US" })] },
  { id: "d-incoterm-dpu-eu", suite: "D", fn: "validateShipmentOptionsIncotermsGroupD", args: ["DPU", addr(), addr({ country: "DE" })] },
  { id: "d-verzend-origin-leeg-export", suite: "D", fn: "validateShipmentOptionsShipmentOriginCountry", args: ["", addr(), addr({ country: "US" })] },
  { id: "d-verzend-origin-lowercase-export", suite: "D", fn: "validateShipmentOptionsShipmentOriginCountry", args: ["nl", addr(), addr({ country: "US" })] },
  { id: "d-verzend-origin-3letters-export", suite: "D", fn: "validateShipmentOptionsShipmentOriginCountry", args: ["NLD", addr(), addr({ country: "US" })] },
  { id: "d-verzend-origin-leeg-eu", suite: "D", fn: "validateShipmentOptionsShipmentOriginCountry", args: ["", addr(), addr({ country: "DE" })] },
];
