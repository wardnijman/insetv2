// Geport uit v1 src/lib/validations/paperlessInvoice.ts. Wijzigingen: import van
// `../steps/domain.json` (generated laag) vervangen door een optionele `domain`-parameter
// in ValidatePaperlessInvoiceOptions (alleen `postalCodes` wordt gebruikt).

import type {
  Address,
  ProductTemplate,
  ShipmentTemplate,
  ValidationResult,
} from "../types/config";

export type PaperlessInvoiceValidationIssue = {
  path: string;
  reason: "required" | "invalid" | "out_of_range";
  message: string;
};

export type PaperlessInvoiceValidationResult = ValidationResult & {
  issues: PaperlessInvoiceValidationIssue[];
};

// TODO(provider-param): v1 importeerde steps/domain.json rechtstreeks; de aanroeper levert
// nu de domain-data. Alleen `postalCodes` (ISO → patroon of "geen") wordt gebruikt. Zonder
// domain wordt een postcode nooit als verplicht gemarkeerd.
export type PaperlessInvoiceDomain = {
  postalCodes?: Record<string, string>;
};

type ValidatePaperlessInvoiceOptions = {
  requireDeclarantName?: boolean;
  requirePaymentConditions?: boolean;
  domain?: PaperlessInvoiceDomain;
};

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function hasValue(value: unknown): boolean {
  return clean(value).length > 0;
}

