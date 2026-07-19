// Geport uit v1 src/lib/state/orders.ts. Wijzigingen: de orders-BRON is proxy-first —
// v1 haalde uit /api/orders/get + /api/orders/search op de client-app; v2 heeft (interim)
// één route GET ${apiBaseUrl}/api/orders?userId=... (lege lijst tot de webshop-sync is
// bedraad). search geeft q/tokens als query-params mee zodat de server ze later kan
// honoreren zonder client-wijziging. reqId-guard (laatste verzoek wint) is v1-verbatim.

import { writable } from "svelte/store";
import type { EnrichedOrder } from "../types/webshop";
import { apiBaseUrl } from "../api/global";
import type { Token } from "../types/search";

function createOrderStore() {
  const { subscribe, set, update } = writable<EnrichedOrder[]>([]);
  let reqId = 0;

  async function doSearch(userId: string, query: string, tokens: Token[]) {
    const my = ++reqId;
    const url = new URL(`${apiBaseUrl}/api/orders`);
    url.searchParams.set("userId", userId);
    url.searchParams.set("q", query || "");
    url.searchParams.set("tokens", JSON.stringify(tokens || []));
    const res = await fetch(url.toString());
    if (res.ok) {
      const data = await res.json();
      if (my === reqId) set(Array.isArray(data) ? data : []);
    }
  }

  async function doRefresh(userId: string) {
    const my = ++reqId;
    const res = await fetch(`${apiBaseUrl}/api/orders?userId=${encodeURIComponent(userId)}`);
    if (res.ok) {
      const data = await res.json();
      if (my === reqId) set(Array.isArray(data) ? data : []);
    }
  }

  return {
    subscribe,
    set,
    replaceAll: set,
    updateShipment(orderId: string, shipment: any) {
      update((orders) =>
        orders.map((o) =>
          o.orderId === orderId ? { ...o, shipment: { ...shipment } } : o
        )
      );
    },
    setCreating(orderId: string) {
      update((orders) =>
        orders.map((o) =>
          o.orderId === orderId
            ? {
                ...o,
                shipment: {
                  ...o.shipment!,
                  status: "CREATING",
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                },
              }
            : o
        )
      );
    },
    refresh: doRefresh,
    search: doSearch,
  };
}

export const orders = createOrderStore();
