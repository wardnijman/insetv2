// Geport uit v1 src/lib/utils/paperlessInvoiceDefaults.ts. Wijzigingen: geen.

import type {
  Currency,
  ProductTemplate,
  ShipmentTemplate,
} from "../types/config";

type EnsurePaperlessInvoiceDefaultsOptions = {
  declarantName?: string;
  declarantPosition?: string;
  defaultCarrier?: string;
  defaultCurrency?: Currency;
  defaultInvoiceType?: "commercial_invoice" | "pro_forma_invoice";
  defaultOriginCountry?: string;
};

function cleanString(value: unknown): string {
  return String(value ?? "").trim();
}

function hasValue(value: unknown): boolean {
  return cleanString(value).length > 0;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function getProductLineValue(product: ProductTemplate): number {
  const quantity = Number((product as any).quantity ?? 1);
  const value = Number(product.value ?? 0);

  if (!Number.isFinite(quantity) || quantity <= 0) return 0;
  if (!Number.isFinite(value) || value <= 0) return 0;

  return quantity * value;
}

function sumProductsValue(products: ProductTemplate[] | undefined): number {
  if (!products?.length) return 0;

  return roundMoney(
    products.reduce((sum, product) => sum + getProductLineValue(product), 0),
  );
}

function inferVatOrEoriFromRegistration(opts: {
  type?: string;
  value?: string;
}): {
  vat?: string;
  eori?: string;
} {
  const type = cleanString(opts.type).toUpperCase();
  const value = cleanString(opts.value);

  if (!value) return {};

  if (type.includes("VAT") || type.includes("BTW")) {
    return { vat: value };
  }

  if (type.includes("EORI")) {
    return { eori: value };
  }

  // Fallback: EORI is usually the safer customs default.
  return { eori: value };
}

function normalizeProducts(
  products: ProductTemplate[] | undefined,
  fallbackOriginCountry: string,
): ProductTemplate[] | undefined {
  if (!products?.length) return products;

  return products.map((product) => ({
    ...product,
    quantity: Number((product as any).quantity ?? 1),
    currency: product.currency ?? "EUR",
    originCountry: hasValue(product.originCountry)
      ? product.originCountry
      : fallbackOriginCountry || product.originCountry,
  }));
}

export function ensurePaperlessInvoiceDefaults(
  shipment: ShipmentTemplate,
  options: EnsurePaperlessInvoiceDefaultsOptions = {},
): ShipmentTemplate {
  const shipmentOptions = shipment.shipmentOptions ?? ({} as any);
  const currentPaperless = shipment.paperlessInvoice ?? {};

  const defaultCurrency = options.defaultCurrency ?? "EUR";
  const defaultInvoiceType = options.defaultInvoiceType ?? "commercial_invoice";
  const defaultCarrier = options.defaultCarrier ?? "TFF";

  const fallbackOriginCountry =
    cleanString(shipmentOptions.shipmentOriginCountry) ||
    cleanString(options.defaultOriginCountry) ||
    "NL";

  const products = normalizeProducts(shipment.products, fallbackOriginCountry);

  const computedTotalShipmentValue = sumProductsValue(products);

  const shipperRegistration = inferVatOrEoriFromRegistration({
    type: shipmentOptions.registrationNumberTypeShipper,
    value: shipmentOptions.registrationNumberShipper,
  });

  const recipientRegistration = inferVatOrEoriFromRegistration({
    type: shipmentOptions.registrationNumberTypeRecipient,
    value: shipmentOptions.registrationNumberRecipient,
  });

  const chosenCarrier =
    cleanString(shipmentOptions.chosenRate?.carrier) ||
    cleanString(shipment.carrier) ||
    defaultCarrier;

  return {
    ...shipment,

    products,

    shipmentOptions: {
      ...shipmentOptions,

      shipmentOriginCountry:
        cleanString(shipmentOptions.shipmentOriginCountry) ||
        fallbackOriginCountry,

      totalShipmentValue:
        Number(shipmentOptions.totalShipmentValue ?? 0) > 0
          ? shipmentOptions.totalShipmentValue
          : computedTotalShipmentValue,
    },

    paperlessInvoice: {
      ...currentPaperless,

      invoiceType: currentPaperless.invoiceType ?? defaultInvoiceType,
      currency: currentPaperless.currency ?? defaultCurrency,

      vatNumberShipper:
        currentPaperless.vatNumberShipper ??
        shipperRegistration.vat ??
        "",

      eoriNumberShipper:
        currentPaperless.eoriNumberShipper ??
        shipperRegistration.eori ??
        "",

      vatNumberConsignee:
        currentPaperless.vatNumberConsignee ??
        recipientRegistration.vat ??
        shipmentOptions.recipientVAT ??
        "",

      eoriNumberConsignee:
        currentPaperless.eoriNumberConsignee ??
        recipientRegistration.eori ??
        shipmentOptions.recipientEORI ??
        "",

      billingAddressDiffersFromDeliveryAddress:
        currentPaperless.billingAddressDiffersFromDeliveryAddress ?? false,

      billingAddress: currentPaperless.billingAddress,

      paymentConditions: currentPaperless.paymentConditions ?? "",

      carrier: currentPaperless.carrier ?? chosenCarrier,

      receiverReference:
        currentPaperless.receiverReference ??
        shipmentOptions.invoiceRef ??
        "",

      remarks: currentPaperless.remarks ?? "",

      invoiceStatement: {
        standard: currentPaperless.invoiceStatement?.standard ?? true,
        preferentialOrigin:
          currentPaperless.invoiceStatement?.preferentialOrigin ?? false,
        euri: currentPaperless.invoiceStatement?.euri ?? false,
        cites: currentPaperless.invoiceStatement?.cites ?? false,
      },

      declarantName:
        currentPaperless.declarantName ??
        options.declarantName ??
        "",

      declarantPosition:
        currentPaperless.declarantPosition ??
        options.declarantPosition ??
        "",
    },
  };
}
