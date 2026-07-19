// Geport uit v1 src/lib/stores/announcements.ts. Wijzigingen: geen — updateUserConfig
// is de v2-proxyvariant (fail-soft), userPreferences-singleton is de al-geporte v2-module.

// Announcement balloons — "Nieuw!" pointers that introduce new features.
//
// Model:
// - Every <AnnouncementBalloon> in the tree self-registers with an `id` + `order`.
// - At any moment exactly one balloon is visible: the lowest `order` among registered
//   balloons whose `id` is not in the dismissed map. Dismiss one → the next becomes
//   active automatically. That's how "consecutive" reveal works.
// - Dismissals persist in user config at `preferences.dismissedAnnouncements` as
//   `{ [id]: <ISO timestamp> }`. Presence = dismissed forever. A re-render or a new
//   session can never re-show it.
//
// Why a writable + derived rather than reading userPreferences directly each render:
// the widget's `userPreferences` is a module-level singleton (not a Svelte store), so
// it doesn't trigger reactivity by itself. We seed this store from that singleton at
// boot and keep both sides in sync on dismiss so other widget code (which reads the
// raw singleton) sees the new dismissal immediately.

import { derived, get, writable, type Readable } from "svelte/store";
import { updateUserConfig } from "../api/updateUserConfig";
import { userPreferences, setUserPreferences } from "../state/userPreferences";

export type AnnouncementRegistration = {
  id: string;
  order: number;
};

const registered = writable<AnnouncementRegistration[]>([]);
const dismissed = writable<Record<string, string>>({});

/** Seed dismissed map from the userPreferences singleton. Safe to call multiple times. */
export function initAnnouncements(): void {
  const initial =
    (userPreferences?.dismissedAnnouncements as Record<string, string>) ?? {};
  dismissed.set({ ...initial });
}

export function register(reg: AnnouncementRegistration): void {
  registered.update((list) => {
    if (list.some((r) => r.id === reg.id)) return list;
    return [...list, reg];
  });
}

export function unregister(id: string): void {
  registered.update((list) => list.filter((r) => r.id !== id));
}

/**
 * The id that should currently be displayed, or `null` if none. Recomputes whenever
 * either the registered list or the dismissed map changes — so the next-in-queue
 * pops up the instant the active one is dismissed.
 */
export const activeAnnouncementId: Readable<string | null> = derived(
  [registered, dismissed],
  ([$registered, $dismissed]) => {
    const sorted = [...$registered].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    for (const r of sorted) {
      if (!$dismissed[r.id]) return r.id;
    }
    return null;
  },
);

/** Local-only check — true if `id` was already dismissed before mount. Used to skip
 *  registering balloons that nothing will ever show, saving us a render. */
export function isDismissed(id: string): boolean {
  return Boolean(get(dismissed)[id]);
}

/**
 * Mark an announcement as dismissed. Updates the local store synchronously (so the
 * next balloon shows immediately), mirrors the change into the userPreferences
 * singleton, and fires off the server save in the background.
 */
export function dismiss(userId: string, id: string): void {
  const ts = new Date().toISOString();

  dismissed.update((m) => {
    if (m[id]) return m;
    return { ...m, [id]: ts };
  });

  // Mirror into the singleton so any other widget code reading it sees the update.
  const prevMap = (userPreferences?.dismissedAnnouncements as Record<string, string>) ?? {};
  const nextMap = { ...prevMap, [id]: ts };
  setUserPreferences({
    ...(userPreferences ?? {}),
    dismissedAnnouncements: nextMap,
  });

  void updateUserConfig("preferences.dismissedAnnouncements", nextMap, userId).catch(() => {
    // Soft failure: balloon stays dismissed for this session. Next page load will
    // re-fetch userPreferences from the server, so if the write didn't land, the
    // balloon may reappear — which is the right behavior (user retries the dismiss).
  });
}
