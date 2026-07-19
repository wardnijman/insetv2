// Geport uit v1 src/lib/state/shipDraft.ts. Wijzigingen: WizardStepId wordt hier
// gedefinieerd (en door shipEdits geïmporteerd) — v1 haalde 'm uit wizard/types.ts,
// maar v2's stap-typen leven in src/widget/engine; de string-union is identiek.
// localStorage-toegang zit al achter typeof-guards (SSR-veilig).
//
// NB (interim): de v2-WizardShell schrijft/leest drafts nog niet (draft-persistentie
// is daar TODO(order-flow)); OrderOverview's restore-pad is bedraad maar blijft inert
// tot de shell gaat spiegelen.

import type { ShipmentTemplate } from "../types/config";
import type { EnrichedOrder } from "../types/webshop";

export type WizardStepId = "sender" | "receiver" | "packages" | "products" | "ship";

const VERSION = 1;
const key = (userId: string) => `plugtech:shipDraft:v${VERSION}:${userId}`;

// Drafts older than this are dropped on load — a days-old wizard popping open unasked is
// worse than losing it (the order / portal form state has likely moved on by then).
const MAX_AGE_MS = 48 * 60 * 60 * 1000;

/** One interrupted wizard session. A draft in storage means the page was refreshed or
 *  closed while the ship wizard was open — every normal exit (cancel, submit, queue
 *  hand-off) clears it via the modal's onDestroy. OrderOverview restores it at boot. */
export type ShipDraft = {
  /** Snapshot of the order the wizard was opened with — NOT re-resolved from the orders
   *  list on restore, because ship-together sessions run on a synthetic merged order that
   *  only ever existed in memory. */
  order: EnrichedOrder;
  shipment: ShipmentTemplate;
  stepId: WizardStepId;
  forceManual: boolean;
  redoAllSteps: boolean;
  savedAt: number;
};

/** Same stripping as OrderOverview's sanitizeForModal, plus rates/ratesHash: rates are
 *  bound to the portal session that fetched them, so a restored draft must re-fetch.
 *  A blank chosenRate.reusableData also makes the engine stop at the ship step instead
 *  of treating it as done. Shared with shipEdits.ts (per-order saved edits). */
export function sanitizeShipment(shipment: ShipmentTemplate): ShipmentTemplate {
  const s: any = { ...shipment };
  delete s.rates;
  delete s.ratesHash;
  s.shipmentOptions = {
    ...s.shipmentOptions,
    chosenRate: { carrier: "", service: "", price: "", reusableData: undefined },
    sessionKey: "",
    __chooseOptionLoading: false,
    __chooseOptionError: "",
  };
  return s as ShipmentTemplate;
}

export function saveShipDraft(
  userId: string,
  draft: Omit<ShipDraft, "savedAt">,
): void {
  if (typeof localStorage === "undefined") return;
  const payload: ShipDraft = {
    ...draft,
    shipment: sanitizeShipment(draft.shipment),
    savedAt: Date.now(),
  };
  try {
    localStorage.setItem(key(userId), JSON.stringify(payload));
  } catch {
    // Quota — almost always a big base64 invoice/customs upload. Retry without the file
    // blobs: losing an upload on refresh beats losing the whole draft.
    try {
      const slim: ShipDraft = {
        ...payload,
        shipment: {
          ...payload.shipment,
          invoice: { filename: "", base64: "" },
          customsDocuments: undefined,
          paperlessInvoice: undefined,
        },
      };
      localStorage.setItem(key(userId), JSON.stringify(slim));
    } catch {}
  }
}

export function loadShipDraft(userId: string): ShipDraft | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(key(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ShipDraft;
    if (!parsed?.order?.orderId || !parsed?.shipment) return null;
    if (typeof parsed.savedAt !== "number" || Date.now() - parsed.savedAt > MAX_AGE_MS) {
      localStorage.removeItem(key(userId));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearShipDraft(userId: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(key(userId));
  } catch {}
}
