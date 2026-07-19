// Geport uit v1 paperlessInvoiceMapper (generated) — bewaakt door oracle
// (fixtures/paperless-mapper-oracle.json, zie oracle-paperless.ts / verify-paperless.ts).
// Twee lagen, samen de hele paperless-keten tot aan het netwerk:
//  1) buildPaperlessInvoiceRequestFromShipment — ShipmentTemplate -> request-vorm
//     (v1: src/lib/utils/paperlessInvoiceMapper.ts, byte-identiek na JSON-roundtrip).
//  2) buildTffInvoicePhpPayload + encodeInvoicePhpBody — request -> invoice.php-formbody
//     (v1: privé in src/lib/steps/paperlessInvoice.ts; hier geëxporteerd omdat de
//     SERVER 'm nodig heeft; bevroren via capture-fetch op v1's generatePltInvoiceBlob).
// PUUR: geen node-deps, geen netwerk — browser (widget-ui) én server importeren dit.

// TODO(live): de echte PDF-service — POST form-urlencoded naar deze URL geeft een
// base64-PDF terug (begint met "JVBER"); attach loopt daarna via het TFF-portaal
// (ajax/invoiceTransferPDF.php + ajax/set_invoice_plt.php, mét sessie-cookie).
export const INVOICE_PHP_URL = "https://pdf.tffxpress.com/pdf/invoice.php";

// ── request-vormen (structurele spiegels van v1's generated types) ───────────────

export type Incoterm = "DAP" | "DPU" | "DDP" | "EXW";
export type InvoiceType = "COMMERCIAL" | "PROFORMA";

export type InvoiceReasonForExport =
  | "GIFT"
  | "COMMERCIAL_PURPOSE"
  | "PERSONAL"
  | "SAMPLE"
  | "RETURN_FOR_REPAIR"
  | "RETURN_AFTER_REPAIR"
  | "RETURN_TO_ORIGIN_COMMERCIAL";

export type InvoiceStatement = {
  standard?: boolean;
  preferentialOrigin?: boolean;
  eur1?: boolean;
  cites?: boolean;
};

export type PaperlessInvoicePartyIds = {
  shipperVatNumber?: string;
  shipperEoriNumber?: string;
  consigneeVatNumber?: string;
  consigneeEoriNumber?: string;
};

export type BillingAddress = {
  company: string;
  country: string; // ISO2
  postalCode: string;
  street: string;
  houseNumber?: string;
  city: string;
  region?: string;
  phoneNumber?: string;
  vatNumber?: string;
};

export type PaperlessInvoiceLineItem = {
  description: string;
  hsCode: string;
  quantity: number;
  unit: string;
  unitValue: number;
  netWeight?: number;
  grossWeight?: number;
  originCountry: string; // ISO2
};

export type PaperlessInvoice = {
  invoiceType: InvoiceType;
  currency: string; // ISO3
  partyIds?: PaperlessInvoicePartyIds;
  billingAddress?: BillingAddress | null;
  extraCosts?: Array<{ type: string; value: number }>;
  reasonForExport: InvoiceReasonForExport;
  paymentConditions: string;
  incoterms: Incoterm;
  invoiceNumber: string;
  clientReference?: string;
  consigneeReference?: string;
  remarks?: string;
  statement?: InvoiceStatement;
  signer: { name: string; function?: string };
  lines: PaperlessInvoiceLineItem[];
};

export type AddressShipmentInput = {
  company?: string;
  firstName: string;
  lastName: string;
  email?: string;
  phoneNumber: string;
  country: string; // ISO2
  postalCode: string;
  city: string;
  street: string;
  houseNumber?: string;
  region?: string;
};

export type ShipmentCreateRequest_WithPaperlessInvoice = {
  reference: string;
  shipper: AddressShipmentInput;
  recipient: AddressShipmentInput;
  paperlessInvoice: PaperlessInvoice;
  items?: Array<{ weight?: number; netWeight?: number; grossWeight?: number }>;
};

