// Canonieke templates voor de PAYLOAD-oracle (boek-keten: chooseOption + submitShipment).
// Gedeeld door oracle (v1-steps met capture-fetch) en verify (v2 buildSubmitPayload/
// buildChoosePayload). Puur JSON-serialiseerbaar en deterministisch — geen Date/random.
//
// Twee templates:
//  - EXPORT: non-EU (NL -> US), rijk: line-items, invoice, EORI's, access point, FED-rate.
//  - EU:     basis (NL -> DE), zelfde STRUCTUUR (alle transform-paden bestaan) maar leeg
//            waar het kan: invoice {}, products [], DPD-rate zonder access points.
// Alle paden die transforms direct aanraken (truckShipmentInfo.*, chosenRate.price,
// carrierAccountNumber.*, street[0]/[1]) MOETEN bestaan — v1's steps crashen anders.

const nlShipper = {
  company: "Acme BV",
  firstName: "Jan",
  lastName: "Jansen",
  email: "jan@acme.nl",
  phoneNumber: "+31612345678",
  street: ["Damrak 1", ""],
  city: "Amsterdam",
  region: "",
  postalCode: "1011 AB",
  country: "NL",
};

const sharedOptions = {
  insuranceValue: 10,
  truckShipmentInfo: {
    shipperTaillift: false,
    recipientTaillift: false,
    shipperVehicle: "car",
    recipientVehicle: "car",
  },
  signatureRequired: "none",
  shipmentOriginCountry: "NL",
  totalShipmentValue: 50,
  incotermsGroupD: "DAP",
  description: "Boeken",
  invoiceRef: "INV-1",
  factuurAanwezig: "nee",
  exportReason: "sale",
  deliveryInstructions: "",
  carrierAccountNumber: {
    specifyCarrierAccountNumber: false,
    carrierAccountNumber: "",
    carrierAccountNumberCountry: "",
    carrierAccountNumberPostalCode: "",
  },
};

export const PAYLOAD_TEMPLATES: Record<"EXPORT" | "EU", Record<string, unknown>> = {
  EXPORT: {
    source: "manual",
    shipperAddress: { ...nlShipper },
    recipientAddress: {
      company: "Liberty Books Inc",
      firstName: "John",
      lastName: "Doe",
      email: "john@libertybooks.com",
      phoneNumber: "+12125550123",
      street: ["5th Ave 1", ""],
      city: "New York",
      region: "NY",
      postalCode: "10001",
      country: "US",
    },
    packages: [{ type: "package", length: 30, width: 20, height: 10, weight: 5 }],
    products: [
      {
        sku: "SKU-1",
        name: "Boek over schepen",
        description: "Boek over schepen",
        hsCode: "490199",
        value: 25,
        weight: 0.8,
        originCountry: "NL",
        currency: "EUR",
        quantity: 2,
        packageAssignments: [{ "SKU-1": { "0": 1, "1": 1 } }],
      },
      {
        sku: "SKU-2",
        name: "Boek over treinen",
        description: "Boek over treinen",
        hsCode: "490199",
        value: 12,
        weight: 0.4,
        originCountry: "NL",
        currency: "EUR",
        quantity: 1,
      },
    ],
    shipmentOptions: {
      ...structuredClone(sharedOptions),
      registrationNumberShipper: "NL821071841B02",
      registrationNumberRecipient: "US12345",
      chosenRate: {
        price: "327.26",
        carrier: "FED",
        accessPoints: [
          {
            id: "AP1",
            name: "Kiosk",
            address: "5th Ave 1",
            city: "New York",
            postalCode: "10001",
            country: "US",
            chosen: true,
          },
        ],
        reusableData: {
          choose_servicecode: "FEDEX_REGIONAL",
          choose_carrier: "FED",
          choose_service: "Fedex regional economy",
          choose_margin: "1.24",
          choose_price: "327.26",
          choose_carrier_id: "1",
          srk: "6",
          choose_pickupdate: "2026-07-21",
          choose_pickuptime: "1600",
          choose_arrivaldate: "2026-07-23",
          choose_arrivaltime: "1700",
          choose_gogreen: "0",
          choose_carbonneutral: "0",
        },
      },
    },
    invoice: { contentType: "application/pdf", base64: "dGVzdA==", filename: "factuur.pdf" },
    customsDocuments: [],
  },

  EU: {
    source: "manual",
    shipperAddress: { ...nlShipper },
    recipientAddress: {
      company: "Bremer Buchhandel GmbH",
      firstName: "Greta",
      lastName: "Schmidt",
      email: "greta@bremerbuch.de",
      phoneNumber: "+493012345678",
      street: ["Invalidenstr. 12", ""],
      city: "Berlijn",
      region: "",
      postalCode: "10115",
      country: "DE",
    },
    packages: [{ type: "package", length: 30, width: 20, height: 10, weight: 5 }],
    products: [],
    shipmentOptions: {
      ...structuredClone(sharedOptions),
      registrationNumberShipper: "",
      registrationNumberRecipient: "",
      chosenRate: {
        price: "12.34",
        carrier: "DPD",
        accessPoints: [],
        reusableData: {
          choose_servicecode: "DPD_CLASSIC",
          choose_carrier: "DPD",
          choose_service: "DPD Classic",
          choose_margin: "1.24",
          choose_price: "12.34",
          choose_carrier_id: "2",
          srk: "3",
          choose_pickupdate: "2026-07-21",
          choose_pickuptime: "1600",
          choose_arrivaldate: "2026-07-22",
          choose_arrivaltime: "1700",
          choose_gogreen: "0",
          choose_carbonneutral: "0",
        },
      },
    },
    invoice: {},
    customsDocuments: [],
  },
};

