// Geport uit v1 src/lib/wizard/headlessShip.ts. Wijzigingen:
// - PROXY-FIRST transport (geen authFetch/portaal-calls; alles via de geporte api-laag):
//     • getRates  → fetchRates (../api/ratesClient, POST /api/rates). v1's `{ result: [] }`
//       is nu een kale RateOption[]; naar Rating gemapt (price → string).
//     • chooseOption → ../api/chooseOption (retourneert { sessionKey, accessPoints?,
//       paperlessAvailable? } i.p.v. v1's dotted-path `result`); de store-patch is daarop
//       aangepast.
//     • submit → submitShipmentByType (../api/submitShipment, POST /api/book). De statische
//       fingerprintMatrix gaat als PARAMETER mee (provider.submit.fingerprintMatrix).
// - Generated steps/-imports → provider-laag (PARAMETER): fingerprintMatrix/widgetFieldsMatrix/
//   additionalFieldPolicies/submitShipmentValidators komen uit provider.submit.*;
//   validateShipperAddress/validateRecipientAddress/validatePackages uit provider.readiness;
//   persistentFieldValidators blijft (../validations/field-validators, al geport).
// - v1's engine-`advance()` (bouwde het shipment door de stap-handlers) vervalt: de runner
//   bouwt het shipment nu uit buildInitialShipment + automationApplier (buildFilledShipment)
//   en checkt confidence via clientPreflight (task: "pas automation rules toe, check
//   confidence"). Bij níet-confident geeft hij terug WAAR het onzeker werd: HeadlessResult
//   krijgt een additief `step?`-veld (de wizard-stap) naast `shipment` (de prefill).
// - HeadlessResult-contract (status "ok" | "needs_modal", + shipment/reason) behouden.
// - De client-side session-slot (rateQueue) blijft: serverside serialiseert de SessionPool
//   al, maar de mutex houdt de proxy vrij van parallelle dure rate-calls per widget.

import { writable, get, type Writable } from "svelte/store";
import type { Rating, ShipmentTemplate, ValidationResult } from "../types/config";
import type { EnrichedOrder } from "../types/webshop";
import type { WidgetProviderLayer } from "../providers/types";
import { applyAutomationRules, resolveRate } from "./automationApplier";
import { clientPreflight } from "./clientPreflight";
import { rateFetchStart, applyRateExclusions, shallowSnapshot } from "../api/rateFetcher";
import { acquireSessionSlot } from "./rateQueue";
import { fetchRates } from "../api/ratesClient";
import { chooseOption } from "../api/chooseOption";
import { submitShipmentByType } from "../api/submitShipment";
import { userPreferences } from "../state/userPreferences";
import { fingerprintPartsFromReusableData, enrichRatesWithFingerprintAvailabilityApi } from "../api/fingerprintDiscovery";
import { apiBaseUrl } from "../api/global";
import { isInEUCustomsTerritory, tffRouteCountry, canonicalShippingCountry } from "../utils/countries";
import { persistentFieldValidators } from "../validations/field-validators";

export type HeadlessResult =
  | { status: "ok"; result: any; shipment: ShipmentTemplate }
  | { status: "needs_modal"; shipment: ShipmentTemplate; reason: string; step?: string };

