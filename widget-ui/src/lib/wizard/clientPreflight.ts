// Geport uit v1 src/lib/wizard/clientPreflight.ts. Wijzigingen:
// - Generated validators → provider-laag (PARAMETER i.p.v. hardgekoppelde
//   steps/validations-imports): validateShipperAddress/validateRecipientAddress/
//   validatePackages komen uit provider.readiness (fabriek-emit widgetLayer.fns), en
//   validateProducts uit provider.gridValidators (widgetLayer.gridFns — de ene strikte
//   product-line-laag; v1's hand-gepinde D_submitShipment-444177803_0.validations-plek).
//   De signatuur krijgt daarom een `provider`-param.
// - Verder verbatim: pure, no-network "kan de headless worker dit order schoon
//   auto-shippen?"-check. Zelfde verdicts (ready/no_rule/needs_input/error), zelfde
//   volgorde (sender→receiver→packages→products→rate-selectie), zelfde REASON_SEP.
// - Geen transport: userPreferences (module-singleton) en automationApplier zijn 1-op-1.
//
// Mirrors de server-side headless preflight: sender (fill from saved default template),
// receiver (must validate), packages (auto-fill via een default_packages-rule), products
// (non-EU only, must be rule-filled), dan "is er een rate-selection rule?" → ready vs
// no_rule. Het kan TFF's strengere getRates-tijd-validatie (postcode-formats etc.) niet
// repliceren, dus een "ready"-verdict blijft daar een best guess.
import { isInEUCustomsTerritory, canonicalShippingCountry } from "../utils/countries";
import { applyAutomationRules } from "./automationApplier";
import { userPreferences } from "../state/userPreferences";
import type { ShipmentTemplate, ValidationResult } from "../types/config";
import type { EnrichedOrder } from "../types/webshop";
import type { WidgetProviderLayer } from "../providers/types";

export type ClientReadiness = {
  status: "ready" | "no_rule" | "needs_input" | "error";
  reason?: string;
  missingFields?: string[];
};

function defaultSenderTemplate(): any | null {
  const recall: any = userPreferences?.inputRecall?.shipperAddress;
  const templates: Record<string, any> = recall?.templates ?? {};
  const keys = Object.keys(templates);
  const defKey: string | undefined = (recall?.defaults ?? []).find((k: string) => !!templates[k]);
  if (defKey) return templates[defKey];
  if (keys.length === 1) return templates[keys[0]];
  return null;
}

function buildInitial(order: EnrichedOrder): ShipmentTemplate {
  const sa: any = (order as any).shippingAddress ?? {};
  return {
    carrier: "",
    source: (order.orderPlatform || "").toLowerCase(),
    packages: [],
    shipperAddress: {
      company: "", firstName: "", lastName: "", email: "",
      street: ["", ""], city: "", region: "", postalCode: "", country: "", phoneNumber: "",
    },
    recipientAddress: {
      company: sa.company ?? "",
      firstName: sa.firstName ?? "",
      lastName: sa.lastName ?? "",
      email: sa.email ?? "",
      street: Array.isArray(sa.street) ? [...sa.street, "", ""].slice(0, 2) : ["", ""],
      city: sa.city ?? "",
      region: sa.region ?? "",
      postalCode: sa.postalCode ?? "",
      // FR + overseas postal code (97x/98x) ships under the territory's own ISO
      // code at TFF (GP/RE/MQ/…) — FR would quote mainland services.
      country: canonicalShippingCountry(sa.country, sa.postalCode),
      phoneNumber: sa.phoneNumber ?? "",
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
      truckShipmentInfo: { shipperForklift: false, shipperTaillift: false, recipientForklift: false, recipientTaillift: false },
      insuranceValue: 0,
      signatureRequired: "none",
      carrierAccountNumber: { specifyCarrierAccountNumber: false, carrierAccountNumber: "", carrierAccountNumberCountry: "", carrierAccountNumberPostalCode: "" },
    },
    invoice: { filename: "", base64: "" },
    orderId: "",
  } as unknown as ShipmentTemplate;
}

// Joins the per-step reasons in a needs_input verdict — `OrderRow.attentionLabel` splits on this.
const REASON_SEP = " • ";

