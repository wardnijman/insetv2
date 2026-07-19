// Geport uit v1 src/lib/utils/paperlessInvoiceGenerator.ts. Wijzigingen: generated-laag
// imports (steps/paperlessInvoice + utils/paperlessInvoiceMapper) geparametriseerd als
// PaperlessInvoiceProvider (types lokaal structureel gespiegeld); `domain` doorgegeven
// aan validatePaperlessInvoice.

import type { ShipmentTemplate } from "../types/config";
import { ensurePaperlessInvoiceDefaults } from "../utils/paperlessInvoiceDefaults";
import {
  validatePaperlessInvoice,
  type PaperlessInvoiceDomain,
  type PaperlessInvoiceValidationResult,
} from "../validations/paperlessInvoice";

// ── TODO(provider-param) ────────────────────────────────────────────────────
// v1 importeerde hier rechtstreeks uit de generated laag:
//   - buildPaperlessInvoiceRequestFromShipment  (utils/paperlessInvoiceMapper)
//   - generateAndAttachPltInvoice, generatePltInvoiceBlob, GeneratedInvoiceBlobResult
//     (steps/paperlessInvoice)
// De aanroeper levert die implementaties nu via een PaperlessInvoiceProvider.
// Onderstaande types zijn structurele spiegels van v1's generated types.

export type PaperlessStepCtx = {
  fetch?: typeof globalThis.fetch;
  cookieHeader?: string;
};

export type GeneratedInvoiceBlobResult = {
  invoice: {
    base64: string;
    filename: string;
    contentType: "application/pdf";
  };
  url?: string;
};

export type PaperlessInvoiceProvider<
  TReq extends { reference?: unknown } = { reference?: unknown },
> = {
  /** v1: buildPaperlessInvoiceRequestFromShipment (utils/paperlessInvoiceMapper). */
  buildRequest: (
    shipment: ShipmentTemplate,
    opts: { includeRecipientNameInCompany?: boolean },
  ) => TReq;
  /** v1: generateAndAttachPltInvoice (steps/paperlessInvoice). */
  generateAndAttach: (args: {
    req: TReq;
    ctx: PaperlessStepCtx;
    sessionkey: string;
    customerId: string | number;
    carrier?: string;
    serviceDescription?: string;
  }) => Promise<{ url: string }>;
  /** v1: generatePltInvoiceBlob (steps/paperlessInvoice). */
  generateBlob: (args: {
    req: TReq;
    ctx: PaperlessStepCtx;
    sessionkey: string;
    customerId: string | number;
    carrier?: string;
    serviceDescription?: string;
    filename?: string;
  }) => Promise<GeneratedInvoiceBlobResult>;
};
// ── einde TODO(provider-param) ──────────────────────────────────────────────

type GeneratePaperlessInvoiceOptions = {
  customerId: string | number;
  fetchFn?: typeof fetch;
  requireDeclarantName?: boolean;
  requirePaymentConditions?: boolean;
  defaultCarrier?: string;
  defaultCurrency?: "EUR" | "USD" | "GBP" | "JPY" | "CNY" | "CHF";
  defaultInvoiceType?: "commercial_invoice" | "pro_forma_invoice";
  declarantName?: string;
  declarantPosition?: string;
  sessionKey?: string;
  attachToTff?: boolean;
  /** Mirrors `userPreferences.widgetBehavior.includeNameInPaperlessCompany`. When true,
   *  the paperless invoice's recipient.company becomes "Company / firstName lastName"
   *  (some carriers require the contact name on the customs document, others need just
   *  the company — toggle is per-user). */
  includeRecipientNameInCompany?: boolean;
  // TODO(provider-param): v1 haalde postalCodes uit steps/domain.json binnen de
  // validatie; de aanroeper geeft de domain-data nu hier mee.
  domain?: PaperlessInvoiceDomain;
};

export type GeneratePaperlessInvoiceResult = GeneratedInvoiceBlobResult & {
  shipment: ShipmentTemplate;
  validation: PaperlessInvoiceValidationResult;
};

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function safeFileNamePart(value: unknown): string {
  const cleaned = clean(value)
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return cleaned || "invoice";
}

function resolveSessionKey(
  shipment: ShipmentTemplate,
  explicitSessionKey?: string,
): string {
  const explicit = clean(explicitSessionKey);
  if (explicit) return explicit;

  const fromShipmentOptions = clean((shipment as any)?.shipmentOptions?.sessionKey);
  if (fromShipmentOptions) return fromShipmentOptions;

  const reference = clean(shipment.shipmentOptions?.invoiceRef || shipment.orderId);
  if (reference) return `draft-${safeFileNamePart(reference)}`;

  return `draft-${Date.now()}`;
}

