// Live TFF transport primitives for the v2 adapter.
//
// This is the REAL fetch transport (as opposed to portals/tff/adapter.ts's mock).
// It is a faithful port of the two known-good v1 pieces:
//   - login: plugship client-discovery/tff/tff-session.ts  -> loginAndWarm
//   - getRates scrape: plugship-client-app/src/routes/getRates/+server.ts
//     (build the /versturen wizard FormData, POST it, GET ?s=2, parse the
//      "table proposal" rows into rates)
//
// READ-ONLY: only login + the getRates step (POST /versturen + GET ?s=2). It never
// calls chooseOption or submitShipment, so nothing is ever booked.

const UA = "Mozilla/5.0";
const AL = "nl-NL,nl;q=0.9,en-US;q=0.8,en;q=0.7";
const BASE = "https://tffxpress.com";

// ---------------------------------------------------------------------------
// Cookie jar (ported from v1 tff-session.ts)
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
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

export function readSetCookies(res: Response): string[] {
  const h: any = res.headers as any;
  if (typeof h.getSetCookie === "function") return h.getSetCookie();
  if (typeof h.raw === "function") return h.raw()["set-cookie"] ?? [];
  const raw = res.headers.get("set-cookie");
  if (!raw) return [];
  return raw.split(/,(?=[^,]*?=)/g);
}

