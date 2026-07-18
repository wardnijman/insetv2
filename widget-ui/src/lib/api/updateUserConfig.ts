// Geport uit v1 api/updateUserConfig.ts — alleen de config-persist zelf. v1's
// setPreferredLanguage/reinjectWidget zijn host-injectie-mechaniek (TFF-scriptlader);
// taalwissel wordt in v2 tenant-config + her-mount en volgt met de loader-slice.
// Fail-soft als v1: een persist-fout mag de wizard nooit blokkeren.

import { apiBaseUrl } from "./global";

export async function updateUserConfig(
  path: string,
  value: any,
  userId: string,
) {
  try {
    await fetch(`${apiBaseUrl}/api/config/update`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId,
        update: { [path]: value },
      }),
    });
  } catch (err) {
    console.error("❌ Failed to persist config update", err);
  }
}
