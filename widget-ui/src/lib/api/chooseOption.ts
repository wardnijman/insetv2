// chooseOption via de widget-proxy (PROXY-FIRST): de widget stuurt de gekozen rate
// naar /api/choose op de tenant-base; de server draait het portaalpad (v1: browser→TFF
// C_chooseOption via authFetch) op zijn eigen sessie en retourneert de sessionKey
// (bv. "srk-2") plus — als het portaal ze op de final page toont — accessPoints en
// paperlessAvailable (v1's dotted-path-patchvelden "shipmentOptions.chosenRate.
// accessPoints" / "shipmentOptions.paperlessAvailable"). Tegenhanger van v1's
// api/chooseOption.chooseOptionAndPatchShipment — de store-patch gebeurt hier bewust
// NIET; de aanroeper (ShipStepBlock.selectRate) schrijft sessionKey/accessPoints/
// paperlessAvailable/__chooseOptionLoading/__chooseOptionError zelf, net als v1's
// post-chooseOption update.

import { apiBaseUrl } from "./global";

export type ChooseOptionResult = {
  sessionKey: string;
  /** Alleen aanwezig als de final page een access-point-rij had (v1-conditie). */
  accessPoints?: any[];
  /** Alleen aanwezig als de server het paperless-signaal kon bepalen. */
  paperlessAvailable?: boolean;
};

export async function chooseOption(rate: any): Promise<ChooseOptionResult> {
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
