// Contract van de per-provider WIDGET-laag: wat de UI-componenten van een provider
// nodig hebben (veld-validators + domeintabellen). Dit is de browser-tegenhanger van
// de node-kant ProviderIntegration (src/widget/provider-registry.ts) — zelfde principe:
// provider = parameter, geen hardcoded importpaden in componenten.

import type { ValidationResult } from "../types/config";

export interface FieldValidator {
  dependsOn: (template: any) => any;
  validate: (deps: any) => ValidationResult | Promise<ValidationResult>;
}

export interface WidgetProviderLayer {
  id: string;
  /** Domeintabellen (landen, valuta, opties) — fabriek-output. */
  domain: { countries: string[]; [k: string]: unknown };
  /** Veldnaam -> validator, zoals ValidatedInput/ValidatedSelect ze consumeren. */
  fieldValidators: Record<string, FieldValidator>;
}
