// Geport uit v1 src/lib/state/orderFilters.ts. Wijzigingen: geen (localStorage-toegang
// zit al achter typeof-guards, dus SSR-veilig).

import type { Token } from "../types/search";

const VERSION = 3;
const key = (userId: string) => `plugtech:orderFilters:v${VERSION}:${userId}`;

const ALLOWED = new Set<Token["type"]>(["status", "platform", "date", "depth"]);

export function loadOrderFilters(
  userId: string
): { query: string; tokens: Token[] } | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(key(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);

    const tokens: Token[] = Array.isArray(parsed?.tokens)
      ? parsed.tokens
          .filter((t: any) => t && ALLOWED.has(t.type))
          .map((t: any) => {
            if (t.type === "status" || t.type === "platform") {
              return { ...t, values: Array.isArray(t.values) ? t.values : [] };
            }
            if (t.type === "date") {
              const mode = t.mode === "updated" ? "updated" : "created";
              return { ...t, mode, from: t.from ?? "", to: t.to ?? "" };
            }
            if (t.type === "depth") {
              const value = (["current","year","all"].includes(t.value) ? t.value : "current") as any;
              return { id:"depth", type:"depth", value };
            }
            return t as Token;
          })
      : [];

    return { query: String(parsed?.query ?? ""), tokens };
  } catch {
    return null;
  }
}

export function saveOrderFilters(userId: string, data: { query: string; tokens: Token[] }) {
  if (typeof localStorage === "undefined") return;
  try { localStorage.setItem(key(userId), JSON.stringify(data)); } catch {}
}

export function clearOrderFilters(userId: string) {
  if (typeof localStorage === "undefined") return;
  try { localStorage.removeItem(key(userId)); } catch {}
}