function buildInitialShipment(order: EnrichedOrder): ShipmentTemplate {
  return {
    carrier: "",
    source: order.orderPlatform?.toLowerCase() ?? "",
    packages: [],
    shipperAddress: {
      company: "",
      firstName: "",
      lastName: "",
      email: "",
      street: ["", ""],
      city: "",
      region: "",
      postalCode: "",
      country: "",
      phoneNumber: "",
    },
    recipientAddress: {
      company: order.shippingAddress?.company ?? "",
      firstName: order.shippingAddress?.firstName ?? "",
      lastName: order.shippingAddress?.lastName ?? "",
      email: order.shippingAddress?.email ?? "",
      street: Array.isArray(order.shippingAddress?.street)
        ? [...order.shippingAddress!.street, "", ""].slice(0, 2)
        : ["", ""],
      city: order.shippingAddress?.city ?? "",
      region: order.shippingAddress?.region ?? "",
      postalCode: order.shippingAddress?.postalCode ?? "",
      // FR overseas (97x/98x postcode) ships under its own ISO code at TFF
      country: canonicalShippingCountry(order.shippingAddress?.country, order.shippingAddress?.postalCode),
      phoneNumber: order.shippingAddress?.phoneNumber ?? "",
    },
    shipmentOptions: {
      invoiceRef: order.orderId,
      chosenRate: { carrier: "", service: "", price: "", reusableData: undefined },
      sessionKey: "",
      incotermsGroupD: "DAP",
      description: "",
      exportReason: "sale",
      shipmentOriginCountry: "NL",
      totalShipmentValue: 0,
      registrationNumberTypeShipper: "EOR",
      registrationNumberShipper: "",
      registrationNumberTypeRecipient: "EIN",
      registrationNumberRecipient: "",
      deliveryInstructions: "",
      truckShipmentInfo: {
        shipperForklift: false,
        shipperTaillift: false,
        recipientForklift: false,
        recipientTaillift: false,
      },
      insuranceValue: 0,
      signatureRequired: "none",
      carrierAccountNumber: {
        specifyCarrierAccountNumber: false,
        carrierAccountNumber: "",
        carrierAccountNumberCountry: "",
        carrierAccountNumberPostalCode: "",
      },
    },
    invoice: { filename: "", base64: "" },
    orderId: "",
  } as unknown as ShipmentTemplate;
}

/** Saved default sender template (mirror van clientPreflight): de headless boeking heeft
 *  een geldig afzenderadres nodig — clientPreflight vult dat óók uit de default template,
 *  dus een "ready"-verdict impliceert dat deze fill lukt. */
function defaultSenderTemplate(): any | null {
  const recall: any = userPreferences?.inputRecall?.shipperAddress;
  const templates: Record<string, any> = recall?.templates ?? {};
  const keys = Object.keys(templates);
  const defKey: string | undefined = (recall?.defaults ?? []).find((k: string) => !!templates[k]);
  if (defKey) return templates[defKey];
  if (keys.length === 1) return templates[keys[0]];
  return null;
}

/** Bouwt het te boeken shipment uit order + automation rules (vervangt v1's engine-advance):
 *  sender uit de default template, packages/products/shipmentOptions uit de matchende rules.
 *  Ook door de rate-picker in OrderOverview gebruikt (no_rule → partialTemplate). */
export function buildFilledShipment(order: EnrichedOrder): ShipmentTemplate {
  const rules = userPreferences?.automationRules ?? [];
  const packageTemplates = userPreferences?.packageTemplates ?? [];
  const s = buildInitialShipment(order);

  const tmpl = defaultSenderTemplate();
  if (tmpl) {
    const { templateId: _t, updatedAt: _u, ...addr } = tmpl;
    s.shipperAddress = { ...s.shipperAddress, ...addr } as any;
  }

  const { patch } = applyAutomationRules(rules, { shipment: s, order, packageTemplates });
  if (patch.packages?.length) s.packages = patch.packages as any;
  if (patch.products?.length) (s as any).products = patch.products;
  if (patch.shipmentOptions) s.shipmentOptions = { ...s.shipmentOptions, ...patch.shipmentOptions } as any;
  if (patch.paperlessInvoice) (s as any).paperlessInvoice = patch.paperlessInvoice;
  if (patch.invoiceSource) (s as any).invoiceSource = patch.invoiceSource;
  return s;
}

/** clientPreflight missingFields → de wizard-stap die geopend moet worden. */
function stepForMissing(missing?: string[]): string | undefined {
  if (!missing?.length) return undefined;
  const order = ["shipperAddress", "recipientAddress", "packages", "products", "chosenRate"];
  const map: Record<string, string> = {
    shipperAddress: "sender",
    recipientAddress: "receiver",
    packages: "packages",
    products: "products",
    chosenRate: "ship",
  };
  const first = order.find((k) => missing.includes(k));
  return first ? map[first] : undefined;
}

function resolvePackageType(packages: any[]): "pallet" | "package" | "document" {
  if (packages.some((p) => p.type === "pallet")) return "pallet";
  if (packages.some((p) => p.type === "package")) return "package";
  return "document";
}

