// Geport uit v1 src/lib/wizard/automationApplier.ts. Wijzigingen:
// - ongebruikte type-import ProductTemplate weggelaten;
// - verder verbatim (pure regels-engine, geen transport). LET OP fail-soft:
//   resolveRate/inAllowedSubset lezen rate.reusableData.choose_* — de proxy-rates
//   leveren die (nog) niet, dus specifieke/subset-selectie resolvet dan gewoon
//   naar "geen match" (zie TODO(proxy-rates-verrijking) in api/rateFetcher.ts).

import type {
  AutomationRule,
  AutomationMatcher,
  AutomationAction,
  ShipmentTemplate,
  PackageTemplate,
  PaperlessInvoiceFields,
  Rating,
  RateSelectionRule,
  RateSelectionFallbackCandidate,
  RateSelectionFallbackCondition,
  Incoterm,
} from "../types/config";
import type { EnrichedOrder, WebshopOrderedItem } from "../types/webshop";
import { countryInRegion, isRegionKey } from "../utils/regionGroups";
import { isRuleComplete } from "./automationCompleteness";

export type ApplierContext = {
  shipment: ShipmentTemplate;
  order: EnrichedOrder;
  packageTemplates: PackageTemplate[];
};

export type ApplierResult = {
  /** Merged shipment patch from all matching rules */
  patch: Partial<ShipmentTemplate>;
  /** Rate selection rule, if any matched rule specified one */
  rateSelection: RateSelectionRule | null;
};

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Evaluates all automation rules against the current context and returns
 * a merged patch + the winning rate-selection rule (if any).
 * Rules are applied in priority order (lower = first); stopProcessing halts the chain.
 */
export function applyAutomationRules(
  rules: AutomationRule[],
  ctx: ApplierContext,
): ApplierResult {
  // `applyAutomationRules` runs on every reactive readiness check — for every visible row,
  // every store update. The per-rule / per-evaluation logs that used to live here flooded
  // the console with hundreds of identical lines. Flip DEBUG to true when actually
  // debugging rule evaluation; keep it off for steady-state runs.
  const DEBUG = false;

  // Skip rules that won't fire correctly: disabled, no matchers, no actions, or any
  // matcher/action with missing values. Without this guard an empty `matchers` array
  // combined with `matchMode: "all"` would match every shipment (because `[].every`
  // is true), and a half-filled matcher could throw inside `textEq` on an undefined
  // value — taking the whole order overview down with it.
  const sorted = [...rules]
    .filter((r) => r.enabled && isRuleComplete(r))
    .sort((a, b) => a.priority - b.priority);

  if (DEBUG) console.debug("[automator] evaluating", sorted.length, "enabled rule(s), rates available:", ctx.shipment.rates?.length ?? 0);

  let mergedPatch: Partial<ShipmentTemplate> = {};
  let rateSelection: RateSelectionRule | null = null;

  for (const rule of sorted) {
    const matched = ruleMatches(rule, ctx);
    if (DEBUG) console.debug(`[automator] rule "${rule.name}" (priority ${rule.priority}): ${matched ? "✅ matched" : "❌ no match"}`);
    if (!matched) continue;

    const { patch, rateSelection: rs } = buildPatch(rule.actions, ctx);
    mergedPatch = deepMergePatch(mergedPatch, patch, ctx.shipment);
    if (rs && !rateSelection) {
      rateSelection = rs;
      if (DEBUG) console.debug("[automator] rate selection rule found:", JSON.stringify(rs));
    }

    if (rule.stopProcessing) break;
  }

  // If a rate-selection rule exists and rates are already loaded, resolve it now
  if (rateSelection) {
    if (DEBUG) console.debug("[automator] rate selection:", JSON.stringify(rateSelection), "| rates loaded:", ctx.shipment.rates?.length ?? 0);
    if (ctx.shipment.rates?.length) {
      const resolved = resolveRate(rateSelection, ctx.shipment.rates);
      if (DEBUG) console.debug("[automator] resolved rate:", resolved ? `${resolved.reusableData?.choose_carrier} / ${resolved.reusableData?.choose_service_name ?? resolved.reusableData?.choose_service}` : "none");
      if (resolved) {
        // v2: `as any` toegevoegd — target-tsconfig is strict; spread van een optionele
        // ShipmentOptions maakt signatureRequired mogelijk-undefined (zelfde patroon
        // als de bestaande cast in buildPatch).
        mergedPatch.shipmentOptions = {
          ...ctx.shipment.shipmentOptions,
          ...mergedPatch.shipmentOptions,
          chosenRate: resolved,
          sessionKey: (resolved.reusableData?.srk ?? "") as "",
        } as any;
      }
    }
  }

  return { patch: mergedPatch, rateSelection };
}

