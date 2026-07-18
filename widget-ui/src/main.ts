// Dev-harness-entrypoint. Bedraadt zoals de echte loader (src/widget/loader.ts):
// tenant-config → host-adapter (resolveMount, hier met de ECHTE DOM als HostEnv) →
// provider-registry → mount. Verschil met de node-kant: tenant-config komt gebundeld
// binnen (vite JSON-import) i.p.v. via node:fs.

import "./app.css";
import { mount } from "svelte";
import WizardShell from "./lib/WizardShell.svelte";
import devTenant from "../../tenants/dev-standalone.json";
import type { TenantConfig } from "../../src/widget/tenant.ts";
import { resolveHost, resolveMount } from "../../src/widget/host-adapter.ts";
import type { HostEnv, HostElement } from "../../src/widget/host-adapter.ts";
import { getWidgetProvider } from "./lib/providers/registry";
import { setLang } from "./lib/state/messageStore";
import { setApiBaseUrl } from "./lib/api/global";

const tenant = devTenant as unknown as TenantConfig;
setApiBaseUrl(tenant.host.endpoints.api);

// De echte DOM achter de HostEnv-abstractie — dezelfde adapter-interface die de
// node-harness met een mock-DOM test (verify-host).
const env: HostEnv = {
  querySelector: (s) => document.querySelector(s) as unknown as HostElement | null,
  createElement: (t) => document.createElement(t) as unknown as HostElement,
  get body() {
    return document.body as unknown as HostElement;
  },
};

setLang("NL");

const target = resolveMount(resolveHost(tenant), env) as unknown as HTMLElement;
const provider = getWidgetProvider(tenant.providers[0]);

mount(WizardShell, { target, props: { tenant, provider, userId: tenant.id } });
