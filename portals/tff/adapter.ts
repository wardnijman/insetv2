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

let mockShipmentSeq = 80000000;

function mockSubmit(session: Session, flow: string, payload: Record<string, unknown>): PortalResponse {
  if (!validSessions.has(session.id)) return { status: 302, loggedOut: true, body: "redirect -> /login" };

  if (flow === "chooseOption") {
    // Echte TFF geeft na chooseOption een submit-sessie; de srk komt uit de rate.
    return { status: 200, loggedOut: false, body: { ok: true, sessionKey: `srk-${payload["srk"] ?? "1"}` } };
  }
  if (flow.startsWith("submitShipment")) {
    mockShipmentSeq += 1;
    return {
      status: 200,
      loggedOut: false,
      body: { zendingnummer: String(mockShipmentSeq), confirmationHtml: `<div>Zending ${mockShipmentSeq} aangemaakt</div>` },
    };
  }

  // getRates: VERRIJKTE rates zoals het echte portaal (reusableData is load-bearing
  // voor chooseOption/submit én automation-rate-selectie). DPD Classic is de
  // capability-guard-veilige boekbare optie; DHL Express test juist de blokkade.
  const grams = Number(payload["gewicht"] ?? 0);
  const mk = (carrier: string, service: string, servicecode: string, price: number, srk: string, transit: string) => ({
    carrier, service, price,
    transitTime: transit,
    serviceDescription: `${carrier} ${service}`,
    reusableData: {
      choose_carrier: carrier, choose_service: service, choose_servicecode: servicecode,
      choose_price: String(price), choose_margin: "1.24", choose_carrier_id: "1", srk,
      choose_pickupdate: "2026-07-21", choose_pickuptime: "1600",
      choose_arrivaldate: "2026-07-23", choose_arrivaltime: "1700",
      choose_gogreen: "0", choose_carbonneutral: "0",
    },
  });
  const rates = [
    mk("DPD", "Classic", "D-CL", Number((4 + (grams / 1000) * 2).toFixed(2)), "2", "1"),
    mk("UPS", "Standard", "U", Number((5 + (grams / 1000) * 2).toFixed(2)), "3", "1"),
    mk("DHL", "Express", "EX", Number((9 + (grams / 1000) * 3).toFixed(2)), "4", "1"),
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