// ── Matcher evaluation ─────────────────────────────────────────────────────

function ruleMatches(rule: AutomationRule, ctx: ApplierContext): boolean {
  return rule.matchMode === "all"
    ? rule.matchers.every((m) => matcherPasses(m, ctx))
    : rule.matchers.some((m) => matcherPasses(m, ctx));
}

function matcherPasses(matcher: AutomationMatcher, ctx: ApplierContext): boolean {
  const { shipment, order } = ctx;

  if ((matcher as any).fromType === "always") return true;

  switch (matcher.fromType) {
    case "shipper": {
      const addr = shipment.shipperAddress;
      if (!addr) return false;
      switch (matcher.field) {
        case "company":    return textEq(addr.company, matcher.value);
        case "country":    return textEq(addr.country, matcher.value);
        case "region":     return matchRegion(addr.country, matcher.value);
        case "postalCode": return matcher.operator === "wildcard"
          ? wildcardMatch(addr.postalCode, matcher.value)
          : textEq(addr.postalCode, matcher.value);
      }
      break;
    }

    case "receiver": {
      const addr = shipment.recipientAddress;
      if (!addr) return false;
      switch (matcher.field) {
        case "receiverProfile":
          // Profile label isn't stored on the address at runtime — always false
          return false;
        case "country":    return textEq(addr.country, matcher.value);
        case "region":     return matchRegion(addr.country, matcher.value);
        case "postalCode": return matcher.operator === "wildcard"
          ? wildcardMatch(addr.postalCode, matcher.value)
          : textEq(addr.postalCode, matcher.value);
      }
      break;
    }

    case "shipment": {
      switch (matcher.field) {
        case "source":       return textEq(shipment.source, matcher.value);
        case "hasInvoice":   return !!(shipment.invoice?.base64 || shipment.invoice?.filename) === matcher.value;
        case "invoiceSource": return shipment.invoiceSource === matcher.value;
      }
      break;
    }

    case "product": {
      // New conditions-array format (editor stores field: "conditions")
      if ((matcher as any).field === "conditions") {
        const conditions: any[] = (matcher as any).conditions ?? [];
        const matchMode: "all" | "any" = (matcher as any).matchMode ?? "all";
        if (conditions.length === 0) return true;
        const results = conditions.map((c: any) => evaluateProductCondition(c, order));
        return matchMode === "all" ? results.every(Boolean) : results.some(Boolean);
      }
      return (order?.orderedItems ?? []).some((item) => productItemMatches(matcher, item));
    }

    case "product_group":
      // Every sub-matcher must match at least one order item
      return matcher.value.every((sub) =>
        (order?.orderedItems ?? []).some((item) => productItemMatches(sub, item)),
      );
  }

  return false;
}

function evaluateProductCondition(cond: any, order: ApplierContext["order"]): boolean {
  switch (cond.type) {
    case "all_products":
      return (order?.orderedItems ?? []).length > 0;
    case "exact":
      return (order?.orderedItems ?? []).some((item) =>
        (cond.sku && textEq(item.sku, cond.sku)) ||
        (cond.name && textEq(item.name, cond.name)) ||
        (cond.providerProductId && textEq(item.sku, cond.providerProductId)),
      );
    case "category":
      return false;
    case "sku_wildcard":
      return (order?.orderedItems ?? []).some((item) => wildcardMatch(item.sku, cond.pattern ?? ""));
    case "name_wildcard":
      return (order?.orderedItems ?? []).some((item) => wildcardMatch(item.name, cond.pattern ?? ""));
    default:
      return false;
  }
}

