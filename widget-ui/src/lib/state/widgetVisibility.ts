// Geport uit v1 src/lib/state/widgetVisibility.ts. Wijzigingen: geen — localStorage
// zit binnen functies achter try/catch (SSR-veilig); initWidgetVisibility wordt in v2
// vanuit Widget's onMount aangeroepen (browser-only), niet bij component-init.

import { writable } from "svelte/store";

export const widgetHidden = writable<boolean>(false);

let storageKey = "inset:hidden";

function readInitial(): boolean {
  try {
    return localStorage.getItem(storageKey) === "1";
  } catch {
    return false;
  }
}

/** Call once at boot with the resolved userId. Seeds the store from localStorage and persists
 *  every change back. */
export function initWidgetVisibility(userId: string): void {
  storageKey = `inset:hidden:${userId || "anon"}`;
  widgetHidden.set(readInitial());
  widgetHidden.subscribe((hidden) => {
    try {
      localStorage.setItem(storageKey, hidden ? "1" : "0");
    } catch {}
  });
}

export function hideWidget(): void {
  widgetHidden.set(true);
}

export function showWidget(): void {
  widgetHidden.set(false);
}
