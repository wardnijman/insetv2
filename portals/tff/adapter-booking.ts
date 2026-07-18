// LIVE TFF booking adapter (WRITE PATH).
//
// Ties the three portal steps into one guarded booking capability:
//   getRates (read) -> chooseOption -> submitShipment111908712 (DPD Classic NL->NL).
//
// - transformSubmitInput111908712(): faithful port of the transform block in
//   plugship-client-app/.../steps/submitShipment111908712.ts (+ its D_..transforms).
// - bookDpdClassic(): the orchestrator. It calls assertBookable("tff", {carrier,service})
//   from src/runtime/capabilities.ts BEFORE issuing the submit, and again right before the
//   actual POST. Fail-closed: if the guard throws, NO submit is sent, so nothing books.

import { assertBookable } from "../../src/runtime/capabilities.ts";
import { chooseOption, submitShipment111908712, type SubmitResult, type ChooseResult } from "./tff-booking-transport.ts";

// ---------------------------------------------------------------------------
// transforms (verbatim port of D_submitShipment111908712_0.transforms.ts)
// ---------------------------------------------------------------------------
type Addr = {
  country: string; street: string[]; city: string; region?: string; postalCode: string;
  company?: string; firstName?: string; lastName?: string; phoneNumber?: string; email?: string;
  [k: string]: any;
};

const _1To1 = (v: any) => v;
const onlyAlphanumeric = (v: any) => String(v).replace(/[^\w]/g, "");
const _1To1OrDash = (v: any) => (!v || v === "" ? "-" : v);
const getFullName = (a: Addr) => `${a.firstName ?? ""} ${a.lastName ?? ""}`;
const getCompanyName = (a: Addr) => (a.company && a.company !== "" ? a.company : `${a.firstName ?? ""} ${a.lastName ?? ""}`);
const boolOnOrOff = (b: boolean) => (b ? "on" : "off");
const boxTruckOnOrOff = (v: string) => (v === "box truck" ? "on" : "off");
const signatureOnOrOff = (v: string) => (v === "none" ? "off" : "on");
const insuranceOnOrOff = (v: number) => (v && v > 0 ? "on" : "off");
const invoiceToStatus = (inv: any) => (inv?.base64 && inv?.filename && inv?.contentType ? "1" : "0");
const invoiceToBinary = (inv: any) => (!inv?.base64 || !inv?.filename || !inv?.contentType ? null : inv);
const aanwezigJaNee = (v?: string) => (v === "ja" ? "ja" : "nee");
const fileArrayToBinary = (docs: any) => docs;
const customsDocumentsToTransitFlag = (docs?: any[]) =>
  Array.isArray(docs) && docs.some((d) => d?.base64 && d?.filename && d?.contentType) ? "on" : "";

// US/CA maps only matter for US/CA lanes; NL->NL returns the "AL"/"QC" defaults.
const US_STATE_MAP: Record<string, string> = { Alabama: "AL", Alaska: "AK", Arizona: "AZ", California: "CA", Texas: "TX", "New York": "NY", Florida: "FL" };
const CA_PROVINCE_MAP: Record<string, string> = { Alberta: "AB", "British Columbia": "BC", Ontario: "ON", Quebec: "QC", "Québec": "QC" };
const getStateCode = (name: string) => US_STATE_MAP[String(name).trim()] ?? CA_PROVINCE_MAP[String(name).trim()] ?? "";

function recipientAddressToVsstates(a: Addr): string {
  if (a?.country !== "US") return "AL";
  const region = String(a.region ?? "").trim();
  if (region.length === 2) return region;
  return getStateCode(region) || region;
}
function recipientAddressToCanadastates(a: Addr): string {
  if (a?.country !== "CA") return "QC";
  const region = String(a.region ?? "").trim();
  if (region.length === 2) return region;
  return getStateCode(region) || "QC";
}
const companyToIsPrivate = (company?: string) => (company && company !== "" ? "on" : "");