function resolveCarrier(shipment: ShipmentTemplate, fallback = "TFF"): string {
  return (
    clean(shipment.paperlessInvoice?.carrier) ||
    clean(shipment.shipmentOptions?.chosenRate?.carrier) ||
    clean(shipment.carrier) ||
    fallback
  );
}

function resolveServiceDescription(shipment: ShipmentTemplate): string {
  return (
    clean(shipment.shipmentOptions?.chosenRate?.serviceDescription) ||
    clean(shipment.shipmentOptions?.chosenRate?.service) ||
    ""
  );
}

function resolveCookieHeader(): string {
  try {
    if (typeof document !== "undefined") return document.cookie || "";
  } catch {
    // ignore
  }

  return "";
}

export function preparePaperlessInvoiceShipment(
  shipment: ShipmentTemplate,
  options: Pick<
    GeneratePaperlessInvoiceOptions,
    | "defaultCarrier"
    | "defaultCurrency"
    | "defaultInvoiceType"
    | "declarantName"
    | "declarantPosition"
  > = {},
): ShipmentTemplate {
  return ensurePaperlessInvoiceDefaults(shipment, {
    declarantName: options.declarantName ?? "",
    declarantPosition: options.declarantPosition ?? "",
    defaultCarrier: options.defaultCarrier ?? "TFF",
    defaultCurrency: options.defaultCurrency ?? "EUR",
    defaultInvoiceType: options.defaultInvoiceType ?? "commercial_invoice",
  });
}

export function validatePreparedPaperlessInvoice(
  shipment: ShipmentTemplate,
  options: Pick<
    GeneratePaperlessInvoiceOptions,
    "requireDeclarantName" | "requirePaymentConditions" | "domain"
  > = {},
): PaperlessInvoiceValidationResult {
  return validatePaperlessInvoice(shipment, {
    requireDeclarantName: options.requireDeclarantName ?? false,
    requirePaymentConditions: options.requirePaymentConditions ?? false,
    domain: options.domain,
  });
}

export async function generatePaperlessInvoiceForShipment<
  TReq extends { reference?: unknown },
>(
  shipment: ShipmentTemplate,
  options: GeneratePaperlessInvoiceOptions,
  // TODO(provider-param): verplicht — v1 gebruikte hier de generated TFF-implementaties.
  provider: PaperlessInvoiceProvider<TReq>,
): Promise<GeneratePaperlessInvoiceResult> {
  const preparedShipment = preparePaperlessInvoiceShipment(shipment, options);

  const validation = validatePreparedPaperlessInvoice(preparedShipment, {
    requireDeclarantName: options.requireDeclarantName,
    requirePaymentConditions: options.requirePaymentConditions,
    domain: options.domain,
  });

  if (!validation.valid) {
    throw Object.assign(
      new Error(validation.message || "Paperless invoice details are incomplete."),
      {
        code: "PAPERLESS_INVOICE_VALIDATION_ERROR",
        validation,
      },
    );
  }

  const req = provider.buildRequest(preparedShipment, {
    includeRecipientNameInCompany: options.includeRecipientNameInCompany,
  });

  const sessionkey = resolveSessionKey(preparedShipment, options.sessionKey);
  const carrier = resolveCarrier(preparedShipment, options.defaultCarrier ?? "TFF");
  const serviceDescription = resolveServiceDescription(preparedShipment);

  const reference = safeFileNamePart(req.reference || preparedShipment.orderId || sessionkey);

let result;

if (options.attachToTff) {
  const attachResult = await provider.generateAndAttach({
    req,
    ctx: {
      fetch: options.fetchFn ?? fetch,
      cookieHeader: document.cookie,
    },
    sessionkey,
    customerId: options.customerId,
    carrier,
    serviceDescription,
  });

  result = {
    invoice: {
      base64: "", // we don't need it here anymore
      filename: `commercial-invoice-${reference}.pdf`,
      // `as const` toegevoegd t.o.v. v1: zonder annotatie verbreedt tsc het literal
      // naar string en faalt de toewijzing aan GeneratePaperlessInvoiceResult.
      contentType: "application/pdf" as const,
    },
    url: attachResult.url,
  };
} else {
   result = await provider.generateBlob({
    req,
    ctx: {
      fetch: options.fetchFn ?? fetch,
      cookieHeader: resolveCookieHeader(),
    },
    sessionkey,
    customerId: options.customerId,
    carrier,
    serviceDescription,
    filename: `commercial-invoice-${reference}.pdf`,
  });

}
  return {
    ...result,
    shipment: preparedShipment,
    validation,
  };
}

export function applyGeneratedPaperlessInvoiceToShipment(
  shipment: ShipmentTemplate,
  result: GeneratedInvoiceBlobResult,
): ShipmentTemplate {
  return {
    ...shipment,
    invoice: result.invoice,
    invoiceSource: "paperless",
  };
}