/** chooseOption-input zoals v1's caller hem bouwt: het reusableData-blok van de gekozen rate. */
export function chooseInputFrom(tpl: Record<string, unknown>): { reusableData: Record<string, unknown> } {
  const opts = tpl.shipmentOptions as { chosenRate: { reusableData: Record<string, unknown> } };
  return { reusableData: structuredClone(opts.chosenRate.reusableData) };
}

// ── PAPERLESS-templates (mapper-oracle: oracle-paperless / verify-paperless) ──────
// AFGELEID van het EXPORT-template, dat zelf NIET gemuteerd wordt: de bevroren
// widget-payload-fixtures zijn zonder paperlessInvoice-blok gecaptured. Drie
// varianten dekken de mapper-takken:
//  - PLT_EXPORT  : rijk, 2 producten (multi-line), alle party-id's + statement.
//  - PLT_BILLING : afwijkend factuuradres, PROFORMA/USD/gift, naam-in-company-optie.
//  - PLT_MINIMAAL: kaal ({} als paperless-blok → alle defaults, invoiceRef leeg →
//    orderId-referentie, "retour"-reden, payment_conditions-tak ONGEZET).

function paperlessBase(): Record<string, any> {
  return structuredClone(PAYLOAD_TEMPLATES.EXPORT) as Record<string, any>;
}

const pltExport = paperlessBase();
pltExport.paperlessInvoice = {
  invoiceType: "commercial_invoice",
  currency: "EUR",
  vatNumberShipper: "NL821071841B02",
  vatNumberConsignee: "US12345",
  eoriNumberShipper: "NL821071841",
  eoriNumberConsignee: "",
  paymentConditions: "14 days",
  receiverReference: "PO-77",
  remarks: "Fragile",
  invoiceStatement: { standard: true, preferentialOrigin: false, euri: false, cites: false },
  declarantName: "Jan Jansen",
  declarantPosition: "Manager",
};

const pltBilling = paperlessBase();
pltBilling.shipmentOptions.exportReason = "gift";
pltBilling.paperlessInvoice = {
  invoiceType: "pro_forma_invoice",
  currency: "USD",
  vatNumberConsignee: "US99999",
  billingAddressDiffersFromDeliveryAddress: true,
  billingAddress: {
    company: "Liberty Billing LLC",
    street: ["Wall St 10", "b"],
    city: "New York",
    region: "NY",
    postalCode: "10005",
    country: "us", // lowercase: uppercasing-tak van de mapper
    phoneNumber: "+12125550999",
  },
  paymentConditions: "30 dagen",
  invoiceStatement: { standard: false, preferentialOrigin: true, euri: true, cites: false },
  declarantName: "John Doe",
  declarantPosition: "",
};

const pltMinimaal = paperlessBase();
pltMinimaal.orderId = "ORD-9";
pltMinimaal.shipmentOptions.invoiceRef = "";
pltMinimaal.shipmentOptions.exportReason = "retour";
delete pltMinimaal.shipmentOptions.incotermsGroupD;
pltMinimaal.products = [
  { sku: "SKU-3", name: "Boekenlegger", hsCode: "490199", value: 12, weight: 0.4, originCountry: "nl" },
];
pltMinimaal.paperlessInvoice = {};

export const PAPERLESS_TEMPLATES: Record<
  string,
  {
    shipment: Record<string, unknown>;
    buildOpts: { includeRecipientNameInCompany?: boolean };
    /** Deterministische invoice.php-args (v1: sessionkey = forwarderRef, customerId = integration.customerId). */
    php: { sessionkey: string; customerId: string | number; carrier?: string; serviceDescription?: string };
  }
> = {
  PLT_EXPORT: {
    shipment: pltExport,
    buildOpts: {},
    php: { sessionkey: "SK-EXPORT-1", customerId: "1001", carrier: "FED", serviceDescription: "Fedex regional economy" },
  },
  PLT_BILLING: {
    shipment: pltBilling,
    buildOpts: { includeRecipientNameInCompany: true },
    php: { sessionkey: "SK-BILLING-2", customerId: "1001", carrier: "FED", serviceDescription: "" },
  },
  PLT_MINIMAAL: {
    shipment: pltMinimaal,
    buildOpts: {},
    php: { sessionkey: "draft-ORD-9", customerId: 42 },
  },
};