function isLoggedIn(html: string): boolean {
  if (/href=["']\/logout["']/i.test(html)) return true;
  if (/(^|[^a-z])uitloggen([^a-z]|$)/i.test(html)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// login (ported from v1 loginAndWarm): GET /login -> CSRF -> POST /login -> warm /versturen
// ---------------------------------------------------------------------------
export type LoginResult = { jar: CookieJar; phpsessid: string | null; csrf: string | null };

export async function loginAndWarm(
  fetchImpl: typeof globalThis.fetch,
  user: string,
  pass: string,
): Promise<LoginResult> {
  const jar: CookieJar = {};

  // 0) seed: GET /login, pull PHPSESSID + CSRF token out of the page
  const resSeed = await fetchImpl(`${BASE}/login`, {
    method: "GET",
    redirect: "manual",
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
      "Accept-Language": AL,
      Referer: `${BASE}/`,
    },
  });
  mergeSetCookies(jar, readSetCookies(resSeed));
  const seedHtml = await resSeed.text();
  const csrf = /name="csrf[^"]*"\s+value="([^"]+)"/i.exec(seedHtml)?.[1] ?? null;

  // 1) login POST
  const form = new URLSearchParams();
  form.set("user", user);
  form.set("pass", pass);
  if (csrf) form.set("csrf_token", csrf);

  const resLogin = await fetchImpl(`${BASE}/login`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
      "Accept-Language": AL,
      Origin: BASE,
      Referer: `${BASE}/login`,
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: jarToHeader(jar),
    },
    body: form.toString(),
  });
  mergeSetCookies(jar, readSetCookies(resLogin));

  // 2) warm the versturen wizard, confirm we are authenticated
  const resWarm = await fetchImpl(`${BASE}/versturen`, {
    method: "GET",
    redirect: "manual",
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
      "Accept-Language": AL,
      Origin: BASE,
      Referer: `${BASE}/login`,
      Cookie: jarToHeader(jar),
    },
  });
  mergeSetCookies(jar, readSetCookies(resWarm));
  const warmHtml = await resWarm.text();

  if (!isLoggedIn(warmHtml)) {
    throw new Error("401: TFF login unsuccessful (still on login page)");
  }

  return { jar, phpsessid: jar["PHPSESSID"] ?? null, csrf };
}

// ---------------------------------------------------------------------------
// getRates scrape (ported from v1 +server.ts /getRates)
// ---------------------------------------------------------------------------

/** Build the multipart /versturen wizard form from the transformed field dict. */
export function buildVersturenForm(body: Record<string, any>): FormData {
  const land = body["land"];
  const searchTextField = body["searchTextField"];
  const searchTextField2 = body["searchTextField2"];
  const vsstates = body["vsstates"];
  const canadastates = body["canadastates"];
  const postcode = body["postcode"];
  const huisnummer = body["huisnummer"];
  const postcodeFormath = body["postcode_formath"];
  const straat = body["straat"];
  const plaats = body["plaats"];
  const land2 = body["land2"];
  const vsstates2 = body["vsstates2"];
  const canadastates2 = body["canadastates2"];
  const postcode2 = body["postcode2"];
  const huisnummer2 = body["huisnummer2"];
  const postcodeFormat2h = body["postcode_format2h"];
  const straat2 = body["straat2"];
  const plaats2 = body["plaats2"];
  const tailgate = body["tailgate"];
  const boxTruck = body["boxTruck"];
  const privateaddress2 = body["privateaddress2"];
  const goederen = body["goederen[]"];
  const packagingType = body["packaging-type[]"];
  const lengte = body["lengte[]"];
  const breedte = body["breedte[]"];
  const hoogte = body["hoogte[]"];
  const gewicht = body["gewicht[]"];
  const stapelbaar = body["stapelbaar[]"];
  const stapelbaarIndicator = body["stapelbaarIndicator[]"];

  const form = new FormData();
  form.append("land", land ?? "");
  form.append("searchTextField", searchTextField ?? "");
  form.append("searchTextField2", searchTextField2 ?? "");
  form.append("vsstates", vsstates ?? "");
  form.append("canadastates", canadastates ?? "");
  form.append("postcode", postcode ?? "");
  form.append("huisnummer", huisnummer ?? "");
  form.append("postcode_formath", postcodeFormath ?? "");
  form.append("straat", straat ?? "");
  form.append("adres_line2", "");
  form.append("plaats", plaats ?? "");
  form.append("stap1", "stap1");
  form.append("land2", land2 ?? "");
  form.append("vsstates2", vsstates2 ?? "");
  form.append("canadastates2", canadastates2 ?? "");
  form.append("postcode2", postcode2 ?? "");
  form.append("huisnummer2", huisnummer2 ?? "");
  form.append("postcode_format2h", postcodeFormat2h ?? "");
  form.append("straat2", straat2 ?? "");
  form.append("adres2_line2", "");
  form.append("plaats2", plaats2 ?? "");
  form.append("contactpersoon2", "");
  form.append("telmob2", "");
  form.append("email2", "");
  form.append("dryIceWeight", "0.00");
  form.append("dryIceWeightKey", "");
  form.append("modalAdresboekFromTitle", "");
  form.append("modalAdresboekToTitle", "");

  const packagesLength = goederen?.length ?? 0;
  const check = (arr: any[], name: string) => {
    if ((arr?.length ?? 0) !== packagesLength) throw new Error(`Mismatched array lengths in group 'packages' (${name})`);
  };
  check(packagingType, "packaging-type[]");
  check(lengte, "lengte[]");
  check(breedte, "breedte[]");
  check(hoogte, "hoogte[]");
  check(gewicht, "gewicht[]");
  check(stapelbaar, "stapelbaar[]");
  check(stapelbaarIndicator, "stapelbaarIndicator[]");

  for (let i = 0; i < packagesLength; i++) {
    form.append("goederen[]", goederen[i] ?? "");
    form.append("packaging-type[]", packagingType[i] ?? "");
    form.append("aantal[]", "1");
    form.append("lengte[]", lengte[i] ?? "");
    form.append("breedte[]", breedte[i] ?? "");
    form.append("hoogte[]", hoogte[i] ?? "");
    form.append("gewicht[]", gewicht[i] ?? "");
    form.append("stapelbaar[]", stapelbaar[i] ?? "");
    form.append("stapelbaarIndicator[]", stapelbaarIndicator[i] ?? "");
    form.append("dryicekeys[]", "");
    form.append("dryicekeyskgs[]", "");
  }
  form.append("tailgate", tailgate ?? "");
  form.append("boxTruck", boxTruck ?? "");
  form.append("surcharges_to_remove", "");
  form.append("privateaddress2", privateaddress2 ?? "");
  return form;
}

export type RatesResult = {
  status: number;
  loggedOut: boolean;
  result: any[];
  reason?: string;
};

/**
 * The full getRates step: POST the wizard form to /versturen, then GET
 * /versturen?s=2 and parse the proposal table. Cookie is the only auth.
 */
export async function fetchRates(
  fetchImpl: typeof globalThis.fetch,
  cookieHeader: string,
  payload: Record<string, any>,
): Promise<RatesResult> {
  const form = buildVersturenForm(payload);

  const res0 = await fetchImpl(`${BASE}/versturen`, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      Referer: `${BASE}/versturen`,
      Origin: BASE,
      Cookie: cookieHeader,
    },
    body: form,
    redirect: "manual",
  });
  if (res0.status === 302 || res0.status === 303) {
    const loc = res0.headers.get("location") ?? "";
    if (/\/login/i.test(loc)) return { status: res0.status, loggedOut: true, result: [], reason: `POST /versturen -> ${loc}` };
  }
  await res0.text();

  const res1 = await fetchImpl(`${BASE}/versturen?s=2`, {
    method: "GET",
    headers: {
      "User-Agent": UA,
      Referer: `${BASE}/versturen?s=2`,
      Cookie: cookieHeader,
    },
    redirect: "manual",
  });
  if (res1.status === 302 || res1.status === 303) {
    const loc = res1.headers.get("location") ?? "";
    if (/\/login/i.test(loc)) return { status: res1.status, loggedOut: true, result: [], reason: `GET ?s=2 -> ${loc}` };
  }
  const html1 = await res1.text();
  if (/name="csrf/i.test(html1) && /type=["']password["']/i.test(html1)) {
    return { status: res1.status, loggedOut: true, result: [], reason: "?s=2 returned the login page" };
  }

  const result = getQuotedRates(html1);
  return { status: res1.status, loggedOut: false, result };
}

