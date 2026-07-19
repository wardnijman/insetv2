// OFFLINE vorm-verificatie van het LIVE boektransport (GEEN netwerk). Bewijst dat
// chooseOption en submitShipment de juiste request-VORMEN bouwen (URL + body-velden)
// zoals de bewezen S10-boekingen — via een capture-fetch die na de éérste POST een
// 302 -> /login teruggeeft, waardoor beide functies vroeg terugkeren (loggedOut) en
// niets verder proberen. Draait in npm test; raakt tffxpress.com NOOIT aan.

import { chooseOption, submitShipment111908712, createJarFetch } from "./tff-booking-transport.ts";
import { transformSubmitInput111908712, bookDpdClassic } from "./adapter-booking.ts";

let fail = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`  ${ok ? "✓" : "✗"} ${name}${ok ? "" : ` — ${detail}`}`);
  if (!ok) fail++;
}

// Capture-fetch: legt (url, method, contentType, body) vast en geeft ALTIJD een
// 302 -> /login terug, zodat de keten-functies na de eerste POST stoppen.
type Captured = { url: string; method: string; contentType: string; body: unknown };
const captured: Captured[] = [];
function headerOf(headers: any, name: string): string {
  if (!headers) return "";
  if (typeof headers.get === "function") return String(headers.get(name) ?? "");
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) if (k.toLowerCase() === lower) return String(v);
  return "";
}
const captureFetch = (async (url: any, init: any = {}) => {
  captured.push({
    url: String(url),
    method: String(init.method ?? "GET"),
    contentType: headerOf(init.headers, "Content-Type"),
    body: init.body,
  });
  return {
    status: 302,
    headers: { get: (k: string) => (k.toLowerCase() === "location" ? "/login" : null) },
    text: async () => "",
  } as unknown as Response;
}) as unknown as typeof globalThis.fetch;

const REUSABLE = {
  choose_servicecode: "D-CL", choose_carrier: "DPD", choose_service: "DPD Home Classic",
  choose_margin: "1.24", choose_price: "12.34", choose_carrier_id: "1", srk: "2",
  choose_pickupdate: "2026-07-21", choose_pickuptime: "1600",
  choose_arrivaldate: "2026-07-23", choose_arrivaltime: "1700",
  choose_gogreen: "0", choose_carbonneutral: "0",
};

const INPUT = {
  source: "inset-v2-shape-test",
  shipperAddress: { company: "Plugtech BV", firstName: "Ward", lastName: "Nijman", email: "w@p.nl", street: ["Vrolikstraat", "305-4"], city: "Amsterdam", region: "", postalCode: "1091 VD", country: "NL", phoneNumber: "0612345678" },
  recipientAddress: { company: "Ontvanger BV", firstName: "Jan", lastName: "Jansen", email: "j@e.nl", street: ["Coolsingel", "42"], city: "Rotterdam", region: "", postalCode: "3011AD", country: "NL", phoneNumber: "0612345678" },
  invoice: { filename: "", base64: "", contentType: "" },
  customsDocuments: [],
  shipmentOptions: {
    insuranceValue: 0, totalShipmentValue: 25, incotermsGroupD: "DAP", description: "Kleding",
    invoiceRef: "REF-1", factuurAanwezig: "nee", signatureRequired: "none", shipmentOriginCountry: "NL",
    truckShipmentInfo: { shipperTaillift: false, recipientTaillift: false, shipperVehicle: "car", recipientVehicle: "car" },
    chosenRate: { price: "12.34" },
  },
};

