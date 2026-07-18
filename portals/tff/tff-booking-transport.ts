// LIVE TFF booking transport (WRITE PATH) for the v2 adapter.
//
// This is the real fetch transport for the two steps that BOOK a shipment:
//   - chooseOption:   POST /versturen?action=choose  -> GET /versturen?s=3
//   - submitShipment: POST /versturen?action=shipment -> follow 302 -> GET final page
//
// Faithful ports of the two KNOWN-GOOD v1 route handlers in plugship:
//   - plugship-client-app/src/routes/chooseOption/+server.ts
//   - plugship-client-app/src/routes/submitShipment111908712/+server.ts  (DPD Classic NL->NL)
// plus the choose transforms (C_chooseOption_0.transforms: spaceToPlus).
//
// This file is the WRITE path on purpose kept separate from tff-live-transport.ts
// (which is documented READ-ONLY). Nothing here decides *whether* to book — the
// capability guard (src/runtime/capabilities.ts assertBookable) is enforced by the
// orchestrator in adapter-booking.ts BEFORE any submit is issued. This module is
// pure transport: it does exactly what it is told.

import { mergeSetCookies, jarToHeader, readSetCookies, type CookieJar } from "./tff-live-transport.ts";

const UA = "Mozilla/5.0";
const AL = "nl-NL,nl;q=0.9,en-US;q=0.8,en;q=0.7";
const BASE = "https://tffxpress.com";

// ---------------------------------------------------------------------------
// A jar-bound fetch (port of v1 tff-session.ts createTffFetch): always sends the
// jar's cookies AND merges any Set-Cookie back into the jar, so the TFF wizard's
// per-session state survives across getRates -> chooseOption -> submitShipment.
// ---------------------------------------------------------------------------
export function createJarFetch(baseFetch: typeof globalThis.fetch, jar: CookieJar): typeof globalThis.fetch {
  return (async (input: any, init?: any) => {
    const headers = new Headers(init?.headers ?? {});
    headers.set("User-Agent", UA);
    headers.set("Accept-Language", AL);
    const cookieHeader = jarToHeader(jar);
    if (cookieHeader) headers.set("Cookie", cookieHeader);
    const res = await baseFetch(input, { ...init, headers });
    mergeSetCookies(jar, readSetCookies(res as any));
    return res;
  }) as any;
}

// ---------------------------------------------------------------------------
// choose transforms (verbatim port of C_chooseOption_0.transforms.ts)
// ---------------------------------------------------------------------------
const _1To1 = (v: any) => v;
// NB: v1 replaces only the FIRST space (String.replace with a string arg). Kept identical.
const spaceToPlus = (v: any) => String(v).replace(" ", "+");

// ---------------------------------------------------------------------------
// chooseOption: reveal the carrier form for the chosen rate.
// POST /versturen?action=choose (urlencoded, from the rate's reusableData hidden
// inputs), then GET /versturen?s=3 (the shipment-detail form).
// ---------------------------------------------------------------------------
export type ChooseResult = {
  status: number;
  loggedOut: boolean;
  sessionKey: number | null;
  paperlessAvailable: boolean;
  html: string;
  reason?: string;
};

