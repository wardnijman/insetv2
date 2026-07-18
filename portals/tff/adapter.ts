// TFF-adapter. Implementeert het portaal-agnostische contract. De TRANSPORT is hier
// een in-memory mock-portaal zodat de demo offline en deterministisch draait; in prod
// wordt dit een echte fetch naar baseUrl met de Laravel-sessiecookie. De interface
// verandert daardoor niet.

import type { PortalAuthAdapter, Session, PortalResponse } from "../../src/runtime/adapter.ts";

// --- MOCK-PORTAAL (alleen demo) -------------------------------------------------
const validSessions = new Map<string, string>(); // sessionId -> geldige CSRF
let seq = 0;

function mockLogin(): Session {
  seq += 1;
  const s: Session = { id: `sess-${seq}`, csrf: `csrf-${seq}`, cookie: `SID=${seq}` };
  validSessions.set(s.id, s.csrf);
  return s;
}

function mockSubmit(session: Session, _flow: string, payload: Record<string, unknown>): PortalResponse {
  const known = validSessions.get(session.id);
  if (!known) return { status: 302, loggedOut: true, body: "redirect -> /login" };
  if (payload["_token"] !== known) return { status: 419, loggedOut: true, body: "CSRF token mismatch" };
  const grams = Number(payload["gewicht"] ?? 0);
  const rates = [
    { carrier: "UPS", service: "Standard", price: Number((5 + (grams / 1000) * 2).toFixed(2)) },
    { carrier: "DHL", service: "Express", price: Number((9 + (grams / 1000) * 3).toFixed(2)) },
  ];
  return { status: 200, loggedOut: false, body: { rates } };
}

/** Simuleert een server-side logout (voor de re-login-demo). */
export function __mockExpireAll(): void {
  validSessions.clear();
}
// --------------------------------------------------------------------------------

export const adapter: PortalAuthAdapter = {
  portal: "tff",
  csrfField: "_token",
  async login() {
    return mockLogin();
  },
  async submit(session, flow, payload) {
    return mockSubmit(session, flow, payload);
  },
  isLoggedOut(resp) {
    return resp.loggedOut === true;
  },
};