function isPositiveNumber(value: unknown): boolean {
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

// Mirrors the generated step validators: TFF marks these countries "geen"
// (no postcode format enforced), so the address step accepts an empty postcode
// there and the invoice must too — otherwise this validator blocks with an
// issue the customs panel has no field for.
function postalCodeRequired(
  country: unknown,
  domain?: PaperlessInvoiceDomain,
): boolean {
  const iso = clean(country);
  if (!iso) return true;
  const pattern = domain?.postalCodes?.[iso];
  return Boolean(pattern) && pattern !== "geen";
}

function isNonNegativeNumber(value: unknown): boolean {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0;
}

function addIssue(
  issues: PaperlessInvoiceValidationIssue[],
  path: string,
  reason: PaperlessInvoiceValidationIssue["reason"],
  message: string,
) {
  issues.push({ path, reason, message });
}

function validateAddress(
  issues: PaperlessInvoiceValidationIssue[],
  prefix: string,
  address: Address | undefined,
  label: string,
  domain?: PaperlessInvoiceDomain,
) {
  if (!address) {
    addIssue(issues, prefix, "required", `${label} is required.`);
    return;
  }

  if (!hasValue(address.country)) {
    addIssue(
      issues,
      `${prefix}.country`,
      "required",
      `${label} country is required.`,
    );
  }

  if (postalCodeRequired(address.country, domain) && !hasValue(address.postalCode)) {
    addIssue(
      issues,
      `${prefix}.postalCode`,
      "required",
      `${label} postal code is required.`,
    );
  }

  if (!hasValue(address.city)) {
    addIssue(
      issues,
      `${prefix}.city`,
      "required",
      `${label} city is required.`,
    );
  }

  if (!hasValue(address.street?.[0])) {
    addIssue(
      issues,
      `${prefix}.street`,
      "required",
      `${label} street is required.`,
    );
  }

  if (!hasValue(address.company) && !hasValue(address.firstName) && !hasValue(address.lastName)) {
    addIssue(
      issues,
      `${prefix}.company`,
      "required",
      `${label} name or company is required.`,
    );
  }
}

function validateProducts(
  issues: PaperlessInvoiceValidationIssue[],
  products: ProductTemplate[] | undefined,
) {
  if (!products?.length) {
    addIssue(
      issues,
      "products",
      "required",
      "At least one product is required for a customs invoice.",
    );
    return;
  }

  products.forEach((product, index) => {
    const base = `products[${index}]`;
    const productLabel = product.name || product.sku || `Product ${index + 1}`;

    if (!hasValue(product.description)) {
      addIssue(
        issues,
        `${base}.description`,
        "required",
        `${productLabel}: description is required.`,
      );
    }

    if (!hasValue(product.hsCode)) {
      addIssue(
        issues,
        `${base}.hsCode`,
        "required",
        `${productLabel}: HS code is required.`,
      );
    }

    if (!isPositiveNumber(product.value)) {
      addIssue(
        issues,
        `${base}.value`,
        "out_of_range",
        `${productLabel}: value must be greater than 0.`,
      );
    }

    if (!isPositiveNumber(product.weight)) {
      addIssue(
        issues,
        `${base}.weight`,
        "out_of_range",
        `${productLabel}: weight must be greater than 0.`,
      );
    }

    if (!isPositiveNumber((product as any).quantity ?? 1)) {
      addIssue(
        issues,
        `${base}.quantity`,
        "out_of_range",
        `${productLabel}: quantity must be greater than 0.`,
      );
    }

    if (!hasValue(product.originCountry)) {
      addIssue(
        issues,
        `${base}.originCountry`,
        "required",
        `${productLabel}: origin country is required.`,
      );
    }
  });
}

function validateBillingAddressIfNeeded(
  issues: PaperlessInvoiceValidationIssue[],
  shipment: ShipmentTemplate,
  domain?: PaperlessInvoiceDomain,
) {
  const paperless = shipment.paperlessInvoice;

  if (!paperless?.billingAddressDiffersFromDeliveryAddress) return;

  validateAddress(
    issues,
    "paperlessInvoice.billingAddress",
    paperless.billingAddress,
    "Billing address",
    domain,
  );
}

export function validatePaperlessInvoice(
  shipment: ShipmentTemplate,
  options: ValidatePaperlessInvoiceOptions = {},
): PaperlessInvoiceValidationResult {
  const issues: PaperlessInvoiceValidationIssue[] = [];

  const shipmentOptions = shipment.shipmentOptions;
  const paperless = shipment.paperlessInvoice;

  validateAddress(
    issues,
    "shipperAddress",
    shipment.shipperAddress,
    "Shipper address",
    options.domain,
  );

  validateAddress(
    issues,
    "recipientAddress",
    shipment.recipientAddress,
    "Recipient address",
    options.domain,
  );

  validateProducts(issues, shipment.products);

  if (!shipmentOptions) {
    addIssue(
      issues,
      "shipmentOptions",
      "required",
      "Shipment options are required.",
    );
  } else {
    if (!hasValue(shipmentOptions.exportReason)) {
      addIssue(
        issues,
        "shipmentOptions.exportReason",
        "required",
        "Reason for export is required.",
      );
    }

    if (!hasValue(shipmentOptions.incotermsGroupD)) {
      addIssue(
        issues,
        "shipmentOptions.incotermsGroupD",
        "required",
        "Incoterm is required.",
      );
    }

    if (!hasValue(shipmentOptions.invoiceRef)) {
      addIssue(
        issues,
        "shipmentOptions.invoiceRef",
        "required",
        "Invoice reference is required.",
      );
    }

    if (!isPositiveNumber(shipmentOptions.totalShipmentValue)) {
      addIssue(
        issues,
        "shipmentOptions.totalShipmentValue",
        "out_of_range",
        "Total shipment value must be greater than 0.",
      );
    }

    if (!hasValue(shipmentOptions.shipmentOriginCountry)) {
      addIssue(
        issues,
        "shipmentOptions.shipmentOriginCountry",
        "required",
        "Shipment origin country is required.",
      );
    }
  }

  if (!paperless) {
    addIssue(
      issues,
      "paperlessInvoice",
      "required",
      "Paperless invoice details are required.",
    );
  } else {
    if (!hasValue(paperless.invoiceType)) {
      addIssue(
        issues,
        "paperlessInvoice.invoiceType",
        "required",
        "Invoice type is required.",
      );
    }

    if (!hasValue(paperless.currency)) {
      addIssue(
        issues,
        "paperlessInvoice.currency",
        "required",
        "Currency is required.",
      );
    }

    if (options.requireDeclarantName && !hasValue(paperless.declarantName)) {
      addIssue(
        issues,
        "paperlessInvoice.declarantName",
        "required",
        "Your name is required.",
      );
    }

    if (
      options.requirePaymentConditions &&
      !hasValue(paperless.paymentConditions)
    ) {
      addIssue(
        issues,
        "paperlessInvoice.paymentConditions",
        "required",
        "Payment conditions are required.",
      );
    }
  }

  validateBillingAddressIfNeeded(issues, shipment, options.domain);

  return {
    valid: issues.length === 0,
    message:
      issues.length === 0
        ? ""
        : `${issues.length} invoice field${issues.length === 1 ? "" : "s"} missing or invalid.`,
    reason: issues.length === 0 ? undefined : "invalid",
    issues,
  };
}

export function getFirstPaperlessInvoiceIssue(
  result: PaperlessInvoiceValidationResult,
): PaperlessInvoiceValidationIssue | undefined {
  return result.issues[0];
}