function getFingerprintKey(rate: any, shipment: ShipmentTemplate): string {
  const { carrier, service } = fingerprintPartsFromReusableData(rate.reusableData ?? rate ?? {});
  const origin = tffRouteCountry(shipment.shipperAddress?.country, shipment.shipperAddress?.postalCode);
  const destination = tffRouteCountry(shipment.recipientAddress?.country, shipment.recipientAddress?.postalCode);
  const type = resolvePackageType(shipment.packages ?? []);
  return `${origin}_${destination}_${type}_${carrier}_${service}`;
}

function isRouteOutsideEU(shipment: ShipmentTemplate): boolean {
  const recipient = shipment.recipientAddress;
  const shipper = shipment.shipperAddress;
  const dest = recipient?.country?.toUpperCase() ?? "";
  const orig = shipper?.country?.toUpperCase() ?? "";
  return (
    (!!dest && !isInEUCustomsTerritory(dest, recipient?.postalCode)) ||
    (!!orig && !isInEUCustomsTerritory(orig, shipper?.postalCode))
  );
}

function getExtraFields(rate: any, shipment: ShipmentTemplate, provider: WidgetProviderLayer): string[] {
  const fingerprintMatrix = provider.submit?.fingerprintMatrix ?? {};
  const widgetFieldsMatrix = provider.submit?.widgetFieldsMatrix ?? {};
  const fieldPolicies = provider.submit?.additionalFieldPolicies ?? {};
  const fpKey = getFingerprintKey(rate, shipment);
  const fpId: string | undefined = (fingerprintMatrix as any)[fpKey] ?? rate.fingerprint;
  const baseFields: string[] = fpId ? ((widgetFieldsMatrix as any)[fpId] ?? []) : [];
  const allFields = new Set(baseFields);
  const outsideEU = isRouteOutsideEU(shipment);

  for (const [field, policy] of Object.entries(fieldPolicies as Record<string, any>)) {
    const condition = policy?.onlyShowIf;
    if (!condition) continue;
    if (condition === "isNonEUExportImport") {
      if (outsideEU) allFields.add(field);
      else allFields.delete(field);
    }
  }

  return [...allFields];
}

function isShipmentReadyToFetch(s: ShipmentTemplate, provider: WidgetProviderLayer): boolean {
  const validateShipperAddress = provider.readiness?.validateShipperAddress ?? (() => ({ valid: true } as ValidationResult));
  const validateRecipientAddress = provider.readiness?.validateRecipientAddress ?? (() => ({ valid: true } as ValidationResult));
  const validatePackages = provider.readiness?.validatePackages ?? (() => [] as ValidationResult[]);
  if (!s.packages?.length) return false;
  if (!validateShipperAddress(s.shipperAddress!).valid) return false;
  if (!validateRecipientAddress(s.recipientAddress!).valid) return false;
  if (validatePackages(s.packages).some((r) => !r.valid)) return false;
  return true;
}

// Best-effort declared value for the goods in a shipment, in descending preference:
//   1. sum of the resolved product values (set by automation rules / order enrichment)
//   2. sum of the order's line items (value × quantity)
//   3. the order grand total (last resort — may include shipping/tax, but a customs
//      declaration needs *some* positive value, and 0 is rejected)
function deriveShipmentValue(products: any[], order: EnrichedOrder): number {
  const round2 = (n: number) => Math.round(n * 100) / 100;

  const productSum = (products ?? []).reduce(
    (acc: number, p: any) => acc + (Number(p?.value) || 0),
    0,
  );
  if (productSum > 0) return round2(productSum);

  const itemSum = (order?.orderedItems ?? []).reduce(
    (acc: number, it: any) => acc + (Number(it?.value) || 0) * (Number(it?.quantity) || 1),
    0,
  );
  if (itemSum > 0) return round2(itemSum);

  return Number(order?.grandTotal) || 0;
}

