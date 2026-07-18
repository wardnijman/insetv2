// v1-compatibele messageStore (widget-ui). Componenten lezen `m.x.y.z` (nested) en
// `currentLang` — exact als v1, zodat de step-blocks 1-op-1 porten. Verschil met v1:
// de catalogus is GEBUNDELD (messages/nl,en) i.p.v. host-geïnjecteerd via
// window.__WIDGET_MESSAGES__, en per-tenant overrides deep-mergen eroverheen
// (branding/vertaling per tenant, zelfde idee als de node-kant messages.ts).
//
// Default NL en `lang ?? "NL"` zijn load-bearing: een taal-loze tenant mag currentLang
// nooit undefined maken (v1-bug: crash op currentLang.toLowerCase() bij wizard-open).

import nl from "../messages/nl";
import en from "../messages/en";

export type Lang = "EN" | "NL" | "FR" | "IT" | "ES" | "DE";

const BASE: Partial<Record<Lang, unknown>> = { NL: nl, EN: en };

export let m: any = nl;
export let currentLang: Lang = "NL";

function deepMerge(base: any, override: any): any {
  if (override === undefined) return base;
  if (typeof base !== "object" || base === null || Array.isArray(override) ||
      typeof override !== "object" || override === null) return override;
  const out: any = { ...base };
  for (const k of Object.keys(override)) out[k] = deepMerge(base?.[k], override[k]);
  return out;
}

/** Zet taal + tenant-overrides (nested, per taal gekeyed: { nl: {...}, en: {...} }). */
export function setLang(lang?: Lang, tenantOverrides?: Record<string, unknown>) {
  const safeLang: Lang = lang ?? "NL";
  const base = BASE[safeLang] ?? nl;
  const override = tenantOverrides?.[safeLang.toLowerCase()] ?? {};
  m = deepMerge(base, override);
  currentLang = safeLang;
}
