// Geport uit v1 src/lib/api/productProfiles.ts. Wijzigingen: geen.

// Client for the per-SKU product-profile store (learned customs data:
// HS code, origin country, weight, value). Auth headers are injected by the
// authFetch monkey-patch (Widget.svelte resolveFetchPolicy) — same pattern as
// updateUserConfig.

import { apiBaseUrl } from "./global";
import type { ProductProfile, ProductTemplate } from "../types/config";

/**
 * Fetch all learned profiles for this user. Returns {} on any failure —
 * profile data is a nicety; the customs grid must render without it.
 */
export async function fetchProductProfiles(
  userId: string,
): Promise<Record<string, ProductProfile>> {
  try {
    const res = await fetch(
      `${apiBaseUrl}/api/product-profiles/get?userId=${encodeURIComponent(userId)}`,
    );
    if (!res.ok) return {};
    const data = await res.json();
    return data?.profiles ?? {};
  } catch (err) {
    console.warn("Could not load product profiles", err);
    return {};
  }
}

/**
 * Fire-and-forget write-back of confirmed product data after a successful
 * booking. The server merges per field, so partial data never wipes an
 * earlier learned value.
 */
export function learnProductProfiles(
  userId: string,
  products: ProductTemplate[],
): void {
  const usable = (products ?? []).filter((p) => p?.sku);
  if (!usable.length) return;

  void fetch(`${apiBaseUrl}/api/product-profiles/learn`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, products: usable }),
  }).catch((err) => {
    console.warn("Could not persist product profiles", err);
  });
}
