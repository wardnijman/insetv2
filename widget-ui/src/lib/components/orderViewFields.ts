// Geport uit v1 src/lib/components/orderViewFields.ts. Wijzigingen: geen.
// Kolomdefinities van de order-overview (labels + default-zichtbaarheid + rijlayout).

export type OrderFieldKey =
  | "platform"
  | "customer"
  | "orderNumber"
  | "date"
  | "country"
  | "total"
  | "carrier"
  | "status"
  | "company";

export const FIELD_LABEL: Record<OrderFieldKey, string> = {
  platform: "Platform",
  customer: "Klant",
  orderNumber: "Ordernummer",
  date: "Datum",
  country: "Land",
  total: "Totaal",
  carrier: "Vervoerder",
  status: "Status",
  company: "Bedrijf"
};

export const DEFAULT_VISIBLE: Record<OrderFieldKey, boolean> = {
  platform: true,
  customer: true,
  orderNumber: true,
  date: true,
  country: true,
  total: false,
  carrier: false,
  status: true,
  company: false,
};

/** Logical, fixed layout for the order row */
export const ORDER_ROW_LAYOUT = {
  firstLine: ["company", "customer", "orderNumber", "status"] as OrderFieldKey[],
  secondLine: ["date", "country", "total", "carrier"] as OrderFieldKey[],
};
