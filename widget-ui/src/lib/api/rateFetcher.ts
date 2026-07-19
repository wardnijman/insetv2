// Geport uit v1 src/lib/api/rateFetcher.ts. Wijzigingen:
// - PROXY-FIRST transport: v1 riep de generated getRates-step aan (browser→TFF via
//   authFetch); nu `fetchRates` uit ./ratesClient (POST `${apiBaseUrl}/api/rates`
//   met het canonieke shipment). De VOLLEDIGE orkestratie (snapshot-dedup via
//   shallowSnapshot, rateFetchStart, store-writes, queue/afbreek-logica) is behouden.
// - TODO(proxy-rates-verrijking): de proxy levert nu alleen {carrier, service, price}.
//   v1-rates droegen meer (reusableData, transitTime, accessPoints, pickup-/delivery-
//   datums, imgUrl, fingerprint…). Veldnamen blijven behouden; ontbrekende velden
//   blijven undefined — alle consumenten (automationApplier, exclusions, UI) moeten
//   daar fail-soft mee omgaan. applyRateExclusions valt daarom terug op top-level
//   rate.carrier/service waar v1 hard op reusableData.choose_* leunde.
// - Readiness-gate: v1 importeerde validateShipperAddress/validateRecipientAddress/
//   validatePackages uit steps/validations (generated → verboden). De suite komt nu
//   als optionele PARAMETER (provider.readiness, gemapt vanuit de fabriek-emit
//   widgetLayer.fns in providers/registry.ts); zonder suite geldt een conservatieve
//   aanwezigheids-check zodat de proxy geen halflege shipments krijgt.
// - window.__rateDebug → module-state export `rateFetcherDebug` (geen window-global
//   op import- of runtijd). // TODO(window-globals): host-console-koppeling desgewenst
//   in de host-adapter, niet hier.

// Auto-fetch rates with rich debug, debounce, cache (DEV), and global exclusion filtering.

const USE_CACHE = false;

import { tick } from "svelte";
import { get, writable } from "svelte/store";
import type { Readable, Writable } from "svelte/store";
import type { Rating, ShipmentTemplate, ValidationResult } from "../types/config";
import { fetchRates, type RateOption } from "./ratesClient";
import { toast } from "../components/toast/toast";
import { globalPreferences } from "../state/globalPreferences";
import { acquireRateSlot } from "../wizard/rateQueue";

/** ==== Debug ============================================================= */

const DEBUG_RATES = false;

function dbg(...args: any[]) {
  if (!DEBUG_RATES) return;
  console.log("[rates]", ...args);
}
function group(title: string, fn: () => void) {
  if (!DEBUG_RATES) return fn();
  try {
    console.groupCollapsed(`🔎 ${title}`);
    fn();
  } finally {
    console.groupEnd();
  }
}
function ts() {
  return new Date().toISOString().split("T")[1]?.replace("Z", "");
}

/** Tiny diff between two shallow snapshots to show what changed */
function diffSnapshots(a: string | null, b: string) {
  try {
    const A = a ? JSON.parse(a) : null;
    const B = JSON.parse(b);
    const changes: string[] = [];
    if (!A) return ["<initial> → snapshot"];
    if (JSON.stringify(A.shipper) !== JSON.stringify(B.shipper))
      changes.push("shipper");
    if (JSON.stringify(A.recipient) !== JSON.stringify(B.recipient))
      changes.push("recipient");
    const ap = JSON.stringify(A.packages);
    const bp = JSON.stringify(B.packages);
    if (ap !== bp) changes.push("packages");
    return changes.length
      ? changes
      : ["<no structural changes but string differs>"];
  } catch {
    return ["<diff-error>"];
  }
}

/** Debounce with maxWait */
function debounceWithMaxWait<T extends (...args: any[]) => void>(
  fn: T,
  delay: number,
  maxWait: number
): T {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let maxTimeout: ReturnType<typeof setTimeout> | null = null;
  let lastInvoke = 0;

  return ((...args: any[]) => {
    if (timeout) clearTimeout(timeout);
    if (!maxTimeout) {
      dbg(`${ts()} ⏱️ schedule maxWait=${maxWait}ms`);
      maxTimeout = setTimeout(() => {
        dbg(`${ts()} ⏱️ maxWait elapsed → invoke`);
        fn(...args);
        lastInvoke = performance.now();
        timeout = null;
        maxTimeout = null;
      }, maxWait);
    }

    dbg(`${ts()} ⏱️ (re)schedule debounce delay=${delay}ms`);
    timeout = setTimeout(() => {
      const since = Math.round(performance.now() - lastInvoke);
      dbg(`${ts()} ⏱️ delay elapsed (since last invoke ${since}ms) → invoke`);
      fn(...args);
      lastInvoke = performance.now();
      if (maxTimeout) {
        clearTimeout(maxTimeout);
        maxTimeout = null;
      }
      timeout = null;
    }, delay);
  }) as T;
}

