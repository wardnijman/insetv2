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

function addressValidators(prefix: "shipperAddress" | "recipientAddress"): Record<string, FieldValidator> {
  return {
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

export const interimFieldValidators: Record<string, FieldValidator> = {
  ...addressValidators("shipperAddress"),
  ...addressValidators("recipientAddress"),
};