export async function chooseOption(
  jarFetch: typeof globalThis.fetch,
  reusableData: Record<string, any>,
): Promise<ChooseResult> {
  const form = new URLSearchParams();
  form.append("choose_servicecode", _1To1(reusableData["choose_servicecode"]) ?? "");
  form.append("choose_carrier", _1To1(reusableData["choose_carrier"]) ?? "");
  form.append("choose_service", spaceToPlus(reusableData["choose_service"] ?? ""));
  form.append("choose_margin", _1To1(reusableData["choose_margin"]) ?? "");
  form.append("choose_price", _1To1(reusableData["choose_price"]) ?? "");
  form.append("choose_carrier_id", _1To1(reusableData["choose_carrier_id"]) ?? "");
  form.append("srk", _1To1(reusableData["srk"]) ?? "");
  form.append("choose_pickupdate", _1To1(reusableData["choose_pickupdate"]) ?? "");
  form.append("choose_pickuptime", _1To1(reusableData["choose_pickuptime"]) ?? "");
  form.append("choose_arrivaldate", _1To1(reusableData["choose_arrivaldate"]) ?? "");
  form.append("choose_arrivaltime", _1To1(reusableData["choose_arrivaltime"]) ?? "");
  form.append("choose_gogreen", _1To1(reusableData["choose_gogreen"]) ?? "");
  form.append("choose_carbonneutral", _1To1(reusableData["choose_carbonneutral"]) ?? "");

  const res0 = await jarFetch(`${BASE}/versturen?action=choose`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: `${BASE}/versturen?action=choose`,
      Origin: BASE,
    },
    body: form.toString(),
    redirect: "manual",
  });
  if (res0.status === 302 || res0.status === 303) {
    const loc = res0.headers.get("location") ?? "";
    if (/\/login/i.test(loc)) return { status: res0.status, loggedOut: true, sessionKey: null, paperlessAvailable: false, html: "", reason: `POST ?action=choose -> ${loc}` };
  }
  await res0.text();

  const res1 = await jarFetch(`${BASE}/versturen?s=3`, {
    method: "GET",
    headers: { Referer: `${BASE}/versturen?s=3` },
    redirect: "manual",
  });
  if (res1.status === 302 || res1.status === 303) {
    const loc = res1.headers.get("location") ?? "";
    if (/\/login/i.test(loc)) return { status: res1.status, loggedOut: true, sessionKey: null, paperlessAvailable: false, html: "", reason: `GET ?s=3 -> ${loc}` };
  }
  const html = await res1.text();
  if (/name="csrf/i.test(html) && /type=["']password["']/i.test(html)) {
    return { status: res1.status, loggedOut: true, sessionKey: null, paperlessAvailable: false, html, reason: "?s=3 returned the login page" };
  }

  const sessionKey = scrapeJsVarNumber(html, "x_sessionkey");
  const paperlessAvailable =
    html.includes('id="generate_invoice_modal"') || /name=["']file_invoice["']/i.test(html);

  return { status: res1.status, loggedOut: false, sessionKey, paperlessAvailable, html };
}

// ---------------------------------------------------------------------------
// submitShipment (fingerprint 111908712 = DPD Classic NL->NL, package).
// Verbatim port of the FormData construction + redirect handling in
// plugship-client-app/src/routes/submitShipment111908712/+server.ts.
//
// A SUCCESSFUL booking = a 302/303 to /versturen?shipment=<id> (or shipment-final).
// No redirect => TFF rejected the shipment (nothing is booked) and we surface the
// scraped error. Only a completed POST that yields that redirect creates a label.
// ---------------------------------------------------------------------------
export type SubmitFields = Record<string, any>;

export type SubmitResult = {
  status: number;
  loggedOut: boolean;
  booked: boolean;
  shipmentId: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  labelUrl: string | null;
  confirmationUrl: string | null;
  forwarderRef: string | null;
  error?: string;
  redirectUrl?: string | null;
};

