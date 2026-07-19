// Geport uit v1 src/lib/api/fingerprintDiscovery.ts. Wijzigingen:
// - PROXY-FIRST: alle netwerk-paden (fetchFingerprintStatusesApi, enqueueMissing…,
//   triggerFingerprintDiscoveryProcessorApi, waitForFingerprintsBatchApi en de
//   dynamische tak van enrichRatesWithFingerprintAvailabilityApi) zijn VERVALLEN —
//   zie TODO(proxy-fingerprint-fallback). Onopgeloste keys volgen v1's faalpad:
//   fingerprintStatus "missing", fingerprint undefined.
// - De statische matrix komt NIET meer uit een import (steps/fingerprintMatrix.json)
//   maar als PARAMETER: de aanroeper geeft provider.submit.fingerprintMatrix mee.
// - Pure helpers (normLabel, fingerprintPartsFromReusableData, resolvePackageType,
//   stableStringify) verbatim; `sleep` (alleen voor het poll-pad) weggelaten.
// - approvedFingerprintCache (cache van dynamische DB-approvals) weggelaten:
//   zonder netwerk-fallback bestaan er geen dynamische approvals om te cachen.

import type { ShipmentTemplate } from "../types/config";

export type DynamicFingerprintLookup =
  | { kind: "approved"; fingerprint: string; source: "static" | "dynamic" }
  | { kind: "pending" }
  | { kind: "unknown_fingerprint"; fingerprint?: string | null }
  | { kind: "failed"; error?: string | null }
  | { kind: "missing" };

// Behouden voor de toekomstige proxy-fallback (vorm van een discovery-kandidaat).
// TODO(proxy-fingerprint-fallback): weer consumeren zodra de proxy een
// fingerprint-discovery-endpoint aanbiedt.
export type MissingFingerprintDiscoveryCandidate = {
  serviceMapKey: string;
  originCountry: string;
  recipientCountry: string;
  packageType: "pallet" | "package" | "document";
  carrier: string;
  service: string;
  template: any;
  customerId: string;
  discoveryBatchKey: string;
};

type LoggerLike = {
  log?: (msg: string, data?: any) => void;
  warn?: (msg: string, data?: any) => void;
};

function noop() {}

function makeLogger(dbg?: LoggerLike) {
  return {
    log: dbg?.log ?? noop,
    warn: dbg?.warn ?? noop,
  };
}

