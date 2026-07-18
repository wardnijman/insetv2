// De injectie-entrypoint (loader-model, R2.8). De host-pagina roept `mountWidget(tenantId)`
// aan; die bedraadt tenant-generiek: tenant-config → host-adapter (waar mounten) →
// provider-registry (welke integratie). De Svelte-render zelf komt in een latere stap;
// dit is de tenant-generieke bedrading eromheen.

import { loadTenant } from "./tenant.ts";
import { resolveHost, resolveMount } from "./host-adapter.ts";
import type { HostEnv, HostElement } from "./host-adapter.ts";
import { getProvider } from "./provider-registry.ts";

export interface MountedWidget {
  tenantId: string;
  mode: "embedded" | "standalone";
  element: HostElement;
  providers: string[];
  endpoints: { api: string };
  labelFormat: "a4" | "a6";
}

export function mountWidget(tenantId: string, env: HostEnv): MountedWidget {
  const tenant = loadTenant(tenantId);
  const host = resolveHost(tenant);
  const element = resolveMount(host, env);
  // provider(s) resolven (stap 1) — injectie + provider-seam komen hier samen
  const providers = tenant.providers.map((id) => getProvider(id).providerId);
  // hier zou de gedeelde Svelte-app in `element` renderen met {tenant, providers, host.endpoints}
  return {
    tenantId: tenant.id,
    mode: host.mode,
    element,
    providers,
    endpoints: { api: host.endpoints.api },
    labelFormat: tenant.widgetBehavior.labelFormat ?? "a4",
  };
}
