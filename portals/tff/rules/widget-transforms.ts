// Widget-submit-TRANSFORMS (fabriek-BRON, per portaal): de primitieven waarmee de
// submit/choose-payloads gebouwd worden, gekeyed op de kebab-namen uit de fieldmap-
// descriptoren (submit-base.json / choose-option.json). Geport uit v1's HANDGESCHREVEN
// D_submitShipmentbase_0.transforms.ts + C_chooseOption_0.transforms.ts — semantiek
// verbatim, incl. quirks (spaceToPlus vervangt alleen de EERSTE spatie; canadastates
// valt terug op "QC"; vsstates op "AL"). Bewaakt door de payload-oracle
// (verify-widget-payloads): v1's echte steps met capture-fetch vs onze builders.

// getStateCode + kaarten verbatim uit v1 utils/countries.ts (US state-fix: volledige
// staatsnaam -> 2-lettercode, anders weigert UPS de boeking).
const US_STATE_MAP: Record<string, string> = {
  "Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR", "California": "CA",
  "Colorado": "CO", "Connecticut": "CT", "Delaware": "DE", "District of Columbia": "DC",
  "Florida": "FL", "Georgia": "GA", "Hawaii": "HI", "Idaho": "ID", "Illinois": "IL",
  "Indiana": "IN", "Iowa": "IA", "Kansas": "KS", "Kentucky": "KY", "Louisiana": "LA",
  "Maine": "ME", "Maryland": "MD", "Massachusetts": "MA", "Michigan": "MI", "Minnesota": "MN",
  "Mississippi": "MS", "Missouri": "MO", "Montana": "MT", "Nebraska": "NE", "Nevada": "NV",
  "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY",
  "North Carolina": "NC", "North Dakota": "ND", "Ohio": "OH", "Oklahoma": "OK", "Oregon": "OR",
  "Pennsylvania": "PA", "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD",
  "Tennessee": "TN", "Texas": "TX", "Utah": "UT", "Vermont": "VT", "Virginia": "VA",
  "Washington": "WA", "West Virginia": "WV", "Wisconsin": "WI", "Wyoming": "WY",
};
const CA_PROVINCE_MAP: Record<string, string> = {
  "Alberta": "AB", "British Columbia": "BC", "Manitoba": "MB",
  "New Brunswick": "NB", "Newfoundland and Labrador": "NL", "Northwest Territories": "NT",
  "Nova Scotia": "NS", "Nunavut": "NU", "Ontario": "ON", "Prince Edward Island": "PE",
  "Quebec": "QC", "Québec": "QC", "Saskatchewan": "SK", "Yukon": "YT",
};
function getStateCode(stateName: string): string {
  const s = stateName.trim();
  return US_STATE_MAP[s] ?? CA_PROVINCE_MAP[s] ?? "";
}

type Fn = (v: any) => unknown;

