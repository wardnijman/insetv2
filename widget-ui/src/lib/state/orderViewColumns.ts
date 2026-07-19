// Geport uit v1 src/lib/state/orderViewColumns.ts. Wijzigingen: geen — updateUserConfig
// is de al-geporte v2-variant (proxy /api/config/update, fail-soft), localStorage zit
// achter de hasLS-guard (SSR-veilig).

import { writable, type Writable } from "svelte/store";
import { updateUserConfig } from "../api/updateUserConfig";
import { DEFAULT_VISIBLE } from "../components/orderViewFields";

export type Columns = Record<string, boolean>;
export type API = {
  toggle: (k: keyof Columns) => void;
  reset: () => void;
};
const singletons = new Map<string, Writable<Columns> & API>();

const hasLS = typeof localStorage !== "undefined";
const readLS = (key: string): Columns | null => {
  if (!hasLS) return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Columns) : null;
  } catch {
    return null;
  }
};

export function createOrderViewColumns(
  userId: string,
  seed?: Partial<Columns> // injected prefs from user config (init only)
): Writable<Columns> & API {
  if (singletons.has(userId)) return singletons.get(userId)!;

  const key = `ov.columns.${userId}`;
  const fromLS = readLS(key);

  // precedence: DEFAULTS < seed < localStorage
  const initial: Columns = {
    ...DEFAULT_VISIBLE,
    ...(seed ?? {}),
    ...(fromLS ?? {}),
  };

  const base = writable<Columns>(initial);

  let flush: any;
  const persist = (v: Columns) => {
    if (hasLS) localStorage.setItem(key, JSON.stringify(v));
    clearTimeout(flush);
    flush = setTimeout(() => {
      void updateUserConfig("preferences.ui.orderOverview.columns", v, userId).catch(() => {});
    }, 350);
  };

  // WRAPPED set/update so *every* external change persists
  const subscribe = base.subscribe;
  const set = (v: Columns) => {
    persist(v);
    base.set(v);
  };
  const update = (fn: (v: Columns) => Columns) => {
    let next: Columns;
    base.update((curr) => (next = fn(curr)));
    persist(next!);
  };

  const api: API = {
    toggle: (k) =>
      update((v) => {
        const next = { ...v, [k]: !v[k] };
        return next;
      }),
    reset: () => set({ ...DEFAULT_VISIBLE }),
  };

  const store = { subscribe, set, update, ...api } as Writable<Columns> & API;
  singletons.set(userId, store);
  return store;
}
