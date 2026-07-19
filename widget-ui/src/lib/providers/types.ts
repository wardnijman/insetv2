// Contract van de per-provider WIDGET-laag: wat de UI-componenten van een provider
// nodig hebben (veld-/pakket-/grid-validators + domeintabellen). Browser-tegenhanger
// van de node-kant ProviderIntegration; de invulling komt uit de fabriek-emit
// (generated/<provider>/widget), semantisch bewaakt door het v1-oracle.

import type { ValidationResult } from "../types/config";
import type { PaperlessInvoiceProvider } from "../utils/paperlessInvoiceGenerator";

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
  /** Domeintabellen (landen, valuta, opties, postcode-patronen) — fabriek-output. */
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
  /** Douane-grid-suite (§4: DE ene strikte product-line-laag) — voor de customs-stap. */
  gridValidators?: Record<string, (...args: any[]) => ValidationResult | ValidationResult[]>;
  /** PDF-generatie/attach voor de paperless-factuur — komt uit de fabriek-emit van de
   *  paperless-steps (volgt met de ship-stap-slice); tot dan degradeert "Genereer" fail-soft. */
  paperlessInvoice?: PaperlessInvoiceProvider<any>;
  /** Taalwissel voor validator-messages (v1: setValidationsLanguage). */
  setLanguage?: (lang: string) => void;
}