/** ==== Types & helpers ==================================================== */

export const rateFetchStart = writable<number | null>(null);

type FetchPhase =
  | "subscribe"
  | "shipment-change"
  | "pre-check"
  | "debounced-try"
  | "snapshot-change"
  | "skip-inflight"
  | "skip-nochange"
  | "cache-hit"
  | "cache-miss"
  | "fetch-start"
  | "fetch-success"
  | "fetch-error"
  | "state-write"
  | "done";

function logPhase(phase: FetchPhase, data?: any) {
  dbg(`${ts()} ${phase}`, data ?? "");
}

// Shallow serialization of only relevant fields (kept stable across sessions)
export function shallowSnapshot(template: ShipmentTemplate): string {
  // Truck/freight options (tail lift, box truck) are part of the getRates payload
  // (tailgate/boxTruck) and change the carrier price, so they must be part of the
  // snapshot — otherwise toggling them wouldn't trigger a rate refetch.
  const t = template.shipmentOptions?.truckShipmentInfo;
  return JSON.stringify({
    shipper: template.shipperAddress,
    recipient: template.recipientAddress,
    packages: template.packages.map((p) => ({
      type: p.type,
      length: p.length,
      width: p.width,
      height: p.height,
      weight: p.weight,
    })),
    truck: t
      ? {
          shipperTaillift: !!t.shipperTaillift,
          recipientTaillift: !!t.recipientTaillift,
          shipperVehicle: t.shipperVehicle,
          recipientVehicle: t.recipientVehicle,
        }
      : null,
  });
}

/** v1's B_getRates-adres/pakket-suite — nu injecteerbaar (provider.readiness). */
export type ShipmentReadinessSuite = {
  validateShipperAddress: (address: any) => ValidationResult;
  validateRecipientAddress: (address: any) => ValidationResult;
  validatePackages: (packages: any[]) => ValidationResult[];
};

function shipmentReadyToFetch(
  s: ShipmentTemplate,
  readiness?: ShipmentReadinessSuite,
): boolean {
  if (!s.packages?.length) return false;
  if (readiness) {
    if (!readiness.validateShipperAddress(s.shipperAddress!).valid) return false;
    if (!readiness.validateRecipientAddress(s.recipientAddress!).valid) return false;
    if (readiness.validatePackages(s.packages).some((r) => !r.valid)) return false;
    return true;
  }
  // Conservatieve fallback zonder provider-suite: niet fetchen op halflege data.
  const addrOk = (a: ShipmentTemplate["shipperAddress"]) =>
    !!a && !!a.country && !!a.city && !!a.street?.[0];
  if (!addrOk(s.shipperAddress) || !addrOk(s.recipientAddress)) return false;
  return s.packages.every(
    (p) => !!p.type && p.length > 0 && p.width > 0 && p.height > 0 && p.weight > 0,
  );
}

/** Proxy-RateOption → canonieke Rating. Passthrough eerst: zodra de proxy
 *  verrijkte velden meestuurt (reusableData, transitTime, accessPoints, …)
 *  stromen ze automatisch door. */
function toRating(o: RateOption): Rating {
  return {
    ...(o as Record<string, unknown>),
    carrier: o.carrier,
    service: o.service,
    price: String(o.price),
    // TODO(proxy-rates-verrijking): reusableData, transitTime, accessPoints,
    // pickupDate/pickupTime, deliveryDate/deliveryTime, availablePickupDates,
    // imgUrl, serviceDescription komen nog niet uit de proxy → undefined tenzij
    // de proxy ze al meegeeft via de index-signature van RateOption.
    reusableData: (o as any).reusableData,
  } as Rating;
}

/** ==== Global exclusions ================================================== */

type Exclusions = {
  meta: Record<string, true | undefined>; // Service-level: `${carrier}|${service}`
  instances: Record<string, true | undefined>; // Instance-level (fingerprint)
};

function readExclusions(): Exclusions {
  const ex =
    globalPreferences?.serviceAvailability?.exclusions ??
    ({ meta: {}, instances: {} } as Exclusions);
  const meta = ex?.meta && typeof ex.meta === "object" ? ex.meta : {};
  const instances =
    ex?.instances && typeof ex.instances === "object" ? ex.instances : {};
  return { meta, instances };
}

