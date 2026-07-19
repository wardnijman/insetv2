// Browser-kant provider-registry: de UI vraagt de widget-laag van de actieve provider
// op via PARAMETER (tenant-config → providers[0]), nooit via een hardcoded importpad.
// Sinds slice 25 komt de laag uit de FABRIEK-EMIT (generated/<provider>/widget/index.ts,
// semantisch bewezen tegen het v1-oracle in verify-widget-validators) — dit bestand is
// pure bedrading. `npm run compile` (root) moet gedraaid zijn; de pre-hooks doen dat.

import { widgetLayer, domain as tffDomain } from "../../../../generated/tff/widget/index.ts";
import type { WidgetProviderLayer } from "./types";

const providers: Record<string, WidgetProviderLayer> = {
  tff: {
    id: "tff",
    domain: tffDomain as unknown as WidgetProviderLayer["domain"],
    fieldValidators: widgetLayer.fieldValidators,
    packageValidators: widgetLayer.packageValidators,
    gridValidators: widgetLayer.gridFns,
    setLanguage: widgetLayer.setLanguage,
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