// ---- HTML rate-table parser (verbatim port of v1 +server.ts getQuotedRates) ----
type PickupDateOption = { date: string; businessDaysEnRoute?: number };

export function getQuotedRates(html: string): any[] {
  const slim = sliceProposalTable(html);
  const results: any[] = [];
  let pos = 0;

  while (true) {
    const trStart = findNextProposalTr(slim, pos);
    if (trStart === -1) break;
    const trOpenEnd = slim.indexOf(">", trStart);
    if (trOpenEnd === -1) break;
    const trEnd = slim.indexOf("</tr>", trOpenEnd);
    if (trEnd === -1) break;
    const trInner = slim.slice(trOpenEnd + 1, trEnd);
    pos = trEnd + 5;

    const tds = extractFirstNTds(trInner, 6);
    if (tds.length < 6) continue;

    const [td0, td1, td2, td3, td4, td5] = tds;
    const imgUrl = extractFirstImgSrc(td0);
    const carrier = carrierFromLogo(imgUrl);
    const serviceDescription = td1.trim();
    const service = htmlToText(td1);
    const { firstBusinessDays, availablePickupDates } = parsePickupSelect(td3);
    const transitTime = firstBusinessDays ?? htmlToText(td2);
    const price = parsePrice(td4);
    const postData = parseHiddenInputs(td5);

    const sd = htmlToText(serviceDescription).toLowerCase();
    const noPickupPossible =
      sd.includes("na boeken binnen 2u opgehaald en aansluitend geleverd.") ||
      sd.includes("you have to bring a dpd package to a dpd point yourself") ||
      sd.includes("dpd pakket moet");

    results.push({
      carrier,
      service,
      serviceDescription,
      transitTime,
      imgUrl,
      price,
      availablePickupDates,
      noPickupPossible,
      pickupDate: postData["choose_pickupdate"],
      pickupTime: postData["choose_pickuptime"],
      deliveryDate: postData["choose_arrivaldate"],
      deliveryTime: postData["choose_arrivaltime"],
      carbonNeutral: postData["choose_carbonneutral"] === "1",
      reusableData: postData,
    });
  }
  return results;
}