// Matches your catalog: `${CC}_${TYPE}_${CARRIER}_${SERVICE_WITH_UNDERSCORES}`
function computeFingerprint(
  origin: string | undefined,
  destination: string | undefined,
  type: string | undefined,
  carrier: string,
  service: string
) {
  if (!origin || !destination || !type) return "";
  const svc = service.trim().replace(/\s+/g, "_");
  return `${origin}_${destination}_${type}_${carrier}_${svc}`;
}

export function applyRateExclusions(
  rates: Rating[],
  snapshot: {
    shipperAddress?: {country?: string};
    recipientAddress?: { country?: string };
    packages?: { type?: string }[];
  }
): { kept: Rating[]; dropped: number } {
  const { meta, instances } = readExclusions();
  const origin = snapshot?.shipperAddress?.country || "";
  const destination = snapshot?.recipientAddress?.country || "";
  const type = snapshot?.packages?.[0]?.type || "";

  const kept: Rating[] = [];
  let dropped = 0;

  for (const r of rates) {
    // TODO(proxy-rates-verrijking): fail-soft — zonder reusableData vallen we
    // terug op de top-level carrier/service van de proxy-rate (v1 las hard
    // reusableData.choose_carrier/choose_service).
    const carrier = r.reusableData?.choose_carrier ?? r.carrier;
    const service = r.reusableData?.choose_service ?? r.service;
    const key = `${carrier}|${service}`;
    if (meta[key]) {
      dropped++;
      continue;
    }
    const fp = computeFingerprint(
      origin,
      destination,
      type,
      carrier,
      service
    );
    if (fp && instances[fp]) {
      dropped++;
      continue;
    }
    kept.push(r);
  }
  return { kept, dropped };
}

/** ==== Debug-oppervlak (v1: window.__rateDebug) ============================ */

// TODO(window-globals): v1 hing dit aan window.__rateDebug; nu module-state.
// De laatst gestarte autoFetchRates-instantie registreert zich hier.
export const rateFetcherDebug: {
  current: null | {
    readonly state: {
      inFlight: boolean;
      lastSnapshot: string | null;
      fetchCount: number;
      skipStats: Record<string, number>;
    };
    forceFetch(): void;
    clearCache(): void;
  };
} = { current: null };

/** ==== Core =============================================================== */