function productItemMatches(
  matcher: Extract<AutomationMatcher, { fromType: "product" }>,
  item: WebshopOrderedItem,
): boolean {
  switch (matcher.field) {
    case "product":
      return !!(
        (matcher.sku && textEq(item.sku, matcher.sku)) ||
        (matcher.name && textEq(item.name, matcher.name)) ||
        (matcher.providerProductId && textEq(item.sku, matcher.providerProductId))
      );
    case "category":
      // WebshopOrderedItem has no categoryKey — not matchable at runtime
      return false;
    case "sku":
      return wildcardMatch(item.sku, matcher.value);
    case "name":
      return wildcardMatch(item.name, matcher.value);
  }
}

// ── Action → patch ─────────────────────────────────────────────────────────

function buildPatch(
  actions: AutomationAction[],
  ctx: ApplierContext,
): { patch: Partial<ShipmentTemplate>; rateSelection: RateSelectionRule | null } {
  const patch: Partial<ShipmentTemplate> = {};
  const optsPatch: Record<string, any> = {};
  const paperlessPatch: Partial<PaperlessInvoiceFields> = {};
  let invoiceSourceExplicitlySet = false;
  let rateSelection: RateSelectionRule | null = null;

  const allProductsActions = actions.filter((a) => a.applyLevel === "all_products");
  if (allProductsActions.length > 0) {
    // Use existing shipment products if present, otherwise seed from order items
    const baseProducts: any[] = ctx.shipment.products?.length
      ? ctx.shipment.products
      : (ctx.order?.orderedItems ?? []).map((item) => ({
          sku: item.sku ?? "",
          name: item.name ?? "",
          description: item.description ?? item.name ?? "",
          quantity: item.quantity ?? 1,
          weight: parseFloat(item.weight as any) || 0,
          value: item.value ?? 0,
          currency: item.currency ?? "EUR",
          hsCode: item.hsCode,
          originCountry: item.originCountry,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }));

    if (baseProducts.length) {
      patch.products = baseProducts.map((product) => {
        let p = { ...product };
        for (const action of allProductsActions) {
          switch (action.toType) {
            case "product_hs_code":        p = { ...p, hsCode: action.value }; break;
            case "product_weight":         p = { ...p, weight: action.value }; break;
            case "product_origin_country": p = { ...p, originCountry: action.value }; break;
            case "product_description":    p = { ...p, description: action.value }; break;
            case "product_value":          p = { ...p, value: action.value.amount, currency: action.value.currency ?? "EUR" }; break;
          }
        }
        return p;
      });
    }
  }

  for (const action of actions) {
    // matched_product/matched_products actions are handled separately when the products step runs
    if (action.applyLevel !== "shipment") continue;

    switch (action.toType) {
      case "description":                        optsPatch.description = action.value; break;
      case "export_reason":                      optsPatch.exportReason = action.value; break;
      case "total_shipment_value":               optsPatch.totalShipmentValue = action.value; break;
      case "shipment_origin_country":            optsPatch.shipmentOriginCountry = action.value; break;
      case "incoterm":                           applyIncoterm(optsPatch, action.value); break;
      case "delivery_instructions":              optsPatch.deliveryInstructions = action.value; break;
      case "call_before_delivery":               optsPatch.callBeforeDelivery = action.value; break;
      case "signature_required":                 optsPatch.signatureRequired = action.value; break;
      case "insurance_value":                    optsPatch.insuranceValue = action.value; break;
      case "customs_broker_email":               optsPatch.customsBrokerEmail = action.value; break;
      case "registration_number_type_shipper":   optsPatch.registrationNumberTypeShipper = action.value; break;
      case "registration_number_shipper":        optsPatch.registrationNumberShipper = action.value; break;
      case "registration_number_type_recipient": optsPatch.registrationNumberTypeRecipient = action.value; break;
      case "registration_number_recipient":      optsPatch.registrationNumberRecipient = action.value; break;
      case "recipient_eori":                     optsPatch.recipientEORI = action.value; break;
      case "recipient_vat":                      optsPatch.recipientVAT = action.value; break;
      case "invoice_ref":                        optsPatch.invoiceRef = action.value; break;
      case "factuur_aanwezig":                   optsPatch.factuurAanwezig = action.value; break;
      case "rate_selection":                     rateSelection = action.value; break;
      case "invoice_source":
        patch.invoiceSource = action.value;
        invoiceSourceExplicitlySet = true;
        break;

      case "default_packages": {
        // The LAST default_packages action wins. Assign unconditionally so an unresolved
        // last action doesn't silently fall back to an earlier one. Empty `resolved` means
        // the configured templateIds aren't in packageTemplates — warn so it's debuggable
        // (most common cause: stale userPreferences after adding a template — reload widget).
        const resolved = resolvePackageTemplates(action.value, ctx.packageTemplates);
        const missing = (action.value ?? []).filter((id: string) =>
          !ctx.packageTemplates.some((t) => t.templateId === id),
        );
        if (missing.length) {
          console.warn(
            `[automator] default_packages: ${missing.length} templateId(s) not found — Missing:`,
            missing,
          );
        }
        patch.packages = resolved;
        break;
      }

      case "paperless_invoice_field":
        (paperlessPatch as any)[action.value.field] = action.value.fieldValue;
        break;

      case "paperless_invoice_statement_flag":
        paperlessPatch.invoiceStatement = {
          ...paperlessPatch.invoiceStatement,
          [action.value.field]: action.value.fieldValue,
        };
        break;
    }
  }

  if (Object.keys(optsPatch).length) {
    patch.shipmentOptions = { ...ctx.shipment.shipmentOptions, ...optsPatch } as any;
  }
  if (Object.keys(paperlessPatch).length) {
    patch.paperlessInvoice = { ...ctx.shipment.paperlessInvoice, ...paperlessPatch };
    // Configuring paperless field actions implies the paperless invoice should be used.
    // Skip if an explicit invoice_source action set it already.
    if (!invoiceSourceExplicitlySet && patch.invoiceSource === undefined) {
      patch.invoiceSource = "paperless";
    }
  }

  return { patch, rateSelection };
}

