// Geport uit v1 src/lib/api/submitShipment.ts. Wijzigingen:
// - PROXY-FIRST transport: v1 dispatcht hier de generated submitShipmentHandlers
//   (browser→TFF via authFetch) op fingerprint; nu POST `${apiBaseUrl}/api/book`
//   met { shipment, fingerprint, chosenRate }. De proxy retourneert vandaag
//   501 { error: "booking_not_wired", message } — dat wordt als nette Error
//   (message uit de body) doorgegeven. // TODO(fabriek-emit submit-transforms)
// - fingerprintMatrix komt NIET meer uit steps/fingerprintMatrix.json maar als
//   optionele PARAMETER (provider.submit.fingerprintMatrix); chosenRate.fingerprint
//   blijft — net als in v1 — voorgaan op de matrix-lookup.
// - finalizeShipment (tracking-/bevestigingsmails o.b.v. userPreferences.
//   trackingMailEnabled / labelConfirmationMailEnabled) VERVALT client-side:
//   mail-finalisatie hoort proxy-first serverside bij /api/book te gebeuren.
//   extCustomerId/sessionkey blijven in de signatuur (v1-oppervlak; nu ongebruikt).
//   // TODO(fabriek-emit submit-transforms): finalize/mail-voorkeuren serverside.
// - Publieke API (submitShipmentByType-signatuur + return-vorm
//   { carrier, service, origin, destination, ...result }) behouden.

import { get, type Writable } from "svelte/store";
import type { PackageTemplate, ShipmentTemplate } from "../types/config";
import { apiBaseUrl } from "./global";
import { tffRouteCountry } from "../utils/countries";

function resolvePackageType(
  packages: PackageTemplate[],
): "pallet" | "package" | "document" {
  if (packages.some((p) => p.type === "pallet")) return "pallet";
  if (packages.some((p) => p.type === "package")) return "package";
  return "document";
}

function normLabel(s: any): string {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

function fingerprintPartsFromReusableData(u: Record<string, any>) {
  const carrier = normLabel(u.choose_carrier ?? u.carrier ?? "");
  const service = normLabel(
    u.choose_service_name ??
      u.choose_servicename ??
      u.choose_service_display ??
      u.choose_service ??
      u.service ??
      "",
  );

  return { carrier, service };
}

export async function submitShipmentByType(
  shipment: Writable<ShipmentTemplate>,
  {
    extCustomerId,
    sessionkey,
    fingerprintMatrix = {},
    onSuccess = () => {},
    onHide = () => {},
  }: {
    extCustomerId: string | number;
    sessionkey: string | number;
    /** v2: statische matrix als parameter (provider.submit.fingerprintMatrix). */
    fingerprintMatrix?: Record<string, string>;
    onSuccess?: () => void;
    onHide?: () => void;
  },
): Promise<any> {
  const $s = get(shipment);

  const origin = tffRouteCountry($s.shipperAddress?.country, $s.shipperAddress?.postalCode);
  const destination = tffRouteCountry($s.recipientAddress?.country, $s.recipientAddress?.postalCode);
  const type = resolvePackageType($s.packages);

  const chosenRate = $s.shipmentOptions?.chosenRate;
  const reusableData =
    chosenRate?.reusableData && typeof chosenRate.reusableData === "object"
      ? chosenRate.reusableData
      : {};

  const { carrier, service } = fingerprintPartsFromReusableData(reusableData);

  if (!origin || !destination || !carrier || !service || !type) {
    throw new Error("Missing data");
  }

  const key = `${origin}_${destination}_${type}_${carrier}_${service}`;

  const fingerprint = chosenRate?.fingerprint ?? fingerprintMatrix[key];

  if (!fingerprint) {
    throw new Error(`Unknown fingerprint for key: ${key}`);
  }

  // Export/transit docs are optional; the (server-side) submit-transforms have a
  // required-input check (`input.customsDocuments == null`), so always pass at
  // least an empty array — v1-gedrag behouden.
  if ($s.customsDocuments == null) $s.customsDocuments = [];

  // PROXY-FIRST: het portaalpad (chooseOption + submitShipment-handler + finalize)
  // leeft serverside achter dit ene endpoint.
  const res = await fetch(`${apiBaseUrl}/api/book`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      shipment: $s,
      fingerprint,
      chosenRate,
    }),
  });

  const body: any = await res.json().catch(() => null);

  if (!res.ok) {
    // Vandaag: 501 { error: "booking_not_wired", message } — geef de message
    // als nette Error door. // TODO(fabriek-emit submit-transforms)
    throw new Error(
      body?.message ?? body?.error ?? `boeken faalde: ${res.status}`,
    );
  }

  const result = body ?? {};

  onSuccess();
  onHide();

  return {
    carrier,
    service,
    origin,
    destination,
    ...(result?.result ?? result),
  };
}
