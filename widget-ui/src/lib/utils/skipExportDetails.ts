// Geport uit v1 src/lib/utils/skipExportDetails.ts. Wijzigingen: geen.

import type { Writable } from "svelte/store";
import type { ShipmentTemplate, InvoiceSource } from "../types/config";
import { clearFieldValidityPrefix } from "../state/formValidation";

// The customs step (SkeletonContainer) offers two ways to supply the commercial
// invoice for a non-EU shipment, tracked on `shipment.invoiceSource`:
//   - "paperless"     → we generate the invoice from the product grid.
//   - "manual_upload" → upload your own invoice PDF.
//
// The product grid (line items) is shown in BOTH modes — line items are the customs
// declaration, not part of the invoice-source choice. Switching only swaps the invoice
// panel (generate vs upload), it never hides the grid. The attached invoice is reset on
// every switch so it is always mode-specific (a generated paperless PDF must not count as
// an uploaded one and vice-versa). On "manual_upload" we also drop any per-product validity
// entries so an empty grid doesn't block "Verder" — line items are optional there and
// become required only when the chosen rate needs them (ShipStepBlock disables those
// DHL line-item lanes until the grid is filled; TFF can't derive line items from a PDF).
export function setInvoiceMethod(
  shipment: Writable<ShipmentTemplate>,
  method: InvoiceSource,
) {
  shipment.update((s) => ({
    ...s,
    invoiceSource: method,
    invoice: { filename: "", base64: "", contentType: "" },
  }) as any);

  if (method === "manual_upload") clearFieldValidityPrefix("products");
}
