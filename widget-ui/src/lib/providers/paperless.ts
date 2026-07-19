// Paperless-factuur-provider (TFF) — proxy-first: buildRequest draait LOKAAL via de
// oracle-bewaakte mapper (src/widget/paperless-mapper.ts, zelfde bron als de server —
// import via relatief pad, naar het voorbeeld van registry's generated-import);
// generateAndAttach/generateBlob POSTen naar `${apiBaseUrl}/api/paperless/generate`.
// v1 praatte hier rechtstreeks met pdf.tffxpress.com + tffxpress-ajax (cookies in de
// browser); in v2 blijft die hele keten serverside achter de pool. ctx.cookieHeader
// is daarmee bewust ongebruikt.

import { apiBaseUrl } from "../api/global";
import type { PaperlessInvoiceProvider } from "../utils/paperlessInvoiceGenerator";
import {
  buildPaperlessInvoiceRequestFromShipment,
  type PaperlessShipmentLike,
  type ShipmentCreateRequest_WithPaperlessInvoice,
} from "../../../../src/widget/paperless-mapper.ts";

type GenerateResponse = {
  invoice?: { base64?: string; filename?: string; contentType?: string };
  url?: string;
  attached?: boolean;
  error?: string;
  message?: string;
};

async function postGenerate(
  fetchImpl: typeof globalThis.fetch,
  body: Record<string, unknown>,
): Promise<GenerateResponse> {
  const res = await fetchImpl(`${apiBaseUrl}/api/paperless/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as GenerateResponse;
  if (!res.ok) {
    throw new Error(data?.message || data?.error || `paperless/generate faalde (${res.status})`);
  }
  return data;
}

export const tffPaperlessInvoiceProvider: PaperlessInvoiceProvider<ShipmentCreateRequest_WithPaperlessInvoice> =
  {
    // v1: buildPaperlessInvoiceRequestFromShipment (utils/paperlessInvoiceMapper).
    buildRequest: (shipment, opts) =>
      buildPaperlessInvoiceRequestFromShipment(shipment as unknown as PaperlessShipmentLike, {
        includeRecipientNameInCompany: opts.includeRecipientNameInCompany,
      }),

    // v1: generateAndAttachPltInvoice — genereer PDF én zet 'm als PLT op de zending
    // in het portaal; de server doet beide stappen achter de pool.
    generateAndAttach: async ({ req, ctx, sessionkey, customerId, carrier, serviceDescription }) => {
      const data = await postGenerate(ctx.fetch ?? fetch, {
        req,
        sessionkey,
        customerId,
        carrier,
        serviceDescription,
        attach: true,
      });
      return { url: data.url ?? "" };
    },

    // v1: generatePltInvoiceBlob — alleen genereren; de aanroeper zet het resultaat op
    // shipment.invoice (contentType is LOAD-BEARING: transforms droppen 'm stil zonder).
    generateBlob: async ({ req, ctx, sessionkey, customerId, carrier, serviceDescription, filename }) => {
      const data = await postGenerate(ctx.fetch ?? fetch, {
        req,
        sessionkey,
        customerId,
        carrier,
        serviceDescription,
        filename,
        attach: false,
      });
      return {
        invoice: {
          base64: data.invoice?.base64 ?? "",
          filename: data.invoice?.filename ?? filename ?? "commercial-invoice.pdf",
          contentType: "application/pdf",
        },
        url: data.url,
      };
    },
  };