export async function submitShipment111908712(
  jarFetch: typeof globalThis.fetch,
  f: SubmitFields,
): Promise<SubmitResult> {
  const form = new FormData();
  form.append("plugtech_source", f["plugtech_source"] ?? "");
  form.append("vsstates2", f["vsstates2"] ?? "");
  form.append("canadastates2", f["canadastates2"] ?? "");
  form.append("aanvullendeverzekering", f["aanvullendeverzekering"] ?? "");
  form.append("invoice_uploaded_status", f["invoice_uploaded_status"] ?? "");
  { const _v = f["file_invoice"]; if (_v && _v.base64 && _v.filename) { const binary = Buffer.from(_v.base64, "base64"); form.append("file_invoice", new Blob([binary], { type: _v.contentType ?? "application/octet-stream" }), _v.filename); } else { form.append("file_invoice", ""); } }
  form.append("factuuraanwezig", f["factuuraanwezig"] ?? "");
  form.append("land", f["land"] ?? "");
  form.append("postcode", f["postcode"] ?? "");
  form.append("huisnummer", f["huisnummer"] ?? "");
  form.append("straat", f["straat"] ?? "");
  form.append("adres_line2", "");
  form.append("plaats", f["plaats"] ?? "");
  form.append("land2", f["land2"] ?? "");
  form.append("postcode2", f["postcode2"] ?? "");
  form.append("huisnummer2", f["huisnummer2"] ?? "");
  form.append("straat2", f["straat2"] ?? "");
  form.append("adres2_line2", "");
  form.append("plaats2", f["plaats2"] ?? "");
  form.append("contactpersoon2", f["contactpersoon2"] ?? "");
  form.append("telmob2", f["telmob2"] ?? "");
  form.append("email2", f["email2"] ?? "");
  form.append("naam", f["naam"] ?? "");
  form.append("landh", f["landh"] ?? "");
  form.append("postcodeh", f["postcodeh"] ?? "");
  form.append("contactpersoon", f["contactpersoon"] ?? "");
  form.append("telmob", f["telmob"] ?? "");
  form.append("email", f["email"] ?? "");
  form.append("opmerking", "");
  form.append("laadreferentie", "");
  form.append("isprivateaddress2", f["isprivateaddress2"] ?? "");
  form.append("naam2", f["naam2"] ?? "");
  form.append("land2h", f["land2h"] ?? "");
  form.append("postcode2h", f["postcode2h"] ?? "");
  form.append("losreferentie", "");
  form.append("avvalue", f["avvalue"] ?? "");
  form.append("laadklepLaden", f["laadklepLaden"] ?? "");
  form.append("laadklepLossen", f["laadklepLossen"] ?? "");
  form.append("bakwagenLaden", f["bakwagenLaden"] ?? "");
  form.append("bakwagenLossen", f["bakwagenLossen"] ?? "");
  form.append("requirePod", f["requirePod"] ?? "");
  form.append("landvanoorsprong", f["landvanoorsprong"] ?? "");
  form.append("waardevangoederen", f["waardevangoederen"] ?? "");
  form.append("valuta", "EUR");
  form.append("leveringscondities", f["leveringscondities"] ?? "");
  form.append("goodsDescriptionOption", "");
  form.append("goederenomschrijving", f["goederenomschrijving"] ?? "");
  form.append("factuurreferentie", f["factuurreferentie"] ?? "");
  form.append("upload_transit_docs", f["upload_transit_docs"] ?? "");
  const fileCustoms = f["file_customs[]"];
  if (fileCustoms && fileCustoms.length) {
    for (let i = 0; i < fileCustoms.length; i++) {
      const _v = fileCustoms[i];
      if (_v && _v.base64 && _v.filename) { const binary = Buffer.from(_v.base64, "base64"); form.append("file_customs[]", new Blob([binary], { type: _v.contentType ?? "application/pdf" }), _v.filename); }
    }
  }
  form.append("incotermsSurcharge", "43");
  form.append("private_address_surcharge_value", "3.5");
  form.append("totalprice", "");
  form.append("calc", f["calc"] ?? "");
  form.append("calc2", f["calc2"] ?? "");
  form.append("selectedShop", "");

  const res0 = await jarFetch(`${BASE}/versturen?action=shipment`, {
    method: "POST",
    headers: {
      Referer: `${BASE}/versturen?action=shipment`,
      Origin: BASE,
    },
    body: form,
    redirect: "manual",
  });

  let redirectUrl: string | null = null;
  if (res0.status === 302 || res0.status === 303) {
    let loc = res0.headers.get("location");
    if (loc) loc = resolveUrl(loc, `${BASE}/versturen?action=shipment`);
    if (loc && /\/login/i.test(loc)) {
      return emptyResult(res0.status, true, `POST ?action=shipment -> ${loc}`);
    }
    redirectUrl = loc ?? null;
  }

  let html0 = "";
  if (!redirectUrl) html0 = await res0.text();
  if (!redirectUrl) redirectUrl = extractClientSideRedirect(html0, `${BASE}/versturen?action=shipment`);
  if (redirectUrl && /\/login/i.test(redirectUrl)) {
    return emptyResult(res0.status, true, `client redirect -> ${redirectUrl}`);
  }
  if (!redirectUrl) {
    // No redirect => TFF did not accept the shipment. Nothing was booked.
    const error = extractErrorMessage(html0) ?? "Kon geen redirect bepalen (geen boeking)";
    return { status: res0.status, loggedOut: false, booked: false, shipmentId: null, trackingNumber: null, trackingUrl: null, labelUrl: null, confirmationUrl: null, forwarderRef: null, error, redirectUrl: null };
  }

  // We have a shipment redirect => booking succeeded. Fetch the final page for the label/tracking.
  const shipmentId = /[?&]shipment=(\d+)/.exec(redirectUrl)?.[1] ?? null;

  const res1 = await jarFetch(redirectUrl, {
    method: "GET",
    headers: { Referer: redirectUrl },
    redirect: "manual",
  });
  const html1 = await res1.text();
  const info = parseTrackingInfo(html1);

  return {
    status: res1.status,
    loggedOut: false,
    booked: true,
    shipmentId,
    trackingNumber: info.trackingNumber,
    trackingUrl: info.trackingUrl,
    labelUrl: info.labelUrl,
    confirmationUrl: info.confirmationUrl,
    forwarderRef: info.forwarderRef,
    redirectUrl,
  };
}