function sliceProposalTable(html: string): string {
  const clsIdx = html.indexOf('class="table proposal"');
  if (clsIdx === -1) return html;
  const tableStart = html.lastIndexOf("<table", clsIdx);
  if (tableStart === -1) return html;
  const tableEnd = html.indexOf("</table>", clsIdx);
  if (tableEnd === -1) return html.slice(tableStart);
  return html.slice(tableStart, tableEnd + 8);
}

function findNextProposalTr(s: string, from: number): number {
  let p = from;
  while (true) {
    const trStart = s.indexOf("<tr", p);
    if (trStart === -1) return -1;
    const trOpenEnd = s.indexOf(">", trStart);
    if (trOpenEnd === -1) return -1;
    const trTag = s.slice(trStart, trOpenEnd + 1);
    const classAttr = extractAttr(trTag, "class") || "";
    if (hasClass(classAttr, "proposalRow")) return trStart;
    p = trOpenEnd + 1;
  }
}

function hasClass(classAttr: string, className: string): boolean {
  if (!classAttr) return false;
  let token = "";
  for (let i = 0; i < classAttr.length; i++) {
    const ch = classAttr[i];
    const isWs = ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
    if (isWs) {
      if (token === className) return true;
      token = "";
    } else token += ch;
  }
  return token === className;
}

function extractFirstNTds(trInner: string, n: number): string[] {
  const out: string[] = [];
  let p = 0;
  for (let i = 0; i < n; i++) {
    const tdStart = trInner.indexOf("<td", p);
    if (tdStart === -1) break;
    const tdOpenEnd = trInner.indexOf(">", tdStart);
    if (tdOpenEnd === -1) break;
    const tdEnd = trInner.indexOf("</td>", tdOpenEnd);
    if (tdEnd === -1) break;
    out.push(trInner.slice(tdOpenEnd + 1, tdEnd));
    p = tdEnd + 5;
  }
  return out;
}

function extractFirstImgSrc(td0: string): string {
  const imgIdx = td0.indexOf("<img");
  if (imgIdx === -1) return "";
  const tagEnd = td0.indexOf(">", imgIdx);
  const tag = tagEnd === -1 ? td0.slice(imgIdx) : td0.slice(imgIdx, tagEnd + 1);
  return extractAttr(tag, "src") || "";
}

function carrierFromLogo(logoSrc: string): string {
  const file = (logoSrc.split("/").pop() ?? "").trim().toLowerCase();
  if (!file) return "Unknown";
  const noExt = file.replace(/\.(svg|png|jpe?g|gif|webp)$/i, "");
  const cleaned = noExt.replace(/logo$/i, "").trim();
  if (!cleaned) return "Unknown";
  if (cleaned === "ups") return "UPS";
  if (cleaned === "dpd") return "DPD";
  if (cleaned === "dhl") return "DHL";
  if (cleaned === "fedex" || cleaned === "fed") return "FedEx";
  if (cleaned === "postnl") return "PostNL";
  return cleaned;
}

