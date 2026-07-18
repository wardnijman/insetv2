// Correctheids-util (gedeeld): heeft deze zending een douanestap nodig? = één van beide
// uiteinden buiten het EU-douanegebied. v1 heeft de volledige `isInEUCustomsTerritory`
// incl. bijzondere territoria per postcode (Canarische Eilanden, Ceuta, Åland, Helgoland…);
// die volledige tabel komt uit de fabriek-config. Hier de basis-EU-check voor de engine.

import type { Shipment } from "./types.ts";

const EU_CUSTOMS = new Set([
  "NL", "BE", "DE", "FR", "LU", "IT", "ES", "PT", "AT", "IE", "FI", "SE", "DK",
  "PL", "CZ", "SK", "HU", "RO", "BG", "HR", "SI", "EE", "LV", "LT", "GR", "CY", "MT",
]);

export function isEUCustoms(country?: string): boolean {
  return !!country && EU_CUSTOMS.has(country.toUpperCase());
}

export function needsCustoms(shipment: Shipment): boolean {
  // Als v1 (wizard/steps.ts): een nog ONBEKEND land telt niet als "buiten EU" —
  // de douanestap verschijnt pas zodra een ingevuld uiteinde er echt om vraagt.
  const orig = shipment.shipperAddress?.country;
  const dest = shipment.recipientAddress?.country;
  return (!!dest && !isEUCustoms(dest)) || (!!orig && !isEUCustoms(orig));
}