/** Canonical shipment input -> the TFF submit field dict for fingerprint 111908712. */
export function transformSubmitInput111908712(input: any): Record<string, any> {
  const sa: Addr = input.shipperAddress;
  const ra: Addr = input.recipientAddress;
  const so = input.shipmentOptions;
  const t: Record<string, any> = {};

  t["plugtech_source"] = _1To1(input.source);
  t["vsstates2"] = recipientAddressToVsstates(ra);
  t["canadastates2"] = recipientAddressToCanadastates(ra);
  t["aanvullendeverzekering"] = insuranceOnOrOff(so.insuranceValue);
  t["invoice_uploaded_status"] = invoiceToStatus(input.invoice);
  t["file_invoice"] = invoiceToBinary(input.invoice);
  t["factuuraanwezig"] = aanwezigJaNee(so.factuurAanwezig);
  t["land"] = _1To1(sa.country);
  t["postcode"] = onlyAlphanumeric(sa.postalCode);
  t["huisnummer"] = _1To1OrDash(sa.street[1]);
  t["straat"] = _1To1(sa.street[0]);
  t["plaats"] = _1To1(sa.city);
  t["land2"] = _1To1(ra.country);
  t["postcode2"] = onlyAlphanumeric(ra.postalCode);
  t["huisnummer2"] = _1To1OrDash(ra.street[1]);
  t["straat2"] = _1To1(ra.street[0]);
  t["plaats2"] = _1To1(ra.city);
  t["contactpersoon2"] = getFullName(ra);
  t["telmob2"] = _1To1(ra.phoneNumber);
  t["email2"] = _1To1(ra.email);
  t["naam"] = getCompanyName(sa);
  t["landh"] = _1To1(sa.country);
  t["postcodeh"] = onlyAlphanumeric(sa.postalCode);
  t["contactpersoon"] = getFullName(sa);
  t["telmob"] = _1To1(sa.phoneNumber);
  t["email"] = _1To1(sa.email);
  t["isprivateaddress2"] = companyToIsPrivate(ra.company);
  t["naam2"] = getCompanyName(ra);
  t["land2h"] = _1To1(ra.country);
  t["postcode2h"] = onlyAlphanumeric(ra.postalCode);
  t["avvalue"] = _1To1(so.insuranceValue);
  t["laadklepLaden"] = boolOnOrOff(so.truckShipmentInfo.shipperTaillift);
  t["laadklepLossen"] = boolOnOrOff(so.truckShipmentInfo.recipientTaillift);
  t["bakwagenLaden"] = boxTruckOnOrOff(so.truckShipmentInfo.shipperVehicle);
  t["bakwagenLossen"] = boxTruckOnOrOff(so.truckShipmentInfo.recipientVehicle);
  t["requirePod"] = signatureOnOrOff(so.signatureRequired);
  t["landvanoorsprong"] = _1To1(so.shipmentOriginCountry);
  t["waardevangoederen"] = _1To1(so.totalShipmentValue);
  t["leveringscondities"] = _1To1(so.incotermsGroupD);
  t["goederenomschrijving"] = _1To1(so.description);
  t["factuurreferentie"] = _1To1(so.invoiceRef);
  t["upload_transit_docs"] = customsDocumentsToTransitFlag(input.customsDocuments);
  t["file_customs[]"] = fileArrayToBinary(input.customsDocuments);
  t["calc"] = _1To1(so.chosenRate.price);
  t["calc2"] = _1To1(so.chosenRate.price);
  return t;
}

// ---------------------------------------------------------------------------
// orchestrator (guarded)
// ---------------------------------------------------------------------------
export type ChosenRate = {
  carrier: string;
  service: string;
  price: string;
  reusableData: Record<string, any>;
};

export type BookOutcome = {
  guardPassed: boolean;
  choose: ChooseResult | null;
  submit: SubmitResult | null;
};

/**
 * Book one DPD Classic shipment on a warm, logged-in jar (getRates already done).
 * The guard is enforced twice: once up-front, and once immediately before the POST.
 * If dryRun is true we stop after chooseOption — no shipment is ever created.
 */
export async function bookDpdClassic(
  jarFetch: typeof globalThis.fetch,
  rate: ChosenRate,
  submitInput: any,
  opts: { dryRun?: boolean } = {},
): Promise<BookOutcome> {
  // GUARD #1 — fail closed before we touch the write path at all.
  assertBookable("tff", { carrier: rate.carrier, service: rate.service });

  const choose = await chooseOption(jarFetch, rate.reusableData);
  if (choose.loggedOut) return { guardPassed: true, choose, submit: null };

  if (opts.dryRun) return { guardPassed: true, choose, submit: null };

  const fields = transformSubmitInput111908712({
    ...submitInput,
    shipmentOptions: { ...submitInput.shipmentOptions, chosenRate: { price: rate.price } },
  });

  // GUARD #2 — defensive re-check on the exact carrier/service, right before the POST.
  assertBookable("tff", { carrier: rate.carrier, service: rate.service });

  const submit = await submitShipment111908712(jarFetch, fields);
  return { guardPassed: true, choose, submit };
}