export const widgetTransforms: Record<string, Fn> = {
  "1-to-1": (v) => v,
  "only-alphanumeric": (v: string) => v.replace(/[^\w]/g, ""),
  "1-to-1-or-dash": (v: string) => (!v || v === "" ? "-" : v),
  "get-full-name": (a) => a.firstName + " " + a.lastName,
  "get-company-name": (a) => (a.company && a.company !== "" ? a.company : a.firstName + " " + a.lastName),
  "bool-on-or-off": (v: boolean) => (v ? "on" : "off"),
  "box-truck-on-or-off": (v) => (v === "box truck" ? "on" : "off"),
  "signature-on-or-off": (v) => (v === "none" ? "off" : "on"),
  "insurance-on-or-off": (v: number) => (v && v > 0 ? "on" : "off"),
  "map-signature-type": (v) =>
    v === "direct" ? "DIRECT" : v === "no_preference" ? "DIRECT" : v === "adult" ? "ADULT" : v === "none" ? "DIRECT" : "DIRECT",
  "map-export-reason": (v: string) => {
    if (v === "sale") return "COMMERCIAL_PURPOSE_OR_SALE";
    if (v === "return") return "RETURN_TO_ORIGIN_COMMERCIAL";
    if (v === "repair_return") return "RETURN_AFTER_REPAIR";
    if (v === "personal") return "PERSONAL_BELONGINGS_OR_PERSONAL_USE";
    if (v === "sample") return "SAMPLE";
    if (v === "gift") return "GIFT";
    throw new Error("Unkown export reason type");
  },
  "invoice-to-status": (invoice) => (invoice.base64 && invoice.filename && invoice.contentType ? "1" : "0"),
  "invoice-to-binary": (invoice) => (!invoice?.base64 || !invoice.filename || !invoice.contentType ? null : invoice),
  "aanwezig-ja-nee": (v?: string) => (v === "ja" ? "ja" : "nee"),
  "file-array-to-binary": (invoices) => invoices,
  "customs-documents-to-transit-flag": (documents) => {
    const hasDoc = Array.isArray(documents) && documents.some((d: any) => d?.base64 && d?.filename && d?.contentType);
    return hasDoc ? "on" : "";
  },
  "product-to-hscode": (products: any[]) => products.map((p) => p.hsCode ?? ""),
  "product-to-quantity": (products: any[]) =>
    products.map((product) => {
      if (!product.packageAssignments || product.packageAssignments.length === 0) return 1;
      return product.packageAssignments.reduce((total: number, assignment: any) => {
        const perSku = assignment[product.sku];
        if (!perSku) return total;
        return total + (Object.values(perSku) as number[]).reduce((sum, qty) => sum + qty, 0);
      }, 0);
    }),
  "product-to-unit-of-measurement": (products: any[]) => products.map(() => "PCS"),
  "product-to-netweight": (products: any[]) => products.map((p) => p.weight),
  "product-to-grossweight": (products: any[]) => products.map((p) => p.weight),
  "product-to-unit-price": (products: any[]) => products.map((p) => p.value),
  "product-to-manufacturing-country-code": (products: any[]) => products.map((p) => p.originCountry ?? ""),
  "product-to-item-description": (products: any[]) => products.map((p) => p.name ?? p.sku),
  "if-us-do-us-region-to-two-state-code-else-AL": (region) => {
    const r = String(region ?? "").trim();
    if (r.length === 2) return r;
    return getStateCode(r) || r;
  },
  "recipient-address-to-vsstates": (a) => {
    if (a?.country !== "US") return "AL";
    const region = String(a.region ?? "").trim();
    if (region.length === 2) return region;
    return getStateCode(region) || region;
  },
  "recipient-address-to-canadastates": (a) => {
    if (a?.country !== "CA") return "QC";
    const region = String(a.region ?? "").trim();
    if (region.length === 2) return region;
    return getStateCode(region) || "QC";
  },
  "company-to-is-private": (company: string) => (company && company !== "" ? "on" : ""),
  "recipient-to-is-private-individual": (a) => {
    if (typeof a.isPrivateIndividual === "boolean") return a.isPrivateIndividual ? "on" : "";
    if (a.company && a.company.trim() !== "") return "";
    return "on";
  },
  "carrier-object-to-on-or-nothing": (c) => (c.specifyCarrierAccountNumber ? "on" : ""),
  "carrier-object-to-account-number": (c) => (c.specifyCarrierAccountNumber ? c.carrierAccountNumber : ""),
  "carrier-object-to-country-code": (c) => (c.specifyCarrierAccountNumber ? c.carrierAccountNumberCountry : ""),
  "carrier-object-to-postal-code": (c) => (c.specifyCarrierAccountNumber ? c.carrierAccountNumberPostalCode : ""),
  "access-points-to-chosen-id": (aps) => (aps ? aps.find((p: any) => p.chosen)?.id : ""),
  "access-points-to-name": (aps) => (aps ? aps.find((p: any) => p.chosen)?.name : ""),
  "access-points-to-address": (aps) => (aps ? aps.find((p: any) => p.chosen)?.address : ""),
  "access-points-to-city": (aps) => (aps ? aps.find((p: any) => p.chosen)?.city : ""),
  "access-points-to-postal-code": (aps) => (aps ? aps.find((p: any) => p.chosen)?.postalCode : ""),
  "access-points-to-country": (aps) => (aps ? aps.find((p: any) => p.chosen)?.country : ""),
  // v1-quirk: .replace(" ", "+") vervangt alleen de EERSTE spatie.
  "space_to_plus": (v: string) => v.replace(" ", "+"),
};
