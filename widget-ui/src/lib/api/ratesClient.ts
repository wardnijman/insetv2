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

// Tegenhanger van v1's authFetch-timeoutMs (getRates-hang-fix): een dode proxy of
// hangende portaal-sessie mag de widget nooit oneindig laten wachten.
const RATES_TIMEOUT_MS = 45_000;

export async function fetchRates(shipment: ShipmentTemplate): Promise<RateOption[]> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), RATES_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${apiBaseUrl}/api/rates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shipment }),
      signal: ctl.signal,
    });
  } catch (e) {
    throw ctl.signal.aborted ? new Error(`rates-timeout na ${RATES_TIMEOUT_MS / 1000}s`) : (e as Error);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error((body as any)?.error ?? `rates faalde: ${res.status}`);
  }
  const data = (await res.json()) as { rates?: RateOption[] };
  return data.rates ?? [];
}
