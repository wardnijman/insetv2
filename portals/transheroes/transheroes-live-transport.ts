// Live TransHeroes (TransPortal) transport primitives for the v2 adapter.
//
// This is the REAL fetch transport. TransPortal is a Nuxt/Vue2 SPA over a hidden
// Laravel JSON-API. Auth is TWO layers (vs TFF's single cookie session):
//   1. Laravel session form:  POST inloggen.../login  (CSRF `_token` in the body,
//      X-XSRF-TOKEN header, session cookie ~2h)  -> authenticated browser session
//   2. Laravel Passport OAuth2 authorization-code + PKCE dance (first-party client 2,
//      scope "*", auto-approve, redirect /callback) -> Bearer access_token (~12h)
//      + refresh_token.
// The API layer (api.transportal...) authenticates by `Authorization: Bearer`, NOT
// by cookie and NOT by a per-request CSRF token.
//
// READ-ONLY: login + the getRates step only. getRates hits
// POST /quotation-price-indications, which is a STATELESS price calculator: it
// returns a tariff and persists NOTHING (verified: /quotations count stays 0). It
// never POSTs /quotations (that would create a persisted quotation object), so
// nothing is ever booked or submitted.

import { createHash, randomBytes } from "node:crypto";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
const INLOG = "https://inloggen.transportal.transheroes.com";
const API = "https://api.transportal.transheroes.com";
const SPA = "https://transportal.transheroes.com";

// Passport client config (mined from the Nuxt bundle: clientId "2", scope "*",
// PKCE S256, redirect the SPA /callback). First-party -> auto-approve, no consent.
const OAUTH = {
  clientId: "2",
  scope: "*",
  redirectUri: `${SPA}/callback`,
  authorize: `${INLOG}/oauth/authorize`,
  token: `${API}/oauth/token`,
  userInfo: `${API}/oauth/userInfo`,
};

// ---------------------------------------------------------------------------
// Cookie jar (same shape as tff-live-transport.ts; used only during login/oauth).
// ---------------------------------------------------------------------------
export type CookieJar = Record<string, string>;

export function mergeSetCookies(jar: CookieJar, setCookies: string[]) {
  for (const line of setCookies) {
    const [pair] = line.split(";");
    const i = pair.indexOf("=");
    if (i > 0) jar[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }
}
export function jarToHeader(jar: CookieJar): string {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
}
export function readSetCookies(res: Response): string[] {
  const h: any = res.headers as any;
  if (typeof h.getSetCookie === "function") return h.getSetCookie();
  if (typeof h.raw === "function") return h.raw()["set-cookie"] ?? [];
  const raw = res.headers.get("set-cookie");
  if (!raw) return [];
  return raw.split(/,(?=[^,]*?=)/g);
}

const b64url = (buf: Buffer) =>
  buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// ---------------------------------------------------------------------------
// login: Laravel session form -> Passport authcode+PKCE -> Bearer + refresh
// ---------------------------------------------------------------------------
export type BearerResult = {
  accessToken: string;
  refreshToken: string | null;
  tokenType: string;
  expiresAt: number; // epoch ms
};

export async function loginToBearer(
  fetchImpl: typeof globalThis.fetch,
  user: string,
  pass: string,
): Promise<BearerResult> {
  const jar: CookieJar = {};

  // 1) seed the Laravel session form: pull the `_token` CSRF + session cookies
  const seed = await fetchImpl(`${INLOG}/login`, {
    method: "GET",
    headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
  });
  mergeSetCookies(jar, readSetCookies(seed));
  const seedHtml = await seed.text();
  const token = /name="_token"\s+value="([^"]+)"/.exec(seedHtml)?.[1] ?? "";
  if (!token) throw new Error("TransHeroes: no _token on /login page");

  // 2) POST the session form (Laravel expects X-XSRF-TOKEN = decoded XSRF cookie)
  const xsrf = jar["XSRF-TOKEN"] ? decodeURIComponent(jar["XSRF-TOKEN"]) : "";
  const form = new URLSearchParams({ _token: token, email: user, password: pass });
  const login = await fetchImpl(`${INLOG}/login`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: INLOG,
      Referer: `${INLOG}/login`,
      Cookie: jarToHeader(jar),
      "X-XSRF-TOKEN": xsrf,
      Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
    },
    body: form.toString(),
  });
  mergeSetCookies(jar, readSetCookies(login));
  // A successful login 302s back to the SPA; the login page itself would re-render (200).
  const loc = login.headers.get("location") ?? "";
  if (login.status !== 302 || /\/login/i.test(loc)) {
    throw new Error(`401: TransHeroes login unsuccessful (status ${login.status}, loc ${loc})`);
  }

  // 3) PKCE + GET /oauth/authorize with the authenticated session -> 302 ?code=
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const state = b64url(randomBytes(16));
  const authUrl =
    `${OAUTH.authorize}?` +
    new URLSearchParams({
      client_id: OAUTH.clientId,
      redirect_uri: OAUTH.redirectUri,
      response_type: "code",
      scope: OAUTH.scope,
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    }).toString();
  const auth = await fetchImpl(authUrl, {
    method: "GET",
    redirect: "manual",
    headers: { "User-Agent": UA, Cookie: jarToHeader(jar), Referer: `${SPA}/`, Accept: "text/html" },
  });
  const authLoc = auth.headers.get("location") ?? "";
  let code: string | null = null;
  try { code = new URL(authLoc).searchParams.get("code"); } catch { /* not a URL */ }
  if (!code) throw new Error(`TransHeroes: no authorization code (status ${auth.status}, consent screen not auto-approved?)`);

  // 4) POST /oauth/token (public client + PKCE, no client_secret) -> Bearer
  const tokenRes = await fetchImpl(OAUTH.token, {
    method: "POST",
    headers: { "User-Agent": UA, "Content-Type": "application/json", Accept: "application/json", Origin: SPA },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: OAUTH.clientId,
      redirect_uri: OAUTH.redirectUri,
      code_verifier: verifier,
      code,
    }),
  });
  const tok: any = await tokenRes.json().catch(() => ({}));
  if (!tok.access_token) throw new Error(`TransHeroes: token exchange failed (${tokenRes.status}): ${JSON.stringify(tok).slice(0, 200)}`);
  return {
    accessToken: tok.access_token,
    refreshToken: tok.refresh_token ?? null,
    tokenType: tok.token_type ?? "Bearer",
    expiresAt: Date.now() + (Number(tok.expires_in ?? 0) * 1000),
  };
}

