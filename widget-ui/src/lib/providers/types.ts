// Contract van de per-provider WIDGET-laag: wat de UI-componenten van een provider
// nodig hebben (veld-validators + domeintabellen). Dit is de browser-tegenhanger van
// de node-kant ProviderIntegration (src/widget/provider-registry.ts) — zelfde principe:
// provider = parameter, geen hardcoded importpaden in componenten.

import type { ValidationResult } from "../types/config";

export interface FieldValidator {
  dependsOn: (template: any) => any;
  validate: (deps: any) => ValidationResult | Promise<ValidationResult>;
}

/** Vorm van een pakket-rij zoals de packages-editor 'm valideert (v1: validatePackageX(row)). */
export interface PackageRowLike {
  type: string;
  length: number;
  width: number;
  height: number;
  weight: number;
  [k: string]: unknown;
}

export interface WidgetProviderLayer {
  id: string;
  /** Domeintabellen (landen, valuta, opties) — fabriek-output. */
  domain: { countries: string[]; [k: string]: unknown };
  /** Veldnaam -> validator, zoals ValidatedInput/ValidatedSelect ze consumeren. */
  fieldValidators: Record<string, FieldValidator>;
  /** Per-rij pakketvalidators (v1: validatePackageLength/Width/Height/Weight). */
  packageValidators: {
    length(row: PackageRowLike): ValidationResult | Promise<ValidationResult>;
    width(row: PackageRowLike): ValidationResult | Promise<ValidationResult>;
    height(row: PackageRowLike): ValidationResult | Promise<ValidationResult>;
    weight(row: PackageRowLike): ValidationResult | Promise<ValidationResult>;
  };
}
