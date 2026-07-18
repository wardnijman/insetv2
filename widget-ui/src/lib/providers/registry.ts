// Browser-kant provider-registry: de UI vraagt de widget-laag van de actieve provider
// op via PARAMETER (tenant-config → providers[0]), nooit via een hardcoded importpad —
// zelfde seam als de node-kant registry (slice 17). Interim statisch: tff met
// gekopieerde domain.json + interim-validators; de fabriek-uitbreiding (blueprint §5
// stap 5) gaat deze laag per provider EMITTEN en dit bestand wordt dan pure bedrading.

import domainTff from "./tff/domain.json";
import { interimFieldValidators } from "./tff/field-validators.interim";
import type { WidgetProviderLayer } from "./types";

const providers: Record<string, WidgetProviderLayer> = {
  tff: {
    id: "tff",
    domain: domainTff as unknown as WidgetProviderLayer["domain"],
    fieldValidators: interimFieldValidators,
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