function collapseWs(s: any) {
  return String(s ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeFormLike(s: any): string {
  const raw = String(s ?? "");
  const plusFixed = raw.replace(/\+/g, " ");
  try {
    return decodeURIComponent(plusFixed);
  } catch {
    return plusFixed;
  }
}

function normLabel(s: any): string {
  return collapseWs(decodeFormLike(s));
}

export function fingerprintPartsFromReusableData(u: Record<string, any>) {
  const carrier = normLabel(u.choose_carrier ?? u.carrier ?? "");
  const service = normLabel(
    u.choose_service_name ??
      u.choose_servicename ??
      u.choose_service_display ??
      u.choose_service ??
      u.service ??
      "",
  );
  return { carrier, service };
}

export function resolvePackageType(
  packages: any[],
): "pallet" | "package" | "document" {
  if (packages?.some((p) => p?.type === "pallet")) return "pallet";
  if (packages?.some((p) => p?.type === "package")) return "package";
  return "document";
}

export function stableStringify(x: any): string {
  if (x === null || typeof x !== "object") return JSON.stringify(x);
  if (Array.isArray(x)) return `[${x.map(stableStringify).join(",")}]`;
  const keys = Object.keys(x).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify(x[k])}`)
    .join(",")}}`;
}

/** Sleutelvorm van de matrix: `<origin>_<dest>_<type>_<carrier>_<service>` (v1-conform). */
export function buildFingerprintKey(
  originCountry: string,
  destinationCountry: string,
  packageType: "pallet" | "package" | "document",
  carrier: string,
  service: string,
): string {
  return `${originCountry}_${destinationCountry}_${packageType}_${carrier}_${service}`;
}

/**
 * Pure matrix-lookup: lane/carrier/service → fingerprint (formId).
 * Retourneert undefined bij een onbekende key — v1 viel dan terug op de
 * netwerk-discovery; die fallback bestaat hier (nog) niet.
 * TODO(proxy-fingerprint-fallback)
 */
export function lookupFingerprintInMatrix(
  matrix: Record<string, string>,
  key: string,
): string | undefined {
  return matrix[key];
}

/**
 * Verrijkt rates met fingerprint-beschikbaarheid — v1-signatuur en output-vorm
 * behouden ({ ...rate, fingerprintKey, fingerprintStatus, fingerprint,
 * fingerprintError }), maar alleen nog het PURE statische-matrix-pad.
 * De netwerk-opties (fetchFn/apiBaseUrl/requestId/customerId/waitMs/pollMs)
 * blijven in de signatuur voor call-site-compatibiliteit maar worden genegeerd.
 * TODO(proxy-fingerprint-fallback): dynamische statuses/enqueue via de proxy.
 */
export async function enrichRatesWithFingerprintAvailabilityApi(opts: {
  rates: any[];
  template: ShipmentTemplate;
  /** provider.submit.fingerprintMatrix — komt als parameter, niet meer via import. */
  staticMatrix: Record<string, string>;
  fetchFn?: typeof globalThis.fetch;
  apiBaseUrl?: string;
  requestId?: string;
  customerId?: string;
  waitMs?: number;
  pollMs?: number;
  dbg?: LoggerLike;
}) {
  const { log } = makeLogger(opts.dbg);

  const originCountry = String((opts.template as any).shipperAddress?.country ?? "")
    .trim()
    .toUpperCase();

  const destinationCountry = String(
    (opts.template as any).recipientAddress?.country ?? "",
  )
    .trim()
    .toUpperCase();

  const packageType = resolvePackageType((opts.template as any).packages);

  const keyed = opts.rates.map((rate) => {
    // TODO(proxy-rates-verrijking): fail-soft — onverrijkte proxy-rates hebben geen
    // reusableData; val terug op de top-level rate ({carrier, service, …}), zelfde
    // patroon als applyRateExclusions in rateFetcher. Met reusableData is dit v1-gedrag.
    const fp = fingerprintPartsFromReusableData(rate.reusableData ?? rate);
    const key = buildFingerprintKey(
      originCountry,
      destinationCountry,
      packageType,
      fp.carrier,
      fp.service,
    );

    return {
      rate,
      fp,
      key,
    };
  });

  const lookups = new Map<string, DynamicFingerprintLookup>();

  for (const { key } of keyed) {
    const staticFp = lookupFingerprintInMatrix(opts.staticMatrix, key);
    if (staticFp) {
      lookups.set(key, { kind: "approved", fingerprint: staticFp, source: "static" });
      continue;
    }
    // TODO(proxy-fingerprint-fallback): v1 vroeg hier de backend om dynamische
    // statuses en enqueue'de missende keys voor discovery. Zonder die fallback
    // volgt de key v1's faalpad: "missing".
    lookups.set(key, { kind: "missing" });
  }

  const enriched = keyed.map(({ rate, key }) => {
    const lookup = lookups.get(key) ?? { kind: "missing" as const };

    return {
      ...rate,
      fingerprintKey: key,
      fingerprintStatus: lookup.kind,
      fingerprint:
        lookup.kind === "approved" ? lookup.fingerprint : undefined,
      fingerprintError:
        lookup.kind === "failed" ? lookup.error ?? null : undefined,
    };
  });

  log("enrichRatesWithFingerprintAvailabilityApi done", {
    total: enriched.length,
    approved: enriched.filter((r) => r.fingerprintStatus === "approved").length,
    missing: enriched.filter((r) => r.fingerprintStatus === "missing").length,
  });

  return enriched;
}