function emptyResult(status: number, loggedOut: boolean, reason: string): SubmitResult {
  return { status, loggedOut, booked: false, shipmentId: null, trackingNumber: null, trackingUrl: null, labelUrl: null, confirmationUrl: null, forwarderRef: null, error: reason, redirectUrl: null };
}

// ---------------------------------------------------------------------------
// parsers (regex-based; v2 has no cheerio / npm deps)
// ---------------------------------------------------------------------------
function parseTrackingInfo(html: string): {
  labelUrl: string | null; confirmationUrl: string | null; trackingUrl: string | null;
  trackingNumber: string | null; forwarderRef: string | null;
} {
  const labelHref = matchHrefContaining(html, "resources/labels/");
  const confirmationHref = matchHrefContaining(html, "page.php?id=");

  // forwarder ref: <input id="actual_shipment_id" value="...">
  let forwarderRef: string | null = null;
  const inpTag = /<input[^>]*id=["']actual_shipment_id["'][^>]*>/i.exec(html)?.[0];
  if (inpTag) forwarderRef = extractAttr(inpTag, "value");

  // tracking: the <a href="https://...">NUMBER</a> that follows the "Trackingnummer" label
  let trackingUrl: string | null = null;
  let trackingNumber: string | null = null;
  const tIdx = html.search(/Trackingnummer/i);
  if (tIdx !== -1) {
    const window = html.slice(tIdx, tIdx + 1500);
    const m = /<a[^>]*href=["'](https:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/i.exec(window);
    if (m) {
      trackingUrl = m[1];
      trackingNumber = stripTags(m[2]).trim() || null;
    }
  }

  return {
    labelUrl: labelHref ? resolveUrl(labelHref, BASE) : null,
    confirmationUrl: confirmationHref ? resolveUrl(confirmationHref, BASE) : null,
    trackingUrl,
    trackingNumber,
    forwarderRef: forwarderRef && forwarderRef !== "" ? forwarderRef : null,
  };
}

function matchHrefContaining(html: string, needle: string): string | null {
  // scan every <a href="..."> and return the first whose href contains needle
  const re = /<a[^>]*href=["']([^"']+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[1].includes(needle)) return m[1];
  }
  return null;
}

function scrapeJsVarNumber(html: string, varName: string): number | null {
  const re = new RegExp(String.raw`(?:^|[\r\n;])\s*(?:var|let|const)\s+${varName}\s*=\s*(\d+)\s*;?`, "m");
  const m = html.match(re);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function resolveUrl(raw: string, base: string): string {
  try { return new URL(raw, base).toString(); } catch { return raw; }
}

function extractClientSideRedirect(html: string, base: string): string | null {
  if (!html) return null;
  const metaTag = html.match(/<meta[^>]+http-equiv=["']?refresh["']?[^>]*>/i)?.[0] ?? null;
  if (metaTag) {
    const content = metaTag.match(/content=["']([^"']+)["']/i)?.[1] ?? "";
    const url = content.match(/url\s*=\s*([^;]+)/i)?.[1]?.trim() ?? null;
    if (url) return resolveUrl(url.replace(/^['"]|['"]$/g, ""), base);
  }
  const jsUrl =
    html.match(/window\.location\.(?:href|replace|assign)\s*\(\s*['"]([^'"]+)['"]\s*\)/i)?.[1] ??
    html.match(/window\.location\.(?:href|replace|assign)\s*=\s*['"]([^'"]+)['"]/i)?.[1] ??
    html.match(/location\.href\s*=\s*['"]([^'"]+)['"]/i)?.[1] ??
    null;
  return jsUrl ? resolveUrl(jsUrl, base) : null;
}

function extractErrorMessage(html: string): string | null {
  if (!html) return "Er is iets misgegaan met je zending, maar er kon geen exacte reden bepaald worden.";
  const fatal = html.match(/<b>Fatal error<\/b>:\s*([\s\S]*?)<br\s*\/?\>/i);
  if (fatal) return decodeEntities(stripTags(fatal[1]).trim());

  if (html.toLowerCase().includes("booking-error")) {
    const m = html.match(/class=["'][^"']*booking-error[^"']*["'][\s\S]{0,8000}?<p[^>]*>([\s\S]*?)<\/p>/i);
    if (m) { const msg = collapseWs(decodeEntities(stripTags(m[1]))); if (msg) return msg; }
  }
  if (html.includes("Oeps! Er is iets misgegaan.")) {
    const jsonMatch = html.match(/\{[^{}]*"message"\s*:\s*"[^"]+"[^{}]*\}/s);
    if (jsonMatch) {
      try {
        const j: any = JSON.parse(jsonMatch[0]);
        const msg = String(j.message ?? "").trim();
        const add = Array.isArray(j.additionalDetails) && j.additionalDetails.length ? "\n" + j.additionalDetails.join("\n") : "";
        if (msg) return msg + add;
      } catch {}
    }
    const idx = html.indexOf("Oeps! Er is iets misgegaan.");
    const chunk = idx >= 0 ? html.slice(idx, idx + 4000) : html;
    const txt = collapseWs(decodeEntities(stripTags(chunk)));
    const cut = txt.includes("{") ? txt.split("{")[0].trim() : txt.trim();
    return cut || "Oeps! Er is iets misgegaan.";
  }
  // numbered <strong>1)</strong> messages
  const lines: string[] = [];
  const reStrong = /<strong[^>]*>\s*(\d+\))\s*<\/strong>\s*([^<\r\n]+)/gi;
  let sm: RegExpExecArray | null;
  while ((sm = reStrong.exec(html))) {
    const prefix = collapseWs(decodeEntities(stripTags(sm[1])));
    const msg = collapseWs(decodeEntities(stripTags(sm[2])));
    if (prefix && msg) lines.push(prefix + " " + msg);
  }
  if (lines.length) return lines.join("\n");
  return "Er is iets misgegaan met je zending, maar er kon geen exacte reden bepaald worden.";
}

function extractAttr(tagHtml: string, attr: string): string | null {
  const key = attr + '="';
  let i = tagHtml.indexOf(key);
  if (i !== -1) { const start = i + key.length; const end = tagHtml.indexOf('"', start); return end === -1 ? tagHtml.slice(start) : tagHtml.slice(start, end); }
  const key2 = attr + "='";
  i = tagHtml.indexOf(key2);
  if (i !== -1) { const start = i + key2.length; const end = tagHtml.indexOf("'", start); return end === -1 ? tagHtml.slice(start) : tagHtml.slice(start, end); }
  return null;
}

function stripTags(s: string): string { return String(s ?? "").replace(/<[^>]*>/g, " "); }
function collapseWs(s: string): string { return String(s ?? "").replace(/\s+/g, " ").trim(); }
function decodeEntities(s: string): string {
  return String(s ?? "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0*39;/g, "'");
}

export { BASE };
