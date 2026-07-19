// Bouwt de step-array voor een tenant (vervangt v1's hardcoded `wizardSteps` in steps.ts).
// shouldInclude/resolve komen uit tenant-config (widgetBehavior skip-toggles) + gedeelde
// correctheidsregels (customs-gating). Volgorde als v1: sender→receiver→packages→products→ship.

import type { WizardStep, Address, Shipment } from "./types.ts";
import type { TenantConfig } from "../tenant.ts";
import { needsCustoms } from "./customs.ts";

function addrValid(a?: Address): boolean {
  return !!(a && a.country && a.postalCode);
}
function packagesValid(s: Shipment): boolean {
  return Array.isArray(s.packages) && s.packages.length > 0;
}

export function buildSteps(tenant: TenantConfig): WizardStep[] {
  const wb = tenant.widgetBehavior;
  return [
    {
      id: "sender", sectionKey: "shipperAddress",
      shouldInclude: () => true,
      resolve: (ctx) => (addrValid(ctx.shipment.shipperAddress) && wb.skipSenderIfComplete ? { type: "skip" } : { type: "render" }),
      validate: (ctx) => ({ valid: addrValid(ctx.shipment.shipperAddress) }),
    },
    {
      id: "receiver", sectionKey: "recipientAddress",
      shouldInclude: () => true,
      resolve: (ctx) => (addrValid(ctx.shipment.recipientAddress) && wb.skipReceiverIfFilled ? { type: "skip" } : { type: "render" }),
      validate: (ctx) => ({ valid: addrValid(ctx.shipment.recipientAddress) }),
    },
    {
      id: "packages", sectionKey: "packages",
      shouldInclude: () => true,
      resolve: (ctx) => (packagesValid(ctx.shipment) && wb.skipPackagesIfAutomated ? { type: "skip" } : { type: "render" }),
      validate: (ctx) => ({ valid: packagesValid(ctx.shipment) }),
    },
    {
      // Douanestap: alleen als één van beide uiteinden buiten het EU-douanegebied (correctheid, route-gedreven).
      id: "products", sectionKey: "products",
      shouldInclude: (ctx) => needsCustoms(ctx.shipment),
      resolve: () => ({ type: "render" }),
      validate: () => ({ valid: true }),
    },
    {
      // sectionKey als v1 ("shipmentOptions"): de sectie-gescoopte Verzend-dim in de
      // shell kijkt naar fieldValidity-prefixen — met "ship" was dat een no-op.
      id: "ship", sectionKey: "shipmentOptions",
      shouldInclude: () => true,
      resolve: () => ({ type: "render" }),
      validate: () => ({ valid: true }),
    },
  ];
}
