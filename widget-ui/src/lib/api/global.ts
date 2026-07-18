// v2-versie van v1's api/global: de API-base komt uit de TENANT-config (host-adapter,
// endpoints.api) i.p.v. uit build-env (__BUILDTARGET__/__CLIENT__). De boot (main.ts /
// loader) zet 'm vóór mount; ge-porte componenten importeren `apiBaseUrl` exact als in v1.

export let apiBaseUrl = "";

export function setApiBaseUrl(url: string): void {
  apiBaseUrl = url.replace(/\/$/, "");
}