// ── Rate resolution ────────────────────────────────────────────────────────

export function resolveRate(rule: RateSelectionRule, rates: Rating[]): Rating | null {
  if (!rates.length) return null;

  switch (rule.mode) {
    case "cheapest":
      return rates.reduce((best, r) => price(r) < price(best) ? r : best);

    case "fastest":
      return rates.reduce((best, r) => transitDays(r) < transitDays(best) ? r : best);

    case "cheapest_in_subset": {
      const sub = rates.filter((r) => inAllowedSubset(r, rule.allowedFingerprints));
      return sub.length ? sub.reduce((best, r) => price(r) < price(best) ? r : best) : null;
    }

    case "fastest_in_subset": {
      const sub = rates.filter((r) => inAllowedSubset(r, rule.allowedFingerprints));
      return sub.length ? sub.reduce((best, r) => transitDays(r) < transitDays(best) ? r : best) : null;
    }

    case "specific":
      return findSpecificRate(rates, rule);

    case "fallback_chain": {
      // Walk candidates top-to-bottom; first one to resolve (passing Mits) wins.
      for (const cand of rule.candidates ?? []) {
        const picked = resolveFallbackCandidate(cand, rates);
        if (picked) return picked;
      }
      return null;
    }
  }
}

export function resolveFallbackCandidate(
  candidate: RateSelectionFallbackCandidate,
  rates: Rating[],
): Rating | null {
  const conditions = candidate.conditions ?? [];
  const { pick } = candidate;

  if (pick.mode === "specific") {
    const match = findSpecificRate(rates, pick);
    if (!match) return null;
    return conditionsMatchRate(conditions, match) ? match : null;
  }

  // Subset picks: pre-filter the subset, then pick cheapest/fastest of survivors.
  const sub = rates
    .filter((r) => inAllowedSubset(r, pick.allowedFingerprints))
    .filter((r) => conditionsMatchRate(conditions, r));
  if (!sub.length) return null;

  if (pick.mode === "cheapest_in_subset") {
    return sub.reduce((best, r) => price(r) < price(best) ? r : best);
  }
  return sub.reduce((best, r) => transitDays(r) < transitDays(best) ? r : best);
}

