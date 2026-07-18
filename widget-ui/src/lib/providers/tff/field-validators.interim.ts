// INTERIM veld-validators (alleen voor de dev-harness). De echte validators zijn
// fabriek-output: v1's steps/validations/tff (1,7MB gegenereerd) wordt per blueprint
// §5-stap-5 HERGEGENEREERD door de v2-fabriek, niet geport. Tot die fabriek-uitbreiding
// er is, dekken deze regels de basis (verplicht/vorm) zodat de geporte componenten
// end-to-end draaien. Semantiek bij regeneratie: B_getRates_0.validations.
//
// TFF-specifieke limieten die WEL al vaststaan (binair gezocht, zie memory):
// voor- + achternaam sámen max 30; die regel zit hier zodat de harness 'm toont.

import type { FieldValidator } from "../types";
import type { ValidationResult } from "../../types/config";

const ok: ValidationResult = { valid: true, message: "" };
const fail = (message: string): ValidationResult => ({ valid: false, message });

const NAME_TOTAL_MAX = 30;

function required(label: string): (v: unknown) => ValidationResult {
  return (v) => (typeof v === "string" && v.trim().length > 0 ? ok : fail(`${label} is verplicht`));
}

function field(path: string, check: (v: unknown, t?: any) => ValidationResult): FieldValidator {
  return {
    dependsOn: (template) => ({ value: path.split(".").reduce((o, k) => o?.[k], template), template }),
    validate: ({ value, template }: { value: unknown; template: any }) => check(value, template),
  };
}

// Aggregaat (v1: validateShipperAddress/validateRecipientAddress uit de generated
// laag) — gebruikt door PasteAddressBox na een paste-parse; eerste falende check wint.
function validateAddressAggregate(a: any): ValidationResult {
  if (!a) return fail("Adres ontbreekt");
  const checks: Array<[string, boolean]> = [
    ["Land is verplicht", !!a.country?.trim?.()],
    ["Straat is verplicht", !!(Array.isArray(a.street) && a.street[0]?.trim())],
    ["Postcode is verplicht", !!a.postalCode?.trim?.()],
    ["Plaats is verplicht", !!a.city?.trim?.()],
    ["Voornaam is verplicht", !!a.firstName?.trim?.()],
    ["Achternaam is verplicht", !!a.lastName?.trim?.()],
    ["Telefoonnummer is verplicht", !!a.phoneNumber?.trim?.()],
  ];
  for (const [msg, pass] of checks) if (!pass) return fail(msg);
  const total = (a.firstName ?? "").trim().length + (a.lastName ?? "").trim().length;
  if (total > NAME_TOTAL_MAX) return fail(`Voor- en achternaam samen max. ${NAME_TOTAL_MAX} tekens`);
  return ok;
}

function addressValidators(prefix: "shipperAddress" | "recipientAddress"): Record<string, FieldValidator> {
  return {
    [prefix]: {
      dependsOn: (template) => ({ value: template?.[prefix], template }),
      validate: ({ value }: { value: any }) => validateAddressAggregate(value),
    },
    [`${prefix}_firstName`]: field(`${prefix}.firstName`, (v, t) => {
      const req = required("Voornaam")(v);
      if (!req.valid) return req;
      const total = `${v}`.trim().length + (t?.[prefix]?.lastName ?? "").trim().length;
      return total <= NAME_TOTAL_MAX ? ok : fail(`Voor- en achternaam samen max. ${NAME_TOTAL_MAX} tekens`);
    }),
    [`${prefix}_lastName`]: field(`${prefix}.lastName`, (v, t) => {
      const req = required("Achternaam")(v);
      if (!req.valid) return req;
      const total = `${v}`.trim().length + (t?.[prefix]?.firstName ?? "").trim().length;
      return total <= NAME_TOTAL_MAX ? ok : fail(`Voor- en achternaam samen max. ${NAME_TOTAL_MAX} tekens`);
    }),
    [`${prefix}_country`]: field(`${prefix}.country`, required("Land")),
    [`${prefix}_street_0_`]: field(`${prefix}.street`, (v) => {
      const s = Array.isArray(v) ? v[0] : "";
      return typeof s === "string" && s.trim().length > 0 ? ok : fail("Straat is verplicht");
    }),
    [`${prefix}_street_1_`]: field(`${prefix}.street`, () => ok), // toevoeging is optioneel
    [`${prefix}_postalCode`]: field(`${prefix}.postalCode`, required("Postcode")),
    [`${prefix}_city`]: field(`${prefix}.city`, required("Plaats")),
    [`${prefix}_region`]: field(`${prefix}.region`, () => ok),
    [`${prefix}_phoneNumber`]: field(`${prefix}.phoneNumber`, required("Telefoonnummer")),
    [`${prefix}_email`]: field(`${prefix}.email`, (v) => {
      if (typeof v !== "string" || v.trim() === "") return fail("E-mailadres is verplicht");
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? ok : fail("Ongeldig e-mailadres");
    }),
    [`${prefix}_company`]: field(`${prefix}.company`, () => ok),
  };
}

// INTERIM pakket-rij-validators (v1: generated validatePackageLength/Width/Height/Weight).
// Documenten hebben geen afmetingen/gewicht nodig (v1: canSave behandelt document als
// compleet zonder dims); anders positief verplicht. Echte TFF-limieten komen bij de
// fabriek-regeneratie.
function dim(label: string, key: "length" | "width" | "height" | "weight") {
  return (row: { type: string } & Record<string, unknown>): ValidationResult => {
    if (row.type === "document") return ok;
    const n = Number(row[key]);
    return Number.isFinite(n) && n > 0 ? ok : fail(`${label} moet groter dan 0 zijn`);
  };
}

export const interimPackageValidators = {
  length: dim("Lengte", "length"),
  width: dim("Breedte", "width"),
  height: dim("Hoogte", "height"),
  weight: dim("Gewicht", "weight"),
};

export const interimFieldValidators: Record<string, FieldValidator> = {
  ...addressValidators("shipperAddress"),
  ...addressValidators("recipientAddress"),
  // Bedrijfsnaam ontvanger: verplicht zodra het veld zichtbaar is (zakelijke ontvanger,
  // v1-gedrag); bij particulier is het veld unmounted en valt de check weg.
  recipientAddress_company: field("recipientAddress.company", required("Bedrijfsnaam")),
};
