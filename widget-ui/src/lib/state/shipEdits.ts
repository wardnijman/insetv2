// Geport uit v1 src/lib/state/shipEdits.ts. Wijzigingen: WizardStepId komt uit
// shipDraft.ts (zie toelichting daar). localStorage-toegang zit al achter
// typeof-guards, incl. pruneShipEdits (SSR-veilig; wordt vanuit onMount aangeroepen).
//
// Invariant (memory "stateful ship edits"): elke ship-hand-off wist de edits, zodat
// edits altijd nieuwer zijn dan bounce-partials. Sinds de headless-flow-slice spiegelt
// de WizardShell zijn shipment hierheen (behalve ship-together, shipTogetherCount-marker)
// en wist OrderOverview de edits bij elke schone hand-off — de invariant klopt.

import type { ShipmentTemplate } from "../types/config";
import { sanitizeShipment, type WizardStepId } from "./shipDraft";

// Per-order wizard edits that survive a DELIBERATE close (Annuleren / Esc), unlike shipDraft
// which only covers a page death and is cleared on every programmatic unmount. The wizard
// mirrors its shipment + step here continuously; OrderOverview prefills the wizard from it
// the next time the same order is opened. Cleared when the order ships (success callback,
// queue hand-off) and guarded on restore against orders that got a label in the meantime.

const VERSION = 1;
const keyPrefix = (userId: string) => `plugtech:shipEdits:v${VERSION}:${userId}:`;
const key = (userId: string, orderId: string) => `${keyPrefix(userId)}${orderId}`;

// Same horizon as shipDraft: after 48h the order / portal form state has likely moved on, and
// resurrecting week-old half-edits is more confusing than starting fresh.
const MAX_AGE_MS = 48 * 60 * 60 * 1000;

export type ShipEdits = {
  shipment: ShipmentTemplate;
  stepId: WizardStepId;
  savedAt: number;
};

export function saveShipEdits(
  userId: string,
  orderId: string,
  edits: Omit<ShipEdits, "savedAt">,
): void {
  if (typeof localStorage === "undefined") return;
  const payload: ShipEdits = {
    ...edits,
    shipment: sanitizeShipment(edits.shipment),
    savedAt: Date.now(),
  };
  try {
    localStorage.setItem(key(userId, orderId), JSON.stringify(payload));
  } catch {
    // Quota — almost always a big base64 invoice/customs upload. Retry without the file
    // blobs: losing an upload beats losing every other edit.
    try {
      const slim: ShipEdits = {
        ...payload,
        shipment: {
          ...payload.shipment,
          invoice: { filename: "", base64: "" },
          customsDocuments: undefined,
          paperlessInvoice: undefined,
        } as ShipmentTemplate,
      };
      localStorage.setItem(key(userId, orderId), JSON.stringify(slim));
    } catch {}
  }
}

export function loadShipEdits(userId: string, orderId: string): ShipEdits | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(key(userId, orderId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ShipEdits;
    if (!parsed?.shipment) return null;
    if (typeof parsed.savedAt !== "number" || Date.now() - parsed.savedAt > MAX_AGE_MS) {
      localStorage.removeItem(key(userId, orderId));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearShipEdits(userId: string, orderId: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(key(userId, orderId));
  } catch {}
}

/** Drop expired entries so canceled-and-forgotten orders don't pile up in localStorage.
 *  Called once at widget boot. */
export function pruneShipEdits(userId: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    const prefix = keyPrefix(userId);
    const stale: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(prefix)) continue;
      try {
        const parsed = JSON.parse(localStorage.getItem(k) ?? "");
        if (typeof parsed?.savedAt !== "number" || Date.now() - parsed.savedAt > MAX_AGE_MS) {
          stale.push(k);
        }
      } catch {
        stale.push(k);
      }
    }
    for (const k of stale) localStorage.removeItem(k);
  } catch {}
}
