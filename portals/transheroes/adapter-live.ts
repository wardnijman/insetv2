// LIVE TransHeroes adapter — implements the portal-agnostic PortalAuthAdapter
// contract (src/runtime/adapter.ts) with a REAL fetch transport against the
// TransPortal Laravel/Passport JSON-API.
//
// This is the GENERALIZATION probe: TFF is a form-scrape portal authenticated by a
// cookie session; TransHeroes is a JSON-API portal authenticated by a Passport
// Bearer token. Both must satisfy the same PortalAuthAdapter interface.
//
//   login()  -> loginToBearer (Laravel session form -> Passport authcode+PKCE -> Bearer)
//   submit(session,"getRates",payload) -> POST /quotation-price-indications (stateless
//              tariff calc; persists nothing)  ->  normalized rate list
//
// READ-ONLY: login + getRates only. Never POSTs /quotations, never books.
//
// --- Interface-fit notes (the honest part of the generalization test) ---
// The Session shape {id, csrf, cookie} is cookie-session-shaped. A Bearer portal
// doesn't fit it cleanly:
//   * `cookie`  -> we overload it to carry the "Bearer <token>" header string
//                  (exactly as TFF overloads it to carry its cookie header).
//   * `csrf`    -> empty; the API layer has no per-request CSRF token (the Bearer
//                  replaces it). So the pool's csrf-into-body injection is INERT
//                  here — submit() ignores it and sets an Authorization HEADER.
//   * refresh_token + expiresAt -> carried as extra fields, but the interface/pool
//                  can't use them (no refresh() hook), so we fall back to full
//                  re-login on 401, which the interface DOES support.

import type { PortalAuthAdapter, Session, PortalResponse } from "../../src/runtime/adapter.ts";
import { loginToBearer, fetchRateIndication } from "./transheroes-live-transport.ts";
import countryIds from "./country-ids.json" with { type: "json" };

// Session superset: the interface fields plus the Bearer bookkeeping the interface
// has no slot for. Structural typing lets us return this where a Session is expected.
export type ThSession = Session & { refreshToken: string | null; expiresAt: number };

function creds(): { user: string; pass: string } {
  const user = process.env.TRANSHEROES_EMAIL;
  const pass = process.env.TRANSHEROES_PASS;
  if (!user || !pass) throw new Error("TRANSHEROES_EMAIL / TRANSHEROES_PASS not set in environment");
  return { user, pass };
}

// ---------------------------------------------------------------------------
// Transform: canonical shipment input -> TransHeroes price-indication JSON body.
// This is the JSON-API analogue of TFF's transformGetRatesInput (which built a
// flat form-field dict). Here the target is a NESTED object with an array of lines.
// ---------------------------------------------------------------------------
type Addr = { country: string; street: string[]; city: string; postalCode: string; company?: string; [k: string]: any };
type Pkg = { type: "package" | "pallet" | "document"; length: number; width: number; height: number; weight: number; stackable?: boolean };

function isoToCountryId(iso: string): number {
  const id = (countryIds as Record<string, number>)[iso];
  if (id == null) throw new Error(`No TransHeroes country id for ISO: ${iso}`);
  return id;
}

// package type -> TransHeroes goodsType id (from GET /goods-types). Parcels/documents
// have no pallet footprint; 23 = generic "Pallet (120 x 80)", 1 = Europallet.
function goodsTypeOf(p: Pkg): number {
  if (p.type === "pallet") return 1;      // Europallet
  return 23;                               // generic pallet footprint for package/document
}

// loadMeters ≈ (L*W in m²) / 2.4 (standard trailer width 2.4m), for road LTL pricing.
function loadMeters(p: Pkg): number {
  const m = (p.length / 100) * (p.width / 100) / 2.4;
  return Math.round(m * 100) / 100;
}

export function transformGetRatesInput(input: any, transportType = 1): Record<string, any> {
  const sa: Addr = input.shipperAddress;
  const ra: Addr = input.recipientAddress;
  const pkgs: Pkg[] = input.packages;

  return {
    quotationReference: null,
    departureDate: new Date().toISOString(),
    departureLocation: {
      address: {
        address: `${sa.street[0] ?? ""} ${sa.street[1] ?? ""}`.trim(),
        city: sa.city,
        country: isoToCountryId(sa.country),
        postalCode: sa.postalCode,
      },
    },
    destinationLocation: {
      address: {
        address: `${ra.street[0] ?? ""} ${ra.street[1] ?? ""}`.trim(),
        city: ra.city,
        country: isoToCountryId(ra.country),
        postalCode: ra.postalCode,
      },
    },
    quotationLines: pkgs.map((p) => ({
      goodsType: goodsTypeOf(p),
      transportType,
      quantity: 1,
      weight: p.weight,
      length: p.length,
      width: p.width,
      height: p.height,
      loadMeters: loadMeters(p),
      stackable: p.stackable ?? true,
    })),
  };
}

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------
export const adapterLive: PortalAuthAdapter = {
  portal: "transheroes",
  // No per-request CSRF token in the API layer; the Bearer replaces it. Kept as a
  // placeholder purely for contract compatibility — the pool's injection is inert.
  csrfField: "_token",

  async login(): Promise<ThSession> {
    const { user, pass } = creds();
    const t = await loginToBearer(globalThis.fetch, user, pass);
    return {
      id: `bearer:${t.accessToken.slice(0, 8)}`,
      csrf: "",
      cookie: `${t.tokenType} ${t.accessToken}`, // overloaded: carries the Authorization header
      refreshToken: t.refreshToken,
      expiresAt: t.expiresAt,
    };
  },

  async submit(session: Session, flow: string, payload: Record<string, unknown>): Promise<PortalResponse> {
    if (flow !== "getRates") throw new Error(`adapter-live only implements getRates (read-only), got: ${flow}`);
    const { _token, ...body } = payload as any; // drop the inert pool-injected placeholder
    const authHeader = session.cookie;           // the overloaded Bearer header
    const r = await fetchRateIndication(globalThis.fetch, authHeader, body);
    return { status: r.status, loggedOut: r.loggedOut, body: { result: r.result, reason: r.reason } };
  },

  isLoggedOut(resp: PortalResponse): boolean {
    return resp.loggedOut === true;
  },
};
