// Browser-kant provider-registry: de UI vraagt de widget-laag van de actieve provider
// op via PARAMETER (tenant-config → providers[0]), nooit via een hardcoded importpad.
// Sinds slice 25 komt de laag uit de FABRIEK-EMIT (generated/<provider>/widget/index.ts,
// semantisch bewezen tegen het v1-oracle in verify-widget-validators) — dit bestand is
// pure bedrading. `npm run compile` (root) moet gedraaid zijn; de pre-hooks doen dat.

import { widgetLayer, submitLayer, domain as tffDomain } from "../../../../generated/tff/widget/index.ts";
import { tffPaperlessInvoiceProvider } from "./paperless";
import type { WidgetProviderLayer } from "./types";

const providers: Record<string, WidgetProviderLayer> = {
  tff: {
    id: "tff",
    domain: tffDomain as unknown as WidgetProviderLayer["domain"],
    fieldValidators: widgetLayer.fieldValidators,
    packageValidators: widgetLayer.packageValidators,
    gridValidators: widgetLayer.gridFns,
    readiness: {
      validateShipperAddress: widgetLayer.fns.validateShipperAddress,
      validateRecipientAddress: widgetLayer.fns.validateRecipientAddress,
      validatePackages: widgetLayer.fns.validatePackages,
    },
    // Paperless-factuur: mapper lokaal (oracle-bewaakt), PDF/attach via de proxy —
    // hiermee gaat SkeletonContainer's "Genereer"-knop van fail-soft-toast naar werkend.
    paperlessInvoice: tffPaperlessInvoiceProvider,
    submit: {
      fingerprintMatrix: submitLayer.fingerprintMatrix,
      widgetFieldsMatrix: submitLayer.widgetFieldsMatrix,
      additionalFieldPolicies: submitLayer.additionalFieldPolicies as Record<string, unknown>,
      validatorsByForm: submitLayer.validatorsByForm,
    },
    setLanguage: (lang: string) => {
      widgetLayer.setLanguage(lang);
      submitLayer.setLanguage(lang);
    },
  },
};

export function hasWidgetProvider(id: string): boolean {
  return id in providers;
}

export function getWidgetProvider(id: string): WidgetProviderLayer {
  const p = providers[id];
  if (!p) throw new Error(`[widget-registry] onbekende provider: ${id}`);
  return p;
}

/** Taalwissel voor de validator-messages van alle geladen providers (v1: setValidationsLanguage). */
export function setProvidersLanguage(lang: string): void {
  for (const p of Object.values(providers)) p.setLanguage?.(lang);
}
