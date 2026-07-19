// Geport uit v1 src/lib/utils/laneRequirements.ts. Wijzigingen: geen.

// Lane-requirement helpers shared by ShipStepBlock (wizard ship step) and RateChoiceModal
// (queue picker). A rate whose submit form wants per-product line items ("products" in
// widgetFieldsMatrix) or a commercial-invoice slot ("invoice") stays SELECTABLE while those
// are missing — the user may want to inspect the options (access points, pickup dates, price)
// before completing the customs step — but SUBMIT is gated on these checks.

/** Line items are "ready" when every product carries the fields a line-item lane needs
 *  (HS code, description, origin country, a positive value and weight). Mirrors the
 *  customs-step grid validators, so a generated-invoice shipment (grid required) is always
 *  ready, and an own-upload shipment is ready only if the user also filled the grid. */
export function productsHaveLineItems(s: any): boolean {
  const products = (s?.products ?? []) as any[];
  if (!products.length) return false;
  return products.every(
    (p) =>
      String(p?.hsCode ?? "").trim() !== "" &&
      String(p?.description ?? "").trim() !== "" &&
      String(p?.originCountry ?? "").trim() !== "" &&
      Number(p?.value) > 0 &&
      Number(p?.weight) > 0,
  );
}

/** Commercial-invoice readiness. "Ready" = a PDF is attached (generated in the customs step
 *  or user-uploaded). In the queue picker (queueMode) the worker generates the paperless
 *  invoice itself right before submit (runHeadlessShipment step 8c), so
 *  invoiceSource="paperless" with filled product lines counts as ready there too — blocking
 *  that would break the existing headless/queue flow. */
export function invoiceReadyFor(s: any, queueMode: boolean): boolean {
  return (
    !!(s?.invoice?.base64 || s?.invoice?.filename) ||
    (queueMode &&
      s?.invoiceSource === "paperless" &&
      ((s?.products?.length ?? 0) > 0))
  );
}
