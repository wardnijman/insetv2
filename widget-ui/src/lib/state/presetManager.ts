// Geport uit v1 src/lib/state/presetManager.ts. Wijzigingen: fail-soft — de proxy heeft
// (nog) geen /api/widget-init, dus een mislukte fetch laat de stores gewoon leeg i.p.v.
// een unhandled rejection bij widget-boot. TODO(order-flow): route toevoegen zodra
// presets/defaults serverside bestaan.

import { writable } from "svelte/store";
import { apiBaseUrl } from "../api/global";

export const allPresets = writable<Record<string, Record<string, any>>>({});
export const allDefaults = writable<Record<string, string[]>>({});

export async function initializePresets(userId: string) {
  try {
    const res = await fetch(`${apiBaseUrl}/api/widget-init?userId=${encodeURIComponent(userId)}`);
    if (!res.ok) return;
    const { presets, defaults } = await res.json();

    allPresets.set(presets ?? {});
    allDefaults.set(defaults ?? {});
  } catch {
    // fail-soft: presets zijn een verrijking, geen voorwaarde om te renderen
  }
}
