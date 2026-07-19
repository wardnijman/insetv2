// Geport uit v1 src/lib/wizard/automationCompleteness.ts. Wijzigingen: geen (puur, geen transport).

import type {
  AutomationRule,
  AutomationMatcher,
  AutomationAction,
  RateSelectionRule,
  RateSelectionFallbackCandidate,
} from "../types/config";

export type IncompleteReason = string;

const isNonEmptyString = (v: unknown): v is string =>
  typeof v === "string" && v.trim() !== "";

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

const isBool = (v: unknown): v is boolean => typeof v === "boolean";

export function isMatcherComplete(matcher: AutomationMatcher | any): boolean {
  if (!matcher || typeof matcher !== "object") return false;

  // Special pseudo-matcher used by the applier for "match everything".
  if (matcher.fromType === "always") return true;

  switch (matcher.fromType) {
    case "shipper":
    case "receiver":
      return isNonEmptyString(matcher.field) && isNonEmptyString(matcher.value);

    case "shipment": {
      if (!isNonEmptyString(matcher.field)) return false;
      switch (matcher.field) {
        case "hasInvoice":
          return isBool(matcher.value);
        case "source":
        case "invoiceSource":
          return isNonEmptyString(matcher.value);
        default:
          return false;
      }
    }

    case "product": {
      // New conditions-array format: matcher.field === "conditions" with a list.
      if (matcher.field === "conditions") {
        const conditions: any[] = Array.isArray(matcher.conditions) ? matcher.conditions : [];
        if (conditions.length === 0) return false;
        return conditions.every(isProductConditionComplete);
      }
      // Legacy single-field product matcher.
      switch (matcher.field) {
        case "product":
          return (
            isNonEmptyString(matcher.sku) ||
            isNonEmptyString(matcher.name) ||
            isNonEmptyString(matcher.providerProductId)
          );
        case "category":
          return isNonEmptyString(matcher.categoryKey);
        case "sku":
        case "name":
          return isNonEmptyString(matcher.value);
        default:
          return false;
      }
    }

    case "product_group": {
      const subs: any[] = Array.isArray(matcher.value) ? matcher.value : [];
      return subs.length > 0 && subs.every(isMatcherComplete);
    }
  }

  return false;
}

function isProductConditionComplete(c: any): boolean {
  if (!c || typeof c !== "object") return false;
  switch (c.type) {
    case "all_products":
      return true;
    case "exact":
      return (
        isNonEmptyString(c.sku) ||
        isNonEmptyString(c.name) ||
        isNonEmptyString(c.providerProductId)
      );
    case "category":
      return isNonEmptyString(c.categoryKey);
    case "sku_wildcard":
    case "name_wildcard":
      return isNonEmptyString(c.pattern);
    default:
      return false;
  }
}

export function isActionComplete(action: AutomationAction | any): boolean {
  if (!action || typeof action !== "object") return false;
  if (!isNonEmptyString(action.toType) || !isNonEmptyString(action.applyLevel)) return false;

  switch (action.toType) {
    case "default_packages":
      return Array.isArray(action.value) && action.value.length > 0 &&
        action.value.every(isNonEmptyString);

    case "product_hs_code":
    case "product_origin_country":
    case "product_description":
    case "export_reason":
    case "shipment_origin_country":
    case "description":
    case "delivery_instructions":
    case "customs_broker_email":
    case "registration_number_type_shipper":
    case "registration_number_shipper":
    case "registration_number_type_recipient":
    case "registration_number_recipient":
    case "recipient_eori":
    case "recipient_vat":
    case "invoice_ref":
    case "invoice_source":
    case "incoterm":
    case "signature_required":
    case "factuur_aanwezig":
      return isNonEmptyString(action.value);

    case "product_value":
      return action.value != null && isFiniteNumber(action.value.amount);

    case "product_weight":
    case "total_shipment_value":
    case "insurance_value":
      return isFiniteNumber(action.value);

    case "call_before_delivery":
      return isBool(action.value);

    case "rate_selection":
      return isRateSelectionComplete(action.value);

    case "paperless_invoice_field":
      return (
        action.value != null &&
        isNonEmptyString(action.value.field) &&
        action.value.fieldValue !== undefined &&
        action.value.fieldValue !== null
      );

    case "paperless_invoice_statement_flag":
      return (
        action.value != null &&
        isNonEmptyString(action.value.field) &&
        isBool(action.value.fieldValue)
      );
  }

  return false;
}

function isRateSelectionComplete(rule: RateSelectionRule | any): boolean {
  if (!rule || typeof rule !== "object") return false;
  switch (rule.mode) {
    case "cheapest":
    case "fastest":
      return true;
    case "cheapest_in_subset":
    case "fastest_in_subset":
      return Array.isArray(rule.allowedFingerprints) && rule.allowedFingerprints.length > 0;
    case "specific":
      return (
        isNonEmptyString(rule.carrier) ||
        isNonEmptyString(rule.service) ||
        isNonEmptyString(rule.fingerprintKey)
      );
    case "fallback_chain":
      return (
        Array.isArray(rule.candidates) &&
        rule.candidates.length > 0 &&
        rule.candidates.every(isFallbackCandidateComplete)
      );
    default:
      return false;
  }
}

function isFallbackCandidateComplete(cand: RateSelectionFallbackCandidate | any): boolean {
  if (!cand || typeof cand !== "object" || !cand.pick) return false;
  const pick = cand.pick;
  switch (pick.mode) {
    case "specific":
      return (
        isNonEmptyString(pick.carrier) ||
        isNonEmptyString(pick.service) ||
        isNonEmptyString(pick.fingerprintKey)
      );
    case "cheapest_in_subset":
    case "fastest_in_subset":
      return Array.isArray(pick.allowedFingerprints) && pick.allowedFingerprints.length > 0;
    default:
      return false;
  }
}

export type RuleCompleteness = {
  complete: boolean;
  reasons: IncompleteReason[];
  incompleteMatcherIndexes: number[];
  incompleteActionIndexes: number[];
};

/**
 * Returns whether a rule will actually fire, plus a structured breakdown of what's
 * missing. The applier uses `complete` to filter; the UI uses the rest to explain
 * to the user why a rule is inactive.
 */
export function evaluateRuleCompleteness(rule: AutomationRule | any): RuleCompleteness {
  const reasons: IncompleteReason[] = [];
  const incompleteMatcherIndexes: number[] = [];
  const incompleteActionIndexes: number[] = [];

  if (!rule || typeof rule !== "object") {
    return { complete: false, reasons: ["invalid_rule"], incompleteMatcherIndexes, incompleteActionIndexes };
  }

  const matchers: any[] = Array.isArray(rule.matchers) ? rule.matchers : [];
  const actions: any[] = Array.isArray(rule.actions) ? rule.actions : [];

  if (matchers.length === 0) reasons.push("no_matchers");
  if (actions.length === 0) reasons.push("no_actions");

  matchers.forEach((m, i) => {
    if (!isMatcherComplete(m)) {
      incompleteMatcherIndexes.push(i);
    }
  });
  actions.forEach((a, i) => {
    if (!isActionComplete(a)) {
      incompleteActionIndexes.push(i);
    }
  });

  if (incompleteMatcherIndexes.length) reasons.push("incomplete_matchers");
  if (incompleteActionIndexes.length) reasons.push("incomplete_actions");

  return {
    complete: reasons.length === 0,
    reasons,
    incompleteMatcherIndexes,
    incompleteActionIndexes,
  };
}

export function isRuleComplete(rule: AutomationRule | any): boolean {
  return evaluateRuleCompleteness(rule).complete;
}
