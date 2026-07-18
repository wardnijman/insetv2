// Provider-registry (widget-extractie stap 1). Vervangt v1's hardcoded importpaden
// (`steps/validations/tff/…`) door een PARAMETER: de widget-engine vraagt de registry
// om de integratie van de actieve provider. "tff" wordt daarmee één van N.
//
// De per-provider integratie komt uit de v2-fabriek (portals/<provider>/ + generated/).
// Wat de fabriek nog niet produceert (widget-validators, fingerprint/veld-matrices)
// wordt een fabriek-uitbreiding in een latere stap; de SEAM staat nu.

import { readFileSync, existsSync } from "node:fs";

type TransformFn = (input: unknown) => Record<string, unknown>;

export interface ProviderIntegration {
  providerId: string;
  portal: { portal: string; baseUrl: string; auth: unknown; capabilities: unknown };
  flow: { flow: string; fingerprint: string };
  /** Canoniek veld-stel dat de widget rendert (uit fields.json). */
  fieldNames: string[];
  /** Canoniek -> portaal-payload, uit de fabriek. Lazy geladen. */
  loadTransform: () => Promise<TransformFn>;
}

const cache = new Map<string, ProviderIntegration>();

export function hasProvider(providerId: string): boolean {
  return existsSync(`portals/${providerId}/portal.json`);
}

export function getProvider(providerId: string): ProviderIntegration {
  let p = cache.get(providerId);
  if (!p) {
    const base = `portals/${providerId}`;
    if (!existsSync(`${base}/portal.json`)) throw new Error(`[registry] onbekende provider: ${providerId}`);
    const portal = JSON.parse(readFileSync(`${base}/portal.json`, "utf8"));
    const flow = JSON.parse(readFileSync(`${base}/flow.json`, "utf8"));
    const fields = JSON.parse(readFileSync(`${base}/fields.json`, "utf8"));
    p = {
      providerId,
      portal,
      flow,
      fieldNames: Object.keys(fields.map ?? {}),
      loadTransform: async () => (await import(`../../generated/${providerId}/${flow.flow}.ts`)).transform as TransformFn,
    };
    cache.set(providerId, p);
  }
  return p;
}
