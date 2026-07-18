// Tenant-config (widget-extractie stap 1). Een tenant = een boekaccount (forwarder óf
// verlader, §10) dat één of meer gedeelde provider-integraties gebruikt. De widget-engine
// is gedeeld; per tenant verschilt alleen dit: welke provider(s), gedrag-toggles, branding.

import { readFileSync } from "node:fs";

export interface WidgetBehavior {
  skipSenderIfComplete?: boolean;
  skipReceiverIfFilled?: boolean;
  skipPackagesIfAutomated?: boolean;
  loadRatesInBackground?: boolean;
  labelFormat?: "a4" | "a6";
}

export interface TenantConfig {
  id: string;
  /** Gedeelde portaal-integraties die deze tenant mag gebruiken (forwarder-first = meestal 1). */
  providers: string[];
  widgetBehavior: WidgetBehavior;
  branding?: { name?: string; primaryColor?: string };
  /** Tenant-defaults die v1 hardcodeerde ("NL"-origin, carrier-fallback). */
  defaults?: { originCountry?: string };
}

export function loadTenant(id: string): TenantConfig {
  return JSON.parse(readFileSync(`tenants/${id}.json`, "utf8")) as TenantConfig;
}
