// Rates via de widget-proxy (PROXY-FIRST): de widget stuurt het canonieke
// zendingsmodel naar /api/rates op de tenant-base; de server draait transform +
// sessiepool tegen het portaal. Vervangt v1's browser→portaal-pad (authFetch op de
// host-pagina) — creds en sessies blijven serverside.

import { apiBaseUrl } from "./global";
import type { ShipmentTemplate } from "../types/config";

export interface RateOption {
  carrier: string;
  service: string;
  price: number;
  [k: string]: unknown;
}

export async function fetchRates(shipment: ShipmentTemplate): Promise<RateOption[]> {
  const res = await fetch(`${apiBaseUrl}/api/rates`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ shipment }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error((body as any)?.error ?? `rates faalde: ${res.status}`);
  }
  const data = (await res.json()) as { rates?: RateOption[] };
  return data.rates ?? [];
}