function findSpecificRate(
  rates: Rating[],
  pick: { carrier?: string; service?: string; fingerprintKey?: string },
): Rating | null {
  return rates.find((r) => {
    const rd = r.reusableData ?? {};
    return (
      (!pick.carrier || textEq(rd.choose_carrier, pick.carrier)) &&
      (!pick.service || textEq(rd.choose_service_name ?? rd.choose_service, pick.service)) &&
      (!pick.fingerprintKey || r.fingerprintKey === pick.fingerprintKey)
    );
  }) ?? null;
}

function conditionsMatchRate(
  conditions: RateSelectionFallbackCondition[],
  rate: Rating,
): boolean {
  for (const c of conditions) {
    if (c.type === "available") continue;
    if (c.type === "transit_days") {
      const td = transitDays(rate);
      if (!Number.isFinite(td)) return false;
      if (c.op === "lte" && !(td <= c.value)) return false;
      if (c.op === "gte" && !(td >= c.value)) return false;
      if (c.op === "eq" && !(td === c.value)) return false;
    } else if (c.type === "price") {
      const p = price(rate);
      if (!Number.isFinite(p)) return false;
      if (c.op === "lte" && !(p <= c.value)) return false;
      if (c.op === "gte" && !(p >= c.value)) return false;
    }
  }
  return true;
}

function price(r: Rating): number {
  return parseFloat(r.price) || Infinity;
}

function transitDays(r: Rating): number {
  return parseFloat(r.transitTime ?? "") || Infinity;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function resolvePackageTemplates(ids: string[], templates: PackageTemplate[]): PackageTemplate[] {
  return ids.map((id) => templates.find((t) => t.templateId === id)).filter(Boolean) as PackageTemplate[];
}

const GROUP_B = new Set(["FCA", "FAS", "FOB"]);
const GROUP_C = new Set(["CFR", "CIF", "CPT", "CIP"]);

function applyIncoterm(opts: Record<string, any>, value: Incoterm) {
  opts.incotermsGroupB = GROUP_B.has(value) ? value : undefined;
  opts.incotermsGroupC = GROUP_C.has(value) ? value : undefined;
  opts.incotermsGroupD = (!GROUP_B.has(value) && !GROUP_C.has(value)) ? value : undefined;
}

/**
 * Checks whether a rate is in the allowed subset.
 * Stored fingerprints use "CARRIER:service" format (e.g. "DHL:Economy select"),
 * matched against reusableData.choose_carrier + choose_service_name|choose_service.
 */
function inAllowedSubset(r: Rating, allowedFingerprints: string[]): boolean {
  const rd = r.reusableData ?? {};
  const carrier = rd.choose_carrier ?? "";
  const service = rd.choose_service_name ?? rd.choose_service ?? "";
  const key = `${carrier}:${service}`;
  return allowedFingerprints.some((fp) => textEq(fp, key));
}

function matchRegion(country: string | undefined | null, regionValue: string): boolean {
  if (!isRegionKey(regionValue)) return false;
  return countryInRegion(country, regionValue);
}

function textEq(a: string | undefined | null, b: string): boolean {
  return (a ?? "").trim().toLowerCase() === b.trim().toLowerCase();
}

function wildcardMatch(value: string, pattern: string): boolean {
  const re = new RegExp(
    "^" +
    pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".") +
    "$",
    "i",
  );
  return re.test(value ?? "");
}

/** Merge two patches; later patch's shipmentOptions/paperlessInvoice win field-by-field */
function deepMergePatch(
  base: Partial<ShipmentTemplate>,
  next: Partial<ShipmentTemplate>,
  current: ShipmentTemplate,
): Partial<ShipmentTemplate> {
  const merged = { ...base, ...next };

  if (base.shipmentOptions || next.shipmentOptions) {
    merged.shipmentOptions = {
      ...current.shipmentOptions,
      ...base.shipmentOptions,
      ...next.shipmentOptions,
    } as any;
  }
  if (base.paperlessInvoice || next.paperlessInvoice) {
    merged.paperlessInvoice = {
      ...current.paperlessInvoice,
      ...base.paperlessInvoice,
      ...next.paperlessInvoice,
    };
  }

  return merged;
}
