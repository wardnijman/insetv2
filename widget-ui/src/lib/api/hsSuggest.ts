// Geport uit v1 src/lib/api/hsSuggest.ts. Wijzigingen: geen.

// Client for the AI HS-code suggester (POST /api/ai/suggest-hs). One batched
// call per customs grid covers every product that is still missing a code
// after the learned product-profiles were applied. Suggestions are a nicety:
// they are surfaced as ghost text / a popover and must be explicitly accepted
// by the user — never silently submitted. Auth headers are injected by the
// authFetch monkey-patch (Widget.svelte resolveFetchPolicy).

import { writable } from "svelte/store";
import { apiBaseUrl } from "./global";
import type { ProductTemplate } from "../types/config";

export type HsSuggestion = {
  sku: string;
  hsCode: string; // digits only; "" when the model had no responsible suggestion
  confidence: "high" | "medium" | "low";
  note: string; // one short Dutch sentence explaining the classification
};

type HsSuggestState = {
  loading: boolean;
  bySku: Record<string, HsSuggestion>;
};

// Module-level so suggestions survive wizard close/reopen within the session —
// the same SKU never triggers a second network call (the server caches too).
export const hsSuggestions = writable<HsSuggestState>({
  loading: false,
  bySku: {},
});

// SKUs we already asked about, including ones that came back empty — so a
// no-suggestion product isn't re-sent on every grid open.
const requestedSkus = new Set<string>();
let inFlight = false;

/**
 * Batch-request suggestions for every product that still lacks an HS code.
 * Fire-and-forget semantics: failures are swallowed (the grid must work
 * without AI) and rate limiting simply means no ghost text this time.
 */
export async function requestHsSuggestions(
  userId: string,
  products: ProductTemplate[],
): Promise<void> {
  if (inFlight || !userId) return;

  const missing = (products ?? []).filter(
    (p) =>
      p?.sku &&
      p?.name &&
      !p.hsCode &&
      !requestedSkus.has(p.sku),
  );
  if (!missing.length) return;

  missing.forEach((p) => requestedSkus.add(p.sku));
  inFlight = true;
  hsSuggestions.update((s) => ({ ...s, loading: true }));

  try {
    const res = await fetch(`${apiBaseUrl}/api/ai/suggest-hs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId,
        products: missing.map((p) => ({
          sku: p.sku,
          name: p.name,
          description: p.description || undefined,
          materials: p.materials?.length ? p.materials : undefined,
        })),
      }),
    });

    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok || !Array.isArray(data.suggestions)) {
      // Allow a retry on the next grid open when the call failed outright
      // (rate limit, AI not configured, network) — nothing was learned.
      missing.forEach((p) => requestedSkus.delete(p.sku));
      return;
    }

    const additions: Record<string, HsSuggestion> = {};
    for (const s of data.suggestions as HsSuggestion[]) {
      if (s?.sku && s.hsCode) additions[s.sku] = s;
    }
    if (Object.keys(additions).length) {
      hsSuggestions.update((state) => ({
        ...state,
        bySku: { ...state.bySku, ...additions },
      }));
    }
  } catch (err) {
    console.warn("HS suggestions unavailable", err);
    missing.forEach((p) => requestedSkus.delete(p.sku));
  } finally {
    inFlight = false;
    hsSuggestions.update((s) => ({ ...s, loading: false }));
  }
}

// ── Interactive search ──────────────────────────────────────────────────────
// Typing in the HS field searches by code prefix or product description
// (POST /api/ai/search-hs). Results are cached per query+context so cursoring
// back and forth over the same text never re-hits the network.

export type HsSearchResult = {
  hsCode: string;
  description: string; // short plain-Dutch description of the category
};

const searchCache = new Map<string, HsSearchResult[]>();

export async function searchHsCodes(
  userId: string,
  query: string,
  product?: { name?: string; description?: string },
): Promise<HsSearchResult[]> {
  const key = `${query.toLowerCase()}::${product?.name ?? ""}`;
  const cached = searchCache.get(key);
  if (cached) return cached;

  try {
    const res = await fetch(`${apiBaseUrl}/api/ai/search-hs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, query, product }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok || !Array.isArray(data.results)) return [];

    const results = (data.results as HsSearchResult[]).filter((r) => r?.hsCode);
    if (searchCache.size > 200) searchCache.clear();
    searchCache.set(key, results);
    return results;
  } catch {
    return [];
  }
}