// Circuit breaker for the proxy/carrier returning empty rate lists. Under sustained load
// (a big batch = many sequential rate fetches on one portal session) the rates session
// chokes and starts returning 0 rates almost instantly; once that happens it stays broken
// until it recovers. Rather than grind through the rest of the batch — each shipment burning
// a session slot + a doomed fetch — we trip a breaker after a few consecutive empty fetches
// and bail the remaining shipments fast with a clear reason. A non-empty fetch resets it;
// after a quiet period one "probe" is allowed through to detect recovery.
let consecutiveEmptyRateFetches = 0;
let lastEmptyRateFetchAt = 0;
const EMPTY_RATES_CIRCUIT_BREAK = 3;
const EMPTY_RATES_PROBE_AFTER_MS = 120_000;
const NO_RATES_REASON =
  "De vervoerder gaf geen tarieven terug — wacht een paar minuten en probeer opnieuw";

export async function headlessShip(
  order: EnrichedOrder,
  userId: string,
  provider: WidgetProviderLayer,
  options?: { initialShipment?: ShipmentTemplate; shipmentStore?: Writable<ShipmentTemplate> },
): Promise<HeadlessResult> {
  console.log("[headlessShip] ▶ START", { hasInitialShipment: !!options?.initialShipment });

  const rules = userPreferences?.automationRules ?? [];
  const packageTemplates = userPreferences?.packageTemplates ?? [];

  console.log("[headlessShip] rules:", rules.length, rules.map((r: any) => `${r.name ?? r.id}(enabled=${r.enabled})`));

  let advancedShipment: ShipmentTemplate;

  if (options?.initialShipment) {
    advancedShipment = options.initialShipment;
    console.log("[headlessShip] using initialShipment — skipping build", {
      packages: advancedShipment.packages?.length,
      shipperCountry: advancedShipment.shipperAddress?.country,
      recipientCountry: advancedShipment.recipientAddress?.country,
      hasRates: !!(advancedShipment as any).rates?.length,
      ratesHash: !!(advancedShipment as any).ratesHash,
    });
  } else {
    // v2: geen engine-advance meer — bouw het shipment uit order + automation rules en
    // check confidence met clientPreflight. Onzeker → terug WAAR (step + prefill).
    advancedShipment = buildFilledShipment(order);
    const pf = clientPreflight(order, provider);
    console.log("[headlessShip] clientPreflight:", pf.status, pf.reason ?? "");
    if (pf.status !== "ready") {
      const reason =
        pf.status === "no_rule"
          ? "No rate_selection action in automation rules"
          : pf.reason ?? "Shipment needs manual input";
      return { status: "needs_modal", shipment: advancedShipment, reason, step: stepForMissing(pf.missingFields) };
    }
  }

  // Gate: addresses + packages must be valid before fetching rates
  const shipperValidation = provider.readiness?.validateShipperAddress(advancedShipment.shipperAddress!) ?? { valid: true };
  const recipientValidation = provider.readiness?.validateRecipientAddress(advancedShipment.recipientAddress!) ?? { valid: true };
  console.log("[headlessShip] readiness check:", {
    packages: advancedShipment.packages?.length ?? 0,
    shipperValid: shipperValidation.valid,
    recipientValid: recipientValidation.valid,
  });

  if (!isShipmentReadyToFetch(advancedShipment, provider)) {
    const reason = "Shipment not ready: missing or invalid packages/addresses";
    console.log("[headlessShip] ✗ needs_modal —", reason);
    return { status: "needs_modal", shipment: advancedShipment, reason };
  }

  // Gate: at least one rate_selection rule must be configured
  const preCheck = applyAutomationRules(rules, { shipment: advancedShipment, order, packageTemplates });
  console.log("[headlessShip] preCheck rateSelection:", preCheck.rateSelection ?? null);
  if (!preCheck.rateSelection) {
    const reason = "No rate_selection action in automation rules";
    console.log("[headlessShip] ✗ needs_modal —", reason);
    return { status: "needs_modal", shipment: advancedShipment, reason, step: "ship" };
  }

  // Circuit breaker: the carrier/proxy has been returning empty rate lists — don't burn a
  // slot + a doomed fetch on every remaining shipment. After a quiet period, let one probe
  // through to see if it recovered.
  if (consecutiveEmptyRateFetches >= EMPTY_RATES_CIRCUIT_BREAK) {
    if (Date.now() - lastEmptyRateFetchAt > EMPTY_RATES_PROBE_AFTER_MS) {
      consecutiveEmptyRateFetches = EMPTY_RATES_CIRCUIT_BREAK - 1; // half-open: one probe
      console.log("[headlessShip] rate circuit breaker half-open — probing…");
    } else {
      console.log("[headlessShip] ✗ needs_modal — rate circuit breaker open:", NO_RATES_REASON);
      return { status: "needs_modal", shipment: advancedShipment, reason: NO_RATES_REASON };
    }
  }

  // Step 3: Acquire the session slot, then fetch rates inside it.
  //
  // Serverside houdt de SessionPool de in-progress zending vast; de client-side mutex
  // serialiseert de dure rate/choose/submit-keten per widget zodat parallelle calls elkaars
  // portaalsessie niet mid-write lezen. Any rates the caller pre-loaded (initialShipment)
  // are unsafe to submit against, so we always re-fetch inside the slot.
  const store = options?.shipmentStore ?? writable<ShipmentTemplate>(advancedShipment);
  const slotOrderId = order?.orderId ?? userId;
  let releaseSession: (() => void) | null = null;
  let rawRateCount = 0; // # of rates returned before exclusions / fingerprint enrichment

  {
    console.log("[headlessShip] acquiring session slot before rate fetch…");
    releaseSession = await acquireSessionSlot(slotOrderId);
    console.log("[headlessShip] session slot acquired — fetching rates inside slot…");

    rateFetchStart.set(performance.now());
    const t0 = Date.now();
    try {
      const incoming: Rating[] = (await fetchRates(advancedShipment)).map(
        (o) => ({ ...(o as Record<string, unknown>), price: String(o.price) } as unknown as Rating),
      );
      rawRateCount = incoming.length;
      if (incoming.length === 0) {
        consecutiveEmptyRateFetches++;
        lastEmptyRateFetchAt = Date.now();
        console.log(`[headlessShip] proxy returned 0 rates (consecutive empty: ${consecutiveEmptyRateFetches})`);
      } else {
        consecutiveEmptyRateFetches = 0;
      }
      const { kept, dropped } = applyRateExclusions(incoming, advancedShipment);
      if (dropped) console.log(`[headlessShip] excluded ${dropped} rate(s) by global config`);
      const hash = shallowSnapshot(advancedShipment);
      store.update((s) => ({ ...s, rates: kept, ratesHash: hash } as any));
      console.log(`[headlessShip] rates arrived after ${Date.now() - t0}ms — ${kept.length} kept`);
    } catch (err: any) {
      releaseSession();
      releaseSession = null;
      console.log("[headlessShip] ✗ needs_modal — rate fetch failed:", err.message);
      return { status: "needs_modal", shipment: get(store), reason: `getRates failed: ${err.message}`, step: "ship" };
    } finally {
      rateFetchStart.set(null);
    }
  }

  // Wrap every early-return + the chooseOption/submit critical section in one
  // try/finally so the slot (held since the rate fetch) is always released — even when
  // intermediate steps (enrichment, rule resolution, extra-field validation) bail
  // out to the modal.
  try {
  // Step 4: Enrich rates with fingerprint availability, then resolve target rate.
  // Rates without an approved fingerprint (e.g. DPD:Home for cross-border NL→IT) must be
  // excluded — submitShipmentByType cannot dispatch them and would throw "Unknown fingerprint".
  const shipmentWithRates = get(store);
  const rawRates = (shipmentWithRates as any).rates ?? [];

  let enrichedRates: any[] = rawRates;
  try {
    enrichedRates = await enrichRatesWithFingerprintAvailabilityApi({
      rates: rawRates,
      template: shipmentWithRates,
      // v2: statische matrix als parameter (provider.submit.fingerprintMatrix).
      staticMatrix: provider.submit?.fingerprintMatrix ?? {},
      apiBaseUrl,
      requestId: `headless-${userId}-${Date.now()}`,
      customerId: "demo",
      waitMs: 0,
    });
  } catch (err: any) {
    console.warn("[headlessShip] fingerprint enrichment failed, using all raw rates:", err.message);
  }

  const allRates = enrichedRates.filter((r: any) => r.fingerprintStatus === "approved");
  console.log(`[headlessShip] fingerprint enrichment: ${rawRates.length} total → ${allRates.length} approved`);

  if (!allRates.length) {
    // Distinguish "nothing came back" (transient/availability) from "rates came back but
    // none have a known form for this route".
    const reason =
      rawRateCount === 0
        ? NO_RATES_REASON
        : "Geen tarief met een bekend verzendformulier voor deze route";
    console.log("[headlessShip] ✗ needs_modal —", reason);
    return { status: "needs_modal", shipment: shipmentWithRates, reason, step: "ship" };
  }

  const { patch, rateSelection } = applyAutomationRules(rules, {
    shipment: { ...shipmentWithRates, rates: [] } as any,
    order,
    packageTemplates,
  });

  console.log("[headlessShip] rateSelection rule:", JSON.stringify(rateSelection));

  if (!rateSelection) {
    const reason = "No rate_selection rule matched";
    console.log("[headlessShip] ✗ needs_modal —", reason);
    return { status: "needs_modal", shipment: shipmentWithRates, reason, step: "ship" };
  }

  const targetRate = resolveRate(rateSelection, allRates);
  if (!targetRate) {
    console.log("[headlessShip] ✗ needs_modal — no rate matched. rateSelection:", JSON.stringify(rateSelection));
    return { status: "needs_modal", shipment: shipmentWithRates, reason: "No rate matched the configured selection rule", step: "ship" };
  }

  console.log("[headlessShip] ✓ target rate:", targetRate.reusableData?.choose_carrier, "/", targetRate.reusableData?.choose_service_name ?? targetRate.reusableData?.choose_service);

  // Apply patches, preserve packages
  const { packages: _patchPkgs, ...nonPackagePatch } = patch;
  store.update((s) => {
    const newOpts: any = {
      ...s.shipmentOptions,
      ...(nonPackagePatch.shipmentOptions ?? {}),
      chosenRate: targetRate,
    };
    // Customs routes require a declared shipment value; without one the submit (and
    // the modal fallback) fail on "Waarde is verplicht". Derive it when not already set.
    if (newOpts.totalShipmentValue == null || newOpts.totalShipmentValue <= 0) {
      const v = deriveShipmentValue(s.products ?? [], order);
      if (v > 0) newOpts.totalShipmentValue = v;
    }
    return { ...s, ...nonPackagePatch, packages: s.packages, shipmentOptions: newOpts };
  });

  const withRate = get(store);

  // Step 5: Check required extra fields
  const fingerprintMatrix = provider.submit?.fingerprintMatrix ?? {};
  const fpKey = getFingerprintKey(targetRate, withRate);
  const fpId: string | undefined = (fingerprintMatrix as any)[fpKey] ?? targetRate.fingerprint;
  const extraFields = getExtraFields(targetRate, withRate, provider);
  console.log("[headlessShip] fpKey:", fpKey, "| fpId:", fpId ?? "none", "| extraFields:", extraFields);

  {
    const fpValidators: Record<string, any> = fpId ? (provider.submit?.validatorsByForm?.[fpId] ?? {}) : {};
    const extraValidators: Record<string, any> = { ...persistentFieldValidators, ...fpValidators };
    const missingFields: string[] = [];
    const messages: string[] = [];

    const runOne = (fieldKey: string, validator: any) => {
      if (!validator?.dependsOn || !validator?.validate) return;
      try {
        const res = validator.validate(validator.dependsOn(withRate));
        if (res?.valid === false) {
          if (!missingFields.includes(fieldKey)) missingFields.push(fieldKey);
          const msg = String(res?.message ?? res?.reason ?? "").trim();
          if (msg && !messages.includes(msg)) messages.push(msg);
        }
      } catch {
        if (!missingFields.includes(fieldKey)) missingFields.push(fieldKey);
      }
    };

    // Conditional "extra" fields (customs docs, carrier account, …) — only when this route needs them.
    for (const fieldKey of extraFields) runOne(fieldKey, extraValidators[fieldKey]);
    // Every field rule the chosen form defines — catches form-specific limits (21-char
    // recipient contact name, country-specific postcode formats, …) BEFORE we POST the submit,
    // so a too-long name surfaces as needs_input instead of the portal half-creating a label.
    for (const [fieldKey, v] of Object.entries(fpValidators)) runOne(fieldKey, v);

    console.log(`[headlessShip] field validators (${Object.keys(fpValidators).length} fp + ${extraFields.length} extra checked): missing=${JSON.stringify(missingFields)}${messages.length ? ` (${messages.join("; ")})` : ""}`);
    if (missingFields.length > 0) {
      const reason = messages.length ? messages.join("; ") : `Rate requires manual input for: ${missingFields.join(", ")}`;
      console.log("[headlessShip] ✗ needs_modal —", reason);
      return { status: "needs_modal", shipment: withRate, reason, step: "ship" };
    }
    console.log("[headlessShip] ✓ all extra fields valid — continuing");
  }

  // Steps 6–8: chooseOption → extract sessionKey → submit. We already hold the session
  // slot (acquired before the rate fetch), so the whole fetch → choose → submit pipeline
  // runs as one atomic unit per shipment.
  if (!releaseSession) {
    console.log("[headlessShip] acquiring session slot (unexpected — slot not held)…");
    releaseSession = await acquireSessionSlot(slotOrderId);
  } else {
    console.log("[headlessShip] holding session slot since rate fetch");
  }

  // Step 6: chooseOption (v2 proxy → { sessionKey, accessPoints?, paperlessAvailable? })
  console.log("[headlessShip] calling chooseOption…");
  let chooseResult: any;
  try {
    chooseResult = await chooseOption(targetRate);
    console.log("[headlessShip] chooseOption result keys:", Object.keys(chooseResult ?? {}));
  } catch (err: any) {
    console.log("[headlessShip] ✗ needs_modal — chooseOption threw:", err.message);
    return { status: "needs_modal", shipment: withRate, reason: `chooseOption failed: ${err.message}`, step: "ship" };
  }

  store.update((s) => {
    const opts: any = {
      ...s.shipmentOptions,
      sessionKey: String(chooseResult?.sessionKey ?? "").trim(),
    };
    if (chooseResult?.accessPoints) {
      opts.chosenRate = { ...opts.chosenRate, accessPoints: chooseResult.accessPoints };
    }
    if (typeof chooseResult?.paperlessAvailable === "boolean") {
      opts.paperlessAvailable = chooseResult.paperlessAvailable;
    }
    return { ...s, shipmentOptions: opts };
  });

  // Step 7: Extract session key
  const afterChoose = get(store);
  const sessionkey = String((afterChoose.shipmentOptions as any)?.sessionKey ?? "").trim();
  console.log("[headlessShip] sessionKey:", sessionkey ? `"${sessionkey.slice(0, 8)}…"` : "(empty)");
  if (!sessionkey) {
    const reason = "No session key returned from chooseOption";
    console.log("[headlessShip] ✗ needs_modal —", reason);
    return { status: "needs_modal", shipment: afterChoose, reason, step: "ship" };
  }

  // Step 8: Submit
  console.log("[headlessShip] submitting shipment…");
  try {
    const result = await submitShipmentByType(store, {
      extCustomerId: userId,
      sessionkey,
      fingerprintMatrix: provider.submit?.fingerprintMatrix ?? {},
    });
    console.log("[headlessShip] ✓ submission ok");
    return { status: "ok", result, shipment: get(store) };
  } catch (err: any) {
    const msg = String(err?.message ?? err ?? "submission failed");
    // A VALIDATION_ERROR is the handler's own client-side check → nothing was posted yet.
    // Anything else means the POST went out and we don't know if a label was created —
    // warn the user to check with the carrier before re-trying, so they don't end up with two.
    const clientValidation = err?.code === "VALIDATION_ERROR";
    console.log("[headlessShip] ✗ needs_modal — submission threw:", msg, clientValidation ? "(client-side validation, nothing posted)" : "(post may have landed)");
    return {
      status: "needs_modal",
      shipment: get(store),
      step: "ship",
      reason: clientValidation
        ? `Submission failed: ${msg}`
        : `Verzenden mislukt — verzending mogelijk wel aangemaakt, controleer bij de vervoerder voordat je opnieuw probeert. (${msg})`,
    };
  }
  } finally {
    if (releaseSession) {
      releaseSession();
      releaseSession = null;
      console.log("[headlessShip] session slot released");
    }
  }
}