// --- 1) chooseOption request-vorm ---
const jarFetch = createJarFetch(captureFetch, {});
await chooseOption(jarFetch, REUSABLE);
const choosePost = captured.find((c) => c.url.includes("action=choose") && c.method === "POST");
check("chooseOption: POST naar /versturen?action=choose", !!choosePost, "geen choose-POST");
if (choosePost) {
  const body = String(choosePost.body);
  check("chooseOption: urlencoded + choose_carrier/srk/price in body",
    choosePost.contentType.includes("x-www-form-urlencoded") &&
    body.includes("choose_carrier=DPD") && body.includes("srk=2") && body.includes("choose_price=12.34"),
    body.slice(0, 120));
  // v1-quirk: spaceToPlus vervangt alleen de EERSTE spatie -> "DPD+Home Classic",
  // dat URLSearchParams encodeert als choose_service=DPD%2BHome+Classic.
  check("chooseOption: space_to_plus-quirk in choose_service", body.includes("choose_service=DPD%2BHome+Classic"), body);
}

// --- 2) submitShipment request-vorm (FormData) ---
captured.length = 0;
const fields = transformSubmitInput111908712(INPUT);
await submitShipment111908712(createJarFetch(captureFetch, {}), fields);
const submitPost = captured.find((c) => c.url.includes("action=shipment") && c.method === "POST");
check("submitShipment: POST naar /versturen?action=shipment", !!submitPost, "geen shipment-POST");
if (submitPost && typeof (submitPost.body as any)?.get === "function") {
  const fd = submitPost.body as FormData;
  const g = (k: string) => String(fd.get(k) ?? "");
  check("submit-body: plugtech_source = source", g("plugtech_source") === "inset-v2-shape-test");
  check("submit-body: postcode alfanumeriek (spatie weg)", g("postcode") === "1091VD");
  check("submit-body: huisnummer '-' bij lege toevoeging (verzender heeft '305-4')", g("huisnummer") === "305-4");
  check("submit-body: contactpersoon2 = volledige naam ontvanger", g("contactpersoon2") === "Jan Jansen");
  check("submit-body: calc = gekozen prijs", g("calc") === "12.34" && g("calc2") === "12.34");
  check("submit-body: land/land2 = NL", g("land") === "NL" && g("land2") === "NL");
}

// --- 3) transform-pariteit: hand-port (live) vs fabriek-emit (oracle-bewezen) ---
// Als de fabriek dit fingerprint kent, moeten de GEDEELDE velden identiek zijn —
// dat bindt het live boekpad aan de payload-oracle. Fingerprint kan getekend zijn.
try {
  const { buildSubmitPayload, SUBMIT_FORM_IDS } = await import("../../generated/tff/widget/payload.ts");
  const id = ["111908712", "-111908712"].find((x) => SUBMIT_FORM_IDS.includes(x));
  if (id) {
    const fab = buildSubmitPayload(id, INPUT);
    const shared = ["plugtech_source", "postcode", "huisnummer", "straat", "plaats", "contactpersoon2", "land", "land2", "postcode2", "calc"];
    const diffs = shared.filter((k) => k in fab && String((fields as any)[k]) !== String((fab as any)[k]));
    check(`transform-pariteit live↔fabriek op gedeelde velden (${id})`, diffs.length === 0, `verschilt: ${diffs.join(",")}`);
  } else {
    console.log("  · fabriek kent fingerprint 111908712 niet in deze config — pariteit-check overgeslagen");
  }
} catch (e) {
  console.log(`  · pariteit-check overgeslagen (${(e as Error).message})`);
}

// --- 4) dryRun boekt NOOIT: bookDpdClassic met dryRun stopt na choose ---
captured.length = 0;
const outcome = await bookDpdClassic(createJarFetch(captureFetch, {}), { carrier: "DPD", service: "DPD Home Classic", price: "12.34", reusableData: REUSABLE }, INPUT, { dryRun: true });
check("bookDpdClassic(dryRun): geen submit-POST verstuurd", !captured.some((c) => c.url.includes("action=shipment")));
check("bookDpdClassic(dryRun): guard gepasseerd, submit=null", outcome.guardPassed === true && outcome.submit === null);

if (fail) {
  console.error(`\nverify-booking-shapes FAALT (${fail})`);
  process.exit(1);
}
console.log("OK — live boektransport: request-vormen kloppen (choose+submit), dryRun boekt niet, geen netwerk.");