function parsePickupSelect(td3: string): { firstBusinessDays: string | null; availablePickupDates: PickupDateOption[] } {
  const selectStart = td3.indexOf('<select class="setDropDate"');
  if (selectStart === -1) return { firstBusinessDays: null, availablePickupDates: [] };
  const selectOpenEnd = td3.indexOf(">", selectStart);
  if (selectOpenEnd === -1) return { firstBusinessDays: null, availablePickupDates: [] };
  const selectEnd = td3.indexOf("</select>", selectOpenEnd);
  if (selectEnd === -1) return { firstBusinessDays: null, availablePickupDates: [] };
  const inner = td3.slice(selectOpenEnd + 1, selectEnd);

  const availablePickupDates: PickupDateOption[] = [];
  let firstBusinessDays: string | null = null;
  let p = 0;
  while (true) {
    const optStart = inner.indexOf("<option", p);
    if (optStart === -1) break;
    const optOpenEnd = inner.indexOf(">", optStart);
    if (optOpenEnd === -1) break;
    const optTag = inner.slice(optStart, optOpenEnd + 1);
    const optClose = inner.indexOf("</option>", optOpenEnd);
    if (optClose === -1) break;
    p = optClose + 9;
    if (optTag.indexOf('disabled="disabled"') !== -1 || optTag.indexOf(" disabled") !== -1) continue;
    const date = extractAttr(optTag, "value") || "";
    const bd = extractAttr(optTag, "businessdaysenroute");
    if (!firstBusinessDays && bd) firstBusinessDays = bd;
    const bdNum = bd ? parseInt(bd, 10) : NaN;
    if (date) availablePickupDates.push({ date, businessDaysEnRoute: Number.isFinite(bdNum) ? bdNum : undefined });
  }
  return { firstBusinessDays, availablePickupDates };
}

function parseHiddenInputs(td5: string): Record<string, string> {
  const postData: Record<string, string> = {};
  const formIdx = td5.indexOf("<form");
  const s = formIdx === -1 ? td5 : td5.slice(formIdx);
  let p = 0;
  while (true) {
    const inStart = s.indexOf("<input", p);
    if (inStart === -1) break;
    const inEnd = s.indexOf(">", inStart);
    if (inEnd === -1) break;
    const tag = s.slice(inStart, inEnd + 1);
    p = inEnd + 1;
    const name = extractAttr(tag, "name");
    if (!name) continue;
    postData[name] = extractAttr(tag, "value") || "";
  }
  return postData;
}

function extractAttr(tagHtml: string, attr: string): string | null {
  const key = attr + '="';
  let i = tagHtml.indexOf(key);
  if (i !== -1) {
    const start = i + key.length;
    const end = tagHtml.indexOf('"', start);
    return end === -1 ? tagHtml.slice(start) : tagHtml.slice(start, end);
  }
  const key2 = attr + "='";
  i = tagHtml.indexOf(key2);
  if (i !== -1) {
    const start = i + key2.length;
    const end = tagHtml.indexOf("'", start);
    return end === -1 ? tagHtml.slice(start) : tagHtml.slice(start, end);
  }
  return null;
}

function parsePrice(td4: string): string {
  const txt = htmlToText(td4);
  let out = "";
  for (let i = 0; i < txt.length; i++) {
    const c = txt.charCodeAt(i);
    if ((c >= 48 && c <= 57) || c === 44) out += txt[i];
  }
  const comma = out.indexOf(",");
  return comma !== -1 ? out.slice(0, comma) + "." + out.slice(comma + 1) : out;
}

function htmlToText(html: string): string {
  const buf: string[] = [];
  let inTag = false;
  let prevSpace = true;
  for (let i = 0; i < html.length; i++) {
    const ch = html[i];
    if (ch === "<") { inTag = true; continue; }
    if (ch === ">") { inTag = false; if (!prevSpace) { buf.push(" "); prevSpace = true; } continue; }
    if (inTag) continue;
    const code = html.charCodeAt(i);
    const isWs = code === 32 || code === 9 || code === 10 || code === 13;
    if (isWs) { if (!prevSpace) { buf.push(" "); prevSpace = true; } continue; }
    buf.push(ch);
    prevSpace = false;
  }
  return collapseWs(decodeEntities(buf.join("")));
}

function collapseWs(s: string): string {
  let out = "";
  let prevSpace = true;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const isWs = c === 32 || c === 9 || c === 10 || c === 13;
    if (isWs) { if (!prevSpace) out += " "; prevSpace = true; }
    else { out += s[i]; prevSpace = false; }
  }
  return out.trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'");
}