// ── losse structurele input-typen (het canonieke zendingsmodel, zonder import
//    uit widget-ui: de server importeert dit bestand ook) ─────────────────────────

export type PaperlessAddressLike = {
  company?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phoneNumber?: string;
  street?: string[];
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
};

export type PaperlessProductLike = {
  sku?: string;
  name?: string;
  description?: string;
  hsCode?: string;
  value?: number;
  weight?: number;
  originCountry?: string;
  quantity?: number;
};

export type PaperlessShipmentLike = {
  orderId?: string;
  products?: PaperlessProductLike[];
  shipperAddress?: PaperlessAddressLike;
  recipientAddress?: PaperlessAddressLike;
  shipmentOptions?: {
    invoiceRef?: string;
    exportReason?: string;
    incotermsGroupD?: string;
    [k: string]: unknown;
  };
  paperlessInvoice?: {
    invoiceType?: string;
    currency?: string;
    vatNumberShipper?: string;
    vatNumberConsignee?: string;
    eoriNumberShipper?: string;
    eoriNumberConsignee?: string;
    billingAddressDiffersFromDeliveryAddress?: boolean;
    billingAddress?: PaperlessAddressLike;
    paymentConditions?: string;
    receiverReference?: string;
    remarks?: string;
    invoiceStatement?: {
      standard?: boolean;
      preferentialOrigin?: boolean;
      euri?: boolean;
      cites?: boolean;
    };
    declarantName?: string;
    declarantPosition?: string;
    [k: string]: unknown;
  };
  [k: string]: unknown;
};

