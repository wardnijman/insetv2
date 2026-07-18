// Wizard-engine-contract (geport uit v1 wizard/types.ts). Framework-onafhankelijk:
// een step heeft shouldInclude/resolve/validate; de engine draait er de step-machine op.
// Provider-agnostisch — de step-array wordt gebouwd uit tenant/provider-config (build-steps).

export type WizardStepId = "sender" | "receiver" | "packages" | "products" | "ship";

export interface Address { country?: string; postalCode?: string; [k: string]: unknown }

export interface Shipment {
  shipperAddress?: Address;
  recipientAddress?: Address;
  packages?: unknown[];
  [k: string]: unknown;
}

export interface WizardContext {
  shipment: Shipment;
  tenantId: string;
}

export type StepResolution =
  | { type: "render" }
  | { type: "skip" }
  | { type: "auto"; patch: Partial<Shipment> };

export interface StepValidation { valid: boolean; reason?: string }

export interface WizardStep {
  id: WizardStepId;
  /** fieldValidity-prefix voor de "Verder"-guard (bv. "shipperAddress"). */
  sectionKey: string;
  shouldInclude: (ctx: WizardContext) => boolean;
  resolve: (ctx: WizardContext) => StepResolution | Promise<StepResolution>;
  validate: (ctx: WizardContext) => StepValidation;
}

export type EngineResult =
  | { type: "render"; step: WizardStep; shipment: Shipment }
  | { type: "done"; shipment: Shipment };
