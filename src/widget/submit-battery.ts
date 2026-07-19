// Canonieke templates voor de submit-oracle: drie zendingsstaten die samen de
// required-, EU-gate- en happy-paden raken. Gedeeld door oracle (v1) en verify (v2).
// Puur JSON-serialiseerbaar en deterministisch.

const addr = (over: Record<string, unknown> = {}) => ({
  company: "Acme BV", firstName: "Jan", lastName: "Jansen", email: "jan@acme.nl",
  phoneNumber: "+31612345678", street: ["Damrak 1", ""], city: "Amsterdam",
  region: "", postalCode: "1011 AB", country: "NL", ...over,
});

export const ORACLE_TEMPLATES: Record<string, unknown>[] = [
  // 1) EU-zending, volledig ingevuld (happy path; EU-gates → ok)
  {
    shipperAddress: addr(),
    recipientAddress: addr({ country: "DE", postalCode: "10115", city: "Berlijn" }),
    packages: [{ type: "package", length: 30, width: 20, height: 10, weight: 5 }],
    products: [],
    shipmentOptions: {
      description: "Samples", insuranceValue: 0, totalShipmentValue: 0,
      incotermsGroupD: "", shipmentOriginCountry: "", deliveryInstructions: "",
      invoiceRef: "", chosenRate: { carrier: "DPD", accessPoints: [] },
    },
  },
  // 2) non-EU-export, volledig (EU-gates actief + geldig; line-items aanwezig)
  {
    shipperAddress: addr(),
    recipientAddress: addr({ country: "US", postalCode: "10001", city: "New York", region: "NY" }),
    packages: [{ type: "package", length: 30, width: 20, height: 10, weight: 5 }],
    products: [{
      sku: "SKU-1", description: "Boek over schepen", hsCode: "490199", value: 25,
      weight: 0.8, originCountry: "NL", quantity: 2, currency: "EUR",
    }],
    shipmentOptions: {
      description: "Boeken", insuranceValue: 10, totalShipmentValue: 50,
      incotermsGroupD: "DAP", shipmentOriginCountry: "NL", deliveryInstructions: "",
      invoiceRef: "INV-1", chosenRate: { carrier: "FED", accessPoints: [] },
    },
  },
  // 3) non-EU-export, LEEG waar het kan (required-paden + EU-gate-fouten)
  {
    shipperAddress: addr({ firstName: "", phoneNumber: "" }),
    recipientAddress: addr({ country: "US", postalCode: "", city: "", firstName: "" }),
    packages: [],
    products: [{ sku: "SKU-2", description: "", hsCode: "12", value: 0, weight: 0, originCountry: "", quantity: 1, currency: "" }],
    shipmentOptions: {
      description: "", insuranceValue: -1, totalShipmentValue: 0,
      incotermsGroupD: "DPU", shipmentOriginCountry: "NLD", deliveryInstructions: "",
      invoiceRef: "", chosenRate: { carrier: "", accessPoints: [] },
    },
  },
];
