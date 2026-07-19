// chooseOption via de widget-proxy (PROXY-FIRST): de widget stuurt de gekozen rate
// naar /api/choose op de tenant-base; de server draait het portaalpad (v1: browser→TFF
// C_chooseOption via authFetch) op zijn eigen sessie en retourneert de sessionKey
// (bv. "srk-2"). Tegenhanger van v1's api/chooseOption.chooseOptionAndPatchShipment —
// de store-patch gebeurt hier bewust NIET; de aanroeper (ShipStepBlock.selectRate)
// schrijft sessionKey/__chooseOptionLoading/__chooseOptionError zelf, net als v1's
// post-chooseOption update.

import { apiBaseUrl } from "./global";

export async function chooseOption(rate: any): Promise<{ sessionKey: string }> {
  const res = await fetch(`${apiBaseUrl}/api/choose`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chosenRate: rate }),
  });

  const body: any = await res.json().catch(() => null);

  if (!res.ok) {
    throw new Error(body?.message ?? body?.error ?? `choose faalde: ${res.status}`);
  }

  return body ?? { sessionKey: "" };
}
