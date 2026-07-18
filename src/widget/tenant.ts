// Tenant-config (widget-extractie). Een tenant = een boekaccount (forwarder óf verlader,
// §10) dat gedeelde provider-integraties gebruikt. De widget-engine is gedeeld; per tenant
// verschilt: welke provider(s), gedrag-toggles, branding, en HOE de widget in de host
// geïnjecteerd wordt (host-config, stap 2).

import { readFileSync } from "node:fs";

export interface WidgetBehavior {
  skipSenderIfComplete?: boolean;
  skipReceiverIfFilled?: boolean;
  skipPackagesIfAutomated?: boolean;
  loadRatesInBackground?: boolean;
  labelFormat?: "a4" | "a6";
}

export interface HostConfig {
  /** embedded = in een bestaand host-element (forwarder-portaal); standalone = eigen container (verlader). */
  mode: "embedded" | "standalone";
  mountSelector?: string; // embedded: waar in de host mounten (v1: ".stap1")
  containerId?: string;   // standalone: welke container aanmaken
  endpoints: { api: string; auth?: string; pdf?: string };
  /** optioneel: hoe je "uitgelogd bij de host" detecteert (v1's TFF-banner). */
  loggedOutSignal?: { selector: string; textIncludes?: string };
}

export interface TenantConfig {
  id: string;
  /** Gedeelde portaal-integraties die deze tenant gebruikt (forwarder-first = meestal 1). */
  providers: string[];
  widgetBehavior: WidgetBehavior;
  host: HostConfig;
  branding?: { name?: string; primaryColor?: string };
  /** Tenant-defaults die v1 hardcodeerde ("NL"-origin, carrier-fallback). */
  defaults?: { originCountry?: string };
}

export function loadTenant(id: string): TenantConfig {
  return JSON.parse(readFileSync(`tenants/${id}.json`, "utf8")) as TenantConfig;
}
