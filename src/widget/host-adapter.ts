// Host-adapter (widget-extractie stap 2). HOE de widget zich in de host-pagina injecteert
// — en dat moet tenant-generiek. v1 mount hard in TFF's `.stap1` en leest TFF's Bootstrap-
// DOM; hier zit dat achter een per-tenant HostConfig + een DOM-agnostische `HostEnv`, zodat
// zowel "embedded in een forwarder-portaal" als "standalone bij een verlader" werkt.

import type { HostConfig, TenantConfig } from "./tenant.ts";

// Dunne, mockbare DOM-abstractie — de widget raakt de host nooit rechtstreeks aan.
export interface HostElement {
  id: string;
  setAttribute(name: string, value: string): void;
  append(child: HostElement): void;
}
export interface HostEnv {
  querySelector(selector: string): HostElement | null;
  createElement(tag: string): HostElement;
  readonly body: HostElement;
}

export function resolveHost(tenant: TenantConfig): HostConfig {
  if (!tenant.host) throw new Error(`[host] tenant ${tenant.id} heeft geen host-config`);
  return tenant.host;
}

/** Vind of maak het mount-element, tenant-generiek. Faalt gesloten bij een ontbrekend doel. */
export function resolveMount(host: HostConfig, env: HostEnv): HostElement {
  if (host.mode === "embedded") {
    if (!host.mountSelector) throw new Error("[host] embedded vereist mountSelector");
    const el = env.querySelector(host.mountSelector);
    if (!el) throw new Error(`[host] mount-doel niet gevonden in de host: ${host.mountSelector}`);
    return el;
  }
  // standalone: eigen container aanmaken en aan de body hangen
  const container = env.createElement("div");
  container.setAttribute("id", host.containerId ?? "inset-widget");
  env.body.append(container);
  return container;
}