export function autoFetchRates(
  shipmentStore: Writable<ShipmentTemplate>,
  fieldValidityStore: Readable<Record<string, boolean>>,
  delay = 800,
  readiness?: ShipmentReadinessSuite
) {
  // Seed lastSnapshot from the store when rates are already valid (e.g. extra-info re-open)
  // so the first subscriber call doesn't start a redundant 40+ second fetch.
  const _seed = get(shipmentStore);
  let lastSnapshot: string | null = (_seed as any).ratesHash ? shallowSnapshot(_seed) : null;
  let inFlight = false;
  let fetchCount = 0;
  let skipStats = {
    packagesInvalid: 0,
    inFlight: 0,
    noChange: 0,
  };

  const tryFetch = debounceWithMaxWait(
    async () => {
      logPhase("debounced-try");

      const snapshotObj = get(shipmentStore);
      logPhase("pre-check", {
        inFlight,
        hasPackages: snapshotObj.packages?.length,
      });

      if (!shipmentReadyToFetch(snapshotObj, readiness)) {
        skipStats.packagesInvalid++;
        logPhase("pre-check", {
          skip: "shipment-not-ready",
          count: skipStats.packagesInvalid,
        });
        return;
      }

      const hash = shallowSnapshot(snapshotObj);
      if (hash !== lastSnapshot) {
        logPhase("snapshot-change", {
          changed: diffSnapshots(lastSnapshot, hash),
        });
        // Only clear rates if they're stale (ratesHash doesn't match the current snapshot).
        // If ratesHash === hash, the store already has valid rates for this snapshot —
        // skip the clear so re-opened modals (extra info path) don't lose their rates.
        const currentRatesHash = (snapshotObj as any).ratesHash;
        if (currentRatesHash !== hash) {
          shipmentStore.update((s) => ({
            ...s,
            rates: [],
            ratesHash: undefined,
            shipmentOptions: s.shipmentOptions
              ? {
                  ...s.shipmentOptions,
                  chosenRate: {
                    carrier: "",
                    service: "",
                    price: "",
                    reusableData: undefined,
                  },
                }
              : s.shipmentOptions,
          }));
          rateFetchStart.set(null);
        }
      }

      if (inFlight) {
        skipStats.inFlight++;
        logPhase("skip-inflight", { count: skipStats.inFlight });
        return;
      }

      if (hash === lastSnapshot) {
        skipStats.noChange++;
        logPhase("skip-nochange", { count: skipStats.noChange });
        return;
      }

      inFlight = true;
      lastSnapshot = hash;

      try {
        const label = `getRates#${++fetchCount}`;
        const start = performance.now();
        rateFetchStart.set(start);
        logPhase("fetch-start", { label, cacheKey: `__rates__${hash}` });

        const cacheKey = `__rates__${hash}`;
        let result: RateOption[];

        if (
          USE_CACHE &&
          typeof window !== "undefined" &&
          sessionStorage.getItem(cacheKey)
        ) {
          if ((import.meta as any).env?.__BUILDTARGET__ === "PROD") {
            throw new Error("🚨 Cached getRates result used in production!");
          }
          logPhase("cache-hit", { cacheKey });
          result = JSON.parse(sessionStorage.getItem(cacheKey)!);
        } else {
          logPhase("cache-miss", { cacheKey });

          const fetchStartMs = Date.now();
          console.group(`[rateFetcher] ${label} — snapshot used for /api/rates`);
          console.log("[rateFetcher] shipperAddress:", JSON.stringify(snapshotObj.shipperAddress));
          console.log("[rateFetcher] recipientAddress:", JSON.stringify(snapshotObj.recipientAddress));
          console.log("[rateFetcher] packages:", JSON.stringify(snapshotObj.packages));
          console.log(`[rateFetcher] fetch started at ${fetchStartMs} (${new Date(fetchStartMs).toISOString()})`);
          console.groupEnd();
          console.time(label);
          const releaseSlot = await acquireRateSlot(cacheKey);
          try {
            // PROXY-FIRST: v1 deed hier `getRates(snapshotObj)` (browser→portaal);
            // nu de tenant-proxy via ratesClient.
            result = await fetchRates(snapshotObj);
          } finally {
            releaseSlot();
          }
          console.timeEnd(label);
          console.log(`[rateFetcher] ${label} completed in ${Date.now() - fetchStartMs}ms`);

          if (
            typeof window !== "undefined" &&
            (import.meta as any).env?.__BUILDTARGET__ !== "PROD" &&
            USE_CACHE
          ) {
            sessionStorage.setItem(cacheKey, JSON.stringify(result));
          }
        }

        // Apply global exclusions (service-level + instance-level)
        // v1: result.result — de proxy retourneert de array direct.
        const incoming: Rating[] = Array.isArray(result)
          ? result.map(toRating)
          : [];
        const { kept, dropped } = applyRateExclusions(incoming, snapshotObj);
        if (dropped)
          dbg(`${ts()} 🚫 excluded ${dropped} rate(s) by global config`);

        const duration = Math.round(performance.now() - start);
        dbg(`${ts()} 📡 ${label} completed in ${duration}ms`);

        await tick();
        const nowHash = shallowSnapshot(get(shipmentStore));
        if (nowHash === hash) {
          logPhase("state-write", { rates: kept.length });
          shipmentStore.update((s) => ({
            ...s,
            rates: kept,
            ratesHash: hash,
          }));
        } else {
          logPhase("state-write", { skipped: "snapshot-changed-during-fetch" });
        }

        logPhase("fetch-success", { label, durationMs: duration });
      } catch (err: any) {
        logPhase("fetch-error", { message: err?.message, stack: err?.stack });
        toast.error("Rate fetch failed: " + (err?.message ?? "Unknown error"));
      } finally {
        inFlight = false;
        logPhase("done", { inFlight });
      }
    },
    delay,
    2000
  );

  shipmentStore.subscribe((s) => {
    const snap = shallowSnapshot(s);
    group("shipment-change", () => {
      logPhase("shipment-change", {
        changed: diffSnapshots(lastSnapshot, snap),
      });
    });
    tryFetch();
  });

  fieldValidityStore.subscribe(() => {
    tryFetch();
  });

  rateFetcherDebug.current = {
    get state() {
      return {
        inFlight,
        lastSnapshot,
        fetchCount,
        skipStats: { ...skipStats },
      };
    },
    forceFetch() {
      dbg("🔧 manual forceFetch()");
      lastSnapshot = null;
      tryFetch();
    },
    clearCache() {
      if (!USE_CACHE) return dbg("🔧 cache disabled (USE_CACHE=false)");
      const keys = Object.keys(sessionStorage).filter((k) =>
        k.startsWith("__rates__")
      );
      keys.forEach((k) => sessionStorage.removeItem(k));
      dbg("🔧 cleared rate cache keys:", keys.length);
    },
  };
  dbg("✅ rateFetcherDebug.current available (state, forceFetch, clearCache)");
}
