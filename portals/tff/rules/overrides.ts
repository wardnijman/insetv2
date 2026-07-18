// TFF-EIGEN primitieven. Dit is de escape-hatch (R2.5/O9): hand-logica die
// regeneratie overleeft omdat ze hier leeft en bij naam wordt aangeroepen —
// nooit in gegenereerde code. Generieke primitieven staan in src/primitives.

import type { Primitive } from "../../../src/primitives/index.ts";

// TFF-specifieke landcodes (fragment). Let op: US -> "USA", DE -> "DU".
const TFF_COUNTRY: Record<string, string> = {
  NL: "NL", US: "USA", DE: "DU", GB: "GB", HK: "HK", AE: "AE",
};

// Landen waar TFF géén postcode-formaat afdwingt ("geen"-reconciliatie,
// zie project-geheugen postalcode_geen_reconciliation).
const GEEN: ReadonlySet<string> = new Set(["AE", "HK"]);

export const overrides: Record<string, Primitive> = {
  isoToTffCountry: (v) =>
    TFF_COUNTRY[String(v).toUpperCase()] ?? String(v).toUpperCase(),

  // Postcode: als het land een "geen"-land is -> altijd "geen"; anders getrimd.
  postcodeOrGeen: (v, countryIso) =>
    GEEN.has(String(countryIso).toUpperCase()) ? "geen" : String(v ?? "").trim(),
};
