// TFF MOCK-adapter (demo/offline). Implementeert het portaal-agnostische contract met
// een in-memory nep-portaal. Modelleert nu ook een OAuth-achtige token-lifecycle
// (expiresAt + roterend refresh-token) zodat de pool-refresh deterministisch te tonen is.
// De echte TFF-adapter (cookie-sessie, geen refresh) staat in adapter-live.ts.

import type { PortalAuthAdapter, Session, PortalResponse } from "../../src/runtime/adapter.ts";

// --- MOCK-PORTAAL (alleen demo) -------------------------------------------------
const validSessions = new Set<string>();      // server-side geldige sessionIds
const validRefreshTokens = new Set<string>(); // server-side geldige refresh-tokens
let seq = 0;

function mockLogin(): Session {
  seq += 1;
  const rt = `rt-${seq}`;
  validSessions.add(`sess-${seq}`);
  validRefreshTokens.add(rt);
  return {
    id: `sess-${seq}`,
    cookie: `SID=${seq}`,
    expiresAt: Date.now() + 5 * 60_000, // 5 min (demo)
    refreshToken: rt,
  };
}

function mockSubmit(session: Session, _flow: string, payload: Record<string, unknown>): PortalResponse {
  if (!validSessions.has(session.id)) return { status: 302, loggedOut: true, body: "redirect -> /login" };
  const grams = Number(payload["gewicht"] ?? 0);
  const rates = [
    { carrier: "UPS", service: "Standard", price: Number((5 + (grams / 1000) * 2).toFixed(2)) },
    { carrier: "DHL", service: "Express", price: Number((9 + (grams / 1000) * 3).toFixed(2)) },
  ];
  return { status: 200, loggedOut: false, body: { rates } };
}

/** Server-side logout: alle sessies én refresh-tokens ongeldig (refresh faalt -> re-login). */
export function __mockExpireAll(): void {
  validSessions.clear();
  validRefreshTokens.clear();
}
/** Zet de sessie bijna-verlopen om de proactieve refresh te tonen (sessie blijft geldig). */
export function __mockExpireSoon(s: Session): void {
  s.expiresAt = Date.now() + 1000;
}
// --------------------------------------------------------------------------------

export const adapter: PortalAuthAdapter = {
  portal: "tff",
  async login() {
    return mockLogin();
  },
  async submit(session, flow, payload) {
    return mockSubmit(session, flow, payload);
  },
  isLoggedOut(resp) {
    return resp.loggedOut === true;
  },
  async refresh(session) {
    // Roterend refresh-token (net als echte OAuth, vgl. Exact): eenmalig bruikbaar.
    if (!session.refreshToken || !validRefreshTokens.has(session.refreshToken)) {
      throw new Error("refresh-token ongeldig");
    }
    validRefreshTokens.delete(session.refreshToken);
    validSessions.delete(session.id);
    return mockLogin();
  },
};
