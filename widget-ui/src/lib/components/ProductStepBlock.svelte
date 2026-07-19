<script lang="ts">
  // Geport uit v1 ProductStepBlock.svelte. Wijzigingen (widget-extractie):
  // - provider-prop (WidgetProviderLayer) doorgegeven aan SkeletonContainer
  //   (grid-validators + domein uit de fabriek-emit i.p.v. generated imports)
  // - order is optioneel (standalone tenants hebben geen webshop-order; het
  //   seed-blok deed al niets zonder order — v1-guard behouden)
  import { onMount } from "svelte";
  import type { EnrichedOrder } from "../types/webshop";
  import type {
    ShipmentTemplate,
    ProductTemplate,
    ProductProfile,
  } from "../types/config";
  import type { WidgetProviderLayer } from "../providers/types";
  import type { Writable } from "svelte/store";
  import { get, derived } from "svelte/store";
  import { fetchProductProfiles } from "../api/productProfiles";
  import SkeletonContainer from "./SkeletonContainer.svelte";

  export let order: EnrichedOrder | null = null;
  export let shipment: Writable<ShipmentTemplate>;
  export let userId: string;
  export let provider: WidgetProviderLayer;

  const mockCategories = ["Products"];

  // Per-SKU data the user confirmed on earlier bookings (HS code, origin,
  // weight, value). Loaded async; applied as fallback both at seed time and in
  // a one-off merge pass for products that were seeded before it arrived.
  let productProfiles: Record<string, ProductProfile> = {};

  onMount(async () => {
    productProfiles = await fetchProductProfiles(userId);
    if (Object.keys(productProfiles).length) applyProfileFallbacks();
  });

  function profileFor(sku: string | undefined): ProductProfile | undefined {
    return sku ? productProfiles[sku] : undefined;
  }

  // Fill gaps in existing products from the learned profiles. Only touches
  // fields the user hasn't filled: empty HS code, zero weight/value — plus the
  // hardcoded "NL" origin default when the profile carries a confirmed origin.
  function applyProfileFallbacks() {
    shipment.update((s) => {
      if (!s.products?.length) return s;

      let changed = false;
      const products = s.products.map((p) => {
        const profile = profileFor(p.sku);
        if (!profile) return p;

        const next = { ...p };
        if (!next.hsCode && profile.hsCode) {
          next.hsCode = profile.hsCode;
          changed = true;
        }
        if ((!next.weight || next.weight <= 0) && profile.weight) {
          next.weight = profile.weight;
          changed = true;
        }
        if ((!next.value || next.value <= 0) && profile.value) {
          next.value = profile.value;
          changed = true;
        }
        if (
          profile.originCountry &&
          (!next.originCountry || next.originCountry === "NL") &&
          profile.originCountry !== next.originCountry
        ) {
          next.originCountry = profile.originCountry;
          changed = true;
        }
        return next;
      });

      return changed ? { ...s, products } : s;
    });
  }

  $: {
    const current = get(shipment);
    if (current && order) {
      const skusInTemplate = new Set(current?.products?.map((p) => p.sku));
      // Respect user removals — if the user explicitly deleted a product from this
      // shipment, its SKU lives on `shipment.removedProductSkus` and must not be
      // re-added the next time this reactive block runs.
      const removed = new Set<string>(
        ((current as any)?.removedProductSkus ?? []) as string[],
      );
      const missing = order.orderedItems.filter(
        (item) => !skusInTemplate.has(item.sku) && !removed.has(item.sku),
      );

      if (missing.length > 0) {
        shipment.update((s) => ({
          ...s,
          products: [
            ...missing.map((item) => {
              const profile = profileFor(item.sku);
              return {
                sku: item.sku,
                name: item.name,
                description: item.description ?? item.name,
                hsCode: item.hsCode || profile?.hsCode,
                value: item.value ?? profile?.value ?? 0,
                weight: parseFloat(item.weight ?? "0") || profile?.weight || 0,
                originCountry: profile?.originCountry ?? "NL",
                quantity: item.quantity ?? 1,
                category:
                  mockCategories[
                    Math.floor(Math.random() * mockCategories.length)
                  ],
                send: true,
                materials: [],
                currency: "EUR" as const,
                createdAt: "",
                updatedAt: "",
              };
            }),
            ...(s.products || []),
          ],
        }));
      }
    }
  }

  const categories = derived(shipment, ($shipment) => {
    const map = new Map<string, ProductTemplate[]>();

    for (const product of $shipment.products ?? []) {
      const cat = product.category ?? "Uncategorized";
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(product);
    }

    return Array.from(map.entries());
  });
</script>

<div class="w-full text-sm text-gray-800 space-y-8">
  <SkeletonContainer categories={$categories} {shipment} {userId} {provider} />
</div>