// A cheap GET to prove the Bearer (a reference-data call).
export async function getReference(
  fetchImpl: typeof globalThis.fetch,
  authHeader: string,
  path: string,
): Promise<{ status: number; loggedOut: boolean; body: any }> {
  const r = await fetchImpl(`${API}${path}`, {
    method: "GET",
    headers: { "User-Agent": UA, Authorization: authHeader, Accept: "application/json" },
  });
  const loggedOut = r.status === 401;
  const body = await r.json().catch(() => ({}));
  return { status: r.status, loggedOut, body };
}

// ---------------------------------------------------------------------------
// getRates: POST /quotation-price-indications (stateless tariff calc, persists nothing).
// The `payload` is the JSON body produced by transformGetRatesInput() in adapter-live.
// ---------------------------------------------------------------------------
export type RateIndication = {
  status: number;
  loggedOut: boolean;
  result: any[]; // normalized to a rate list to match the TFF adapter's shape
  reason?: string;
};

export async function fetchRateIndication(
  fetchImpl: typeof globalThis.fetch,
  authHeader: string,
  body: Record<string, any>,
): Promise<RateIndication> {
  const r = await fetchImpl(`${API}/quotation-price-indications`, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      Authorization: authHeader,
      "Content-Type": "application/json",
      Accept: "application/json",
      Origin: SPA,
      Referer: `${SPA}/`,
    },
    body: JSON.stringify(body),
  });
  if (r.status === 401) return { status: 401, loggedOut: true, result: [], reason: "Bearer expired/invalid" };
  const j: any = await r.json().catch(() => ({}));
  if (r.status !== 200) {
    return { status: r.status, loggedOut: false, result: [], reason: JSON.stringify(j).slice(0, 300) };
  }
  // Normalize the single multimodal price into a rate-list entry, so the runtime
  // sees the same {carrier,service,price} shape it gets from TFF.
  const transportType = body.quotationLines?.[0]?.transportType;
  const mode = transportType === 1 ? "road" : transportType === 2 ? "ocean" : transportType === 3 ? "air" : "unknown";
  const price = j.transportPrice != null ? j.transportPrice / 100 : null;
  const surcharge = j.surchargePrice != null ? j.surchargePrice / 100 : null;
  const result =
    price == null
      ? []
      : [{
          carrier: "TransHeroes",
          service: mode,
          price: price.toFixed(2),
          surcharge: surcharge != null ? surcharge.toFixed(2) : null,
          isCustomerContract: j.isCustomerContract ?? false,
          departureDate: j.departureDate ?? null,
        }];
  return { status: r.status, loggedOut: false, result };
}

export { API, SPA, INLOG, OAUTH };