// ── laag 1: mapper (v1 utils/paperlessInvoiceMapper.ts, letterlijk) ───────────────

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function n(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function splitStreet(street: string[] | undefined): {
  street: string;
  houseNumber: string;
} {
  return {
    street: clean(street?.[0]),
    houseNumber: clean(street?.[1]),
  };
}

type ToAddressInputOptions = {
  /** v1: naam vóór in het company-veld ("Company / Voor Achternaam") — sommige
   *  koeriers eisen de contactnaam zichtbaar op het douanedocument. */
  mergeNameIntoCompany?: boolean;
};

function toAddressInput(
  address: PaperlessAddressLike | undefined,
  opts: ToAddressInputOptions = {},
): AddressShipmentInput {
  if (!address) {
    return {
      firstName: "",
      lastName: "",
      phoneNumber: "",
      country: "",
      postalCode: "",
      city: "",
      street: "",
      houseNumber: "",
    };
  }

  const street = splitStreet(address.street);

  let company = clean(address.company);
  if (opts.mergeNameIntoCompany) {
    const fullName = [clean(address.firstName), clean(address.lastName)]
      .filter(Boolean)
      .join(" ");
    if (fullName) company = company ? `${company} / ${fullName}` : fullName;
  }

  return {
    company,
    firstName: clean(address.firstName),
    lastName: clean(address.lastName),
    email: clean(address.email),
    phoneNumber: clean(address.phoneNumber),
    country: clean(address.country).toUpperCase(),
    postalCode: clean(address.postalCode),
    city: clean(address.city),
    street: street.street,
    houseNumber: street.houseNumber,
    region: clean(address.region),
  };
}

function mapInvoiceType(value: unknown): InvoiceType {
  const raw = clean(value).toLowerCase();

  if (raw === "pro_forma_invoice" || raw === "proforma" || raw === "PROFORMA") {
    return "PROFORMA";
  }

  return "COMMERCIAL";
}

function mapExportReason(value: unknown): InvoiceReasonForExport {
  const raw = clean(value).toLowerCase();

  if (raw === "gift") return "GIFT";
  if (raw === "personal") return "PERSONAL";
  if (raw === "sample") return "SAMPLE";
  if (raw === "retour" || raw === "return") return "RETURN_TO_ORIGIN_COMMERCIAL";
  if (raw === "retour after repair" || raw === "return after repair") {
    return "RETURN_AFTER_REPAIR";
  }

  return "COMMERCIAL_PURPOSE";
}

function getQuantity(product: PaperlessProductLike): number {
  return Math.max(1, n((product as any).quantity, 1));
}

function mapLines(products: PaperlessProductLike[] | undefined) {
  return (products ?? []).map((product) => {
    const quantity = getQuantity(product);

    return {
      description: clean(product.description || product.name),
      hsCode: clean(product.hsCode),
      quantity,
      unit: "PIECES" as const,
      unitValue: n(product.value),
      netWeight: n(product.weight),
      grossWeight: n(product.weight),
      originCountry: clean(product.originCountry).toUpperCase(),
    };
  });
}

function mapBillingAddress(shipment: PaperlessShipmentLike) {
  const paperless = shipment.paperlessInvoice;

  if (!paperless?.billingAddressDiffersFromDeliveryAddress) {
    return null;
  }

  const billing = paperless.billingAddress;
  if (!billing) return null;

  const street = splitStreet(billing.street);

  return {
    company: clean(billing.company),
    country: clean(billing.country).toUpperCase(),
    postalCode: clean(billing.postalCode),
    street: street.street,
    houseNumber: street.houseNumber,
    city: clean(billing.city),
    region: clean(billing.region),
    phoneNumber: clean(billing.phoneNumber),
    vatNumber: clean(paperless.vatNumberConsignee),
  };
}

export type BuildPaperlessInvoiceRequestOptions = {
  /** Spiegelt userpref `widgetBehavior.includeNameInPaperlessCompany` — alleen op de
   *  factuur; het label houdt company + naam gescheiden. */
  includeRecipientNameInCompany?: boolean;
};

export function buildPaperlessInvoiceRequestFromShipment(
  shipment: PaperlessShipmentLike,
  buildOpts: BuildPaperlessInvoiceRequestOptions = {},
): ShipmentCreateRequest_WithPaperlessInvoice {
  const opts = shipment.shipmentOptions;
  const paperless = shipment.paperlessInvoice;

  if (!opts) {
    throw new Error("Missing shipmentOptions.");
  }

  if (!paperless) {
    throw new Error("Missing paperlessInvoice fields.");
  }

  const invoice: PaperlessInvoice = {
    invoiceType: mapInvoiceType(paperless.invoiceType),
    currency: clean(paperless.currency || "EUR"),

    partyIds: {
      shipperVatNumber: clean(paperless.vatNumberShipper),
      shipperEoriNumber: clean(paperless.eoriNumberShipper),
      consigneeVatNumber: clean(paperless.vatNumberConsignee),
      consigneeEoriNumber: clean(paperless.eoriNumberConsignee),
    },

    billingAddress: mapBillingAddress(shipment),

    reasonForExport: mapExportReason(opts.exportReason),
    paymentConditions: clean(paperless.paymentConditions),
    incoterms: (opts.incotermsGroupD as Incoterm | undefined) ?? "DAP",
    invoiceNumber: clean(opts.invoiceRef),
    clientReference: clean(opts.invoiceRef),
    consigneeReference: clean(paperless.receiverReference),
    remarks: clean(paperless.remarks),

    statement: {
      standard: paperless.invoiceStatement?.standard ?? true,
      preferentialOrigin:
        paperless.invoiceStatement?.preferentialOrigin ?? false,
      eur1: paperless.invoiceStatement?.euri ?? false,
      cites: paperless.invoiceStatement?.cites ?? false,
    },

    signer: {
      name: clean(paperless.declarantName),
      function: clean(paperless.declarantPosition),
    },

    lines: mapLines(shipment.products),
  };

  return {
    reference: clean(opts.invoiceRef || shipment.orderId),
    shipper: toAddressInput(shipment.shipperAddress),
    recipient: toAddressInput(shipment.recipientAddress, {
      mergeNameIntoCompany: buildOpts.includeRecipientNameInCompany,
    }),
    paperlessInvoice: invoice,
  };
}

// ── laag 2: invoice.php-payload (v1 steps/paperlessInvoice.ts, letterlijk) ────────

function currencySymbol(iso3: string): string {
  const c = iso3.toUpperCase();
  if (c === "EUR") return "€";
  if (c === "USD") return "$";
  if (c === "GBP") return "£";
  return c;
}

function parsePaymentDays(paymentConditions: string): number | undefined {
  const m = String(paymentConditions ?? "").match(/(\d{1,3})/);
  if (!m) return undefined;
  const num = Number(m[1]);
  return Number.isFinite(num) ? num : undefined;
}

function fullName(a: AddressShipmentInput): string {
  const base = `${a.firstName ?? ""} ${a.lastName ?? ""}`.trim();
  return base || a.company || "";
}
function sum(nums: number[]) {
  return Math.round(nums.reduce((a, b) => a + b, 0) * 100) / 100;
}
function cc2(v: unknown): string {
  return String(v ?? "")
    .trim()
    .toUpperCase();
}

export function buildTffInvoicePhpPayload(args: {
  req: ShipmentCreateRequest_WithPaperlessInvoice;
  customerId: string | number;
  sessionkey: string;
  carrier?: string;
  serviceDescription?: string;
  body?: any;
}): Record<string, string | number | (string | number)[]> {
  const { req, customerId, sessionkey, carrier, serviceDescription, body } =
    args;
  const inv = req.paperlessInvoice;

  const statement = inv.statement ?? {};
  const extraCosts = inv.extraCosts ?? [];
  const lines = inv.lines ?? [];
  const items = Array.isArray(req.items) ? req.items : [];

  // De factuur-PDF print gewicht rechtstreeks van de regels; val terug op regel-`weight`
  // en daarna op de items[]-entry op dezelfde index (anders overal 0 kg).
  const lineWeights = lines.map((l, i) => {
    const item = items[i] ?? {};
    const lineWeight = n((l as any).weight);
    const net = n(l.netWeight) || lineWeight || n(item.netWeight) || n(item.weight);
    const gross =
      n(l.grossWeight) || lineWeight || n(item.grossWeight) || n(item.weight) || net;
    return { net, gross };
  });

  const fallbackClientRef = String(inv.clientReference ?? req.reference ?? "");
  const partyIds = inv.partyIds ?? {};

  const reg = body?.shippingOptions?.registration ?? {};
  const VAT_sender = partyIds.shipperVatNumber ?? reg?.shipperNumber ?? "";
  const VAT_consignee =
    partyIds.consigneeVatNumber ?? reg?.recipientNumber ?? "";
  const EORI_sender = partyIds.shipperEoriNumber ?? "";
  const EORI_consignee = partyIds.consigneeEoriNumber ?? "";

  const invQty = sum(lines.map((l) => n(l.quantity)));
  const invValue = sum(lines.map((l) => n(l.quantity) * n(l.unitValue)));
  const invExtra = sum(extraCosts.map((c) => n(c.value)));
  const invNetKgs = sum(lineWeights.map((w) => w.net));
  const invGrossKgs = sum(lineWeights.map((w) => w.gross));
  const varTotalValue = sum([invValue, invExtra]);

  const firstCoo =
    cc2(
      lines.find((l) => String(l.originCountry ?? "").trim())?.originCountry,
    ) ||
    cc2(body?.shippingOptions?.originCountry) ||
    cc2(req.shipper.country);

  const billing = inv.billingAddress ?? null;
  const billTo: BillingAddress =
    billing && typeof billing === "object"
      ? billing
      : {
          company: req.recipient.company ?? fullName(req.recipient),
          country: req.recipient.country,
          postalCode: req.recipient.postalCode,
          street: req.recipient.street,
          houseNumber: req.recipient.houseNumber ?? "",
          city: req.recipient.city,
          region: req.recipient.region,
          phoneNumber: req.recipient.phoneNumber,
          vatNumber: partyIds.consigneeVatNumber,
        };

  const senderName = req.shipper.company ?? fullName(req.shipper);
  const shipToName = req.recipient.company ?? fullName(req.recipient);
  const paymentDays = parsePaymentDays(inv.paymentConditions);

  return {
    sessionkey,

    ...(extraCosts.length
      ? {
          "extra_cost_type[]": extraCosts.map((c) => c.type),
          "extra_cost_value[]": extraCosts.map((c) => c.value),
        }
      : {}),

    var_currency: inv.currency.toUpperCase(),
    var_currency_symbol: currencySymbol(inv.currency),

    "art_qty[]": lines.map((l) => n(l.quantity)),
    "art_description[]": lines.map((l) => String(l.description ?? "")),
    "art_hscode[]": lines.map((l) => String(l.hsCode ?? "")),
    "art_units[]": lines.map((l) => String(l.unit ?? "")),
    "art_value[]": lines.map((l) => n(l.unitValue)),
    "art_net_weight[]": lineWeights.map((w) => w.net),
    "art_gross_weight[]": lineWeights.map((w) => w.gross),
    "art_coo[]": ["", ...lines.map((l) => l.originCountry)],

    landvanoorsprong: firstCoo,
    goederenomschrijving: lines[0]?.description ?? "",
    inv_qty: invQty,
    inv_kgs: invNetKgs,
    inv_kgs_bruto: invGrossKgs,
    inv_value: invValue,
    inv_extracosts_value: invExtra,
    var_total_value: varTotalValue,

    invoicetype: inv.invoiceType,
    EORI_sender,
    EORI_consignee,
    VAT_sender,
    VAT_consignee,
    roe: inv.reasonForExport,
    incoterms: inv.incoterms,
    ...(paymentDays !== undefined ? { payment_conditions: paymentDays } : {}),
    invoice_number: inv.invoiceNumber,

    factuurreferentie: fallbackClientRef,
    consignee_reference: inv.consigneeReference ?? "",
    remarks: inv.remarks ?? "",

    standard: String(statement.standard ?? true),
    pref: String(statement.preferentialOrigin ?? false),
    EUR1: String(statement.eur1 ?? false),
    cites: String(statement.cites ?? false),

    shipper_name: inv.signer.name,
    shipper_function: inv.signer.function ?? "",

    sender_naam: senderName,
    sender_straat: req.shipper.street,
    sender_huisnummer: req.shipper.houseNumber ?? "",
    sender_postcode: req.shipper.postalCode,
    sender_plaats: req.shipper.city,
    sender_land: cc2(req.shipper.country),
    sender_phone: req.shipper.phoneNumber,
    sender_vat: VAT_sender,

    billto_naam: billTo.company,
    billto_straat: billTo.street,
    billto_huisnummer: billTo.houseNumber ?? "",
    billto_postcode: billTo.postalCode,
    billto_plaats: billTo.city,
    billto_land: cc2(billTo.country),
    billto_phone: billTo.phoneNumber ?? "",
    billto_vat: billTo.vatNumber ?? VAT_consignee,

    shipto_naam: shipToName,
    shipto_straat: req.recipient.street,
    shipto_huisnummer: req.recipient.houseNumber ?? "",
    shipto_postcode: req.recipient.postalCode,
    shipto_plaats: req.recipient.city,
    shipto_land: cc2(req.recipient.country),
    shipto_phone: req.recipient.phoneNumber,
    shipto_vat: VAT_consignee,

    carrier: carrier ?? "TFF",
    service_description: serviceDescription ?? "",

    customerid: customerId,
  };
}

/** Form-urlencoded body zoals v1's generatePltInvoiceBlob 'm bouwde: URLSearchParams,
 *  arrays één append per item. Byte-identiek bevroren door het oracle. */
export function encodeInvoicePhpBody(
  payload: Record<string, string | number | (string | number)[]>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(payload)) {
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, String(item));
    } else {
      params.append(key, String(value));
    }
  }
  return params.toString();
}