export function clientPreflight(order: EnrichedOrder, provider: WidgetProviderLayer): ClientReadiness {
  // Provider-laag (fabriek-emit) i.p.v. generated imports. Ontbreekt een suite dan
  // degraderen we conservatief naar "geldig" — de proxy/getRates vangt het later alsnog.
  const validateShipperAddress = provider.readiness?.validateShipperAddress ?? (() => ({ valid: true } as ValidationResult));
  const validateRecipientAddress = provider.readiness?.validateRecipientAddress ?? (() => ({ valid: true } as ValidationResult));
  const validatePackages = provider.readiness?.validatePackages ?? (() => [] as ValidationResult[]);
  const validateProducts = (products: any[]): ValidationResult[] => {
    const r = provider.gridValidators?.validateProducts?.(products as any) as
      | ValidationResult
      | ValidationResult[]
      | undefined;
    return Array.isArray(r) ? r : r ? [r] : [];
  };

  try {
    const prefs: any = userPreferences ?? {};
    const automationRules = prefs.automationRules ?? [];
    const packageTemplates = prefs.packageTemplates ?? [];
    // The "skipPackagesIfAutomated" toggle in settings: when explicitly OFF, the user wants
    // to ALWAYS see the packages step (even when a default_packages rule provides them) so
    // they can confirm. Default — when the toggle is on OR unset — is to honour the rule and
    // auto-fill packages without prompting.
    const autoSkipPackages = prefs?.widgetBehavior?.skipPackagesIfAutomated !== false;
    const s = buildInitial(order);

    // Collect every step that still needs input — the pill can then say "+N" when it's more
    // than one, instead of showing only the first.
    const reasons: string[] = [];
    const missing: string[] = [];

    // sender — fill from the saved default sender template if the address is empty/invalid
    if (!validateShipperAddress(s.shipperAddress!).valid) {
      const tmpl = defaultSenderTemplate();
      if (tmpl) {
        const { templateId: _t, updatedAt: _u, ...addr } = tmpl;
        s.shipperAddress = { ...s.shipperAddress, ...addr } as any;
      }
      if (!validateShipperAddress(s.shipperAddress!).valid) { reasons.push("Afzendergegevens controleren"); missing.push("shipperAddress"); }
    }

    // receiver — the order's recipient address must validate
    if (!validateRecipientAddress(s.recipientAddress!).valid) { reasons.push("Ontvanger gegevens bijwerken"); missing.push("recipientAddress"); }

    // packages — a default_packages rule provides them, unless the user asked to always confirm
    {
      if (autoSkipPackages) {
        const { patch } = applyAutomationRules(automationRules, { shipment: s, order, packageTemplates });
        if (patch.packages?.length) s.packages = patch.packages as any;
      }
      if (!s.packages?.length || validatePackages(s.packages).some((r) => r.valid === false)) { reasons.push("Verpakking"); missing.push("packages"); }
    }

    // products — needed when either end is outside the EU customs territory: exports
    // (destination non-EU) AND imports (origin non-EU). Mirrors the wizard products step;
    // applies to manual shipments too.
    {
      const dest = (s.recipientAddress?.country || "").toUpperCase();
      const orig = (s.shipperAddress?.country || "").toUpperCase();
      const isNonEU =
        (!!dest && !isInEUCustomsTerritory(dest, s.recipientAddress?.postalCode)) ||
        (!!orig && !isInEUCustomsTerritory(orig, s.shipperAddress?.postalCode));
      if (isNonEU) {
        const { patch } = applyAutomationRules(automationRules, { shipment: s, order, packageTemplates });
        if (patch.products?.length) s.products = patch.products as any;
        if (!s.products?.length) { reasons.push("Productgegevens aanvullen"); missing.push("products"); }
        else {
          const productError = validateProducts(s.products as any).find((r) => r.valid === false);
          if (productError) { reasons.push(productError.message || "Productgegevens aanvullen"); missing.push("products"); }
        }
      }
    }

    if (missing.length) {
      return { status: "needs_input", reason: [...new Set(reasons)].join(REASON_SEP), missingFields: [...new Set(missing)] };
    }

    // rate selection
    const { rateSelection } = applyAutomationRules(automationRules, { shipment: s, order, packageTemplates });
    if (rateSelection) return { status: "ready" };
    return { status: "no_rule", reason: "Geen automatische servicekeuze ingesteld", missingFields: ["chosenRate"] };
  } catch (e: any) {
    return { status: "error", reason: String(e?.message ?? e ?? "preflight mislukt") };
  }
}
