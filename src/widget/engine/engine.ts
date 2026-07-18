// Wizard-engine (getrouw geport uit v1 wizard/engine.ts). Enige wijziging: de step-array
// is nu een PARAMETER i.p.v. de hardcoded `import { wizardSteps } from "./steps"`. Daarmee
// is de engine provider-agnostisch — dezelfde machine draait elke tenant/provider.

import type { WizardStep, WizardContext, EngineResult, StepResolution, Shipment } from "./types.ts";

function applyPatch(shipment: Shipment, patch: Partial<Shipment>): Shipment {
  return { ...shipment, ...patch };
}

export function buildVisibleSteps(steps: WizardStep[], ctx: WizardContext): WizardStep[] {
  return steps.filter((step) => step.shouldInclude(ctx));
}

/**
 * Loopt de step-lijst vanaf `fromIndex`, slaat uitgesloten stappen over, past "auto"-
 * patches toe die schoon valideren, en stopt bij de eerste stap die gerenderd moet worden.
 * "done" als de lijst op is. `shipment` weerspiegelt toegepaste auto-patches.
 */
export async function advance(
  steps: WizardStep[],
  shipment: Shipment,
  meta: { tenantId: string },
  fromIndex: number,
): Promise<EngineResult> {
  let current = shipment;
  let idx = fromIndex;

  while (idx < steps.length) {
    const step = steps[idx];
    const ctx: WizardContext = { shipment: current, ...meta };

    if (!step.shouldInclude(ctx)) { idx++; continue; }

    const resolution: StepResolution = await step.resolve(ctx);
    if (resolution.type === "skip") { idx++; continue; }

    if (resolution.type === "auto") {
      const patched = applyPatch(current, resolution.patch);
      const validation = step.validate({ ...ctx, shipment: patched });
      if (validation.valid) { current = patched; idx++; continue; }
      // auto produceerde ongeldige staat -> render deze stap
      return { type: "render", step, shipment: patched };
    }

    return { type: "render", step, shipment: current };
  }

  return { type: "done", shipment: current };
}

/**
 * Loopt elke ingesloten stap en merget de patch van elke "auto"-resolutie, ZONDER te stoppen
 * bij de eerste render. Voor de "opnieuw alle stappen"-flow: elk scherm toont wat de automator
 * al invulde. (Geport uit v1 applyAllAutoPatches.)
 */
export async function applyAllAutoPatches(
  steps: WizardStep[],
  shipment: Shipment,
  meta: { tenantId: string },
): Promise<Shipment> {
  let current = shipment;
  for (const step of steps) {
    const ctx: WizardContext = { shipment: current, ...meta };
    if (!step.shouldInclude(ctx)) continue;
    const resolution = await step.resolve(ctx);
    if (resolution.type === "auto") current = applyPatch(current, resolution.patch);
  }
  return current;
}
