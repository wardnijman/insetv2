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

// Minimale maar GELDIGE PDF ("%PDF-1.4", 1 lege A4-pagina, kloppende xref-offsets) —
// als base64 opgeleverd zoals de echte pdf-service dat doet ("JVBER..." = "%PDF").
function buildMockPdf(): string {
  const objs = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>\nendobj\n",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const o of objs) {
    offsets.push(pdf.length);
    pdf += o;
  }
  const xref = pdf.length;
  pdf += `xref\n0 4\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  pdf += `trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return pdf;
}
const MOCK_PDF_BASE64 = Buffer.from(buildMockPdf(), "latin1").toString("base64");

function mockSubmit(session: Session, flow: string, payload: Record<string, unknown>): PortalResponse {
  if (!validSessions.has(session.id)) return { status: 302, loggedOut: true, body: "redirect -> /login" };

  if (flow === "chooseOption") {
    // Echte TFF geeft na chooseOption een submit-sessie + lane-info (access points,
    // paperless-beschikbaarheid); de widget patcht die op de gekozen rate (v1-pad).
    return {
      status: 200,
      loggedOut: false,
      body: { ok: true, sessionKey: `srk-${payload["srk"] ?? "1"}`, accessPoints: [], paperlessAvailable: false },
    };
  }
  if (flow === "finalizeShipment") {
    // Echte TFF: POST /api/email/ per rij (tracking/bevestigingsmails); mock bevestigt.
    const rows = (payload["rows"] as unknown[]) ?? [];
    return { status: 200, loggedOut: false, body: { ok: true, finalized: rows.length } };
  }
  if (flow === "paperlessInvoice") {
    // PAPERLESS (PLT) stap 1 — echte keten: POST invoice.php op de aparte pdf-service
    // (TODO(live): pdf.tffxpress.com/pdf/invoice.php, form-urlencoded = encodeInvoicePhpBody
    // van paperless-mapper, SESSIELOOS) -> base64-PDF die met "JVBER" begint.
    return { status: 200, loggedOut: false, body: { pdfBase64: MOCK_PDF_BASE64 } };
  }
  if (flow === "paperlessInvoiceAttach") {
    // PAPERLESS stap 2+3 — echte keten (TODO(live), MÉT sessie-cookie, dus door de pool):
    // ajax/invoiceTransferPDF.php?id=<sessionkey> (body pltPdfData=JSON-quoted base64) en
    // ajax/set_invoice_plt.php?sessionkey=<sessionkey> (body plt=1).
    return {
      status: 200,
      loggedOut: false,
      body: { ok: true, plt: 1, sessionkey: String(payload["sessionkey"] ?? "") },
    };
  }
  if (flow === "archiveShipment") {
    // v1-LES: TFF's archiveShipment.php geeft HTTP 200 óók als de zending NIET
    // verwijderd is (verse labels: 200 + error-body). v1's deleteShipment las alleen
    // de HTTP-status en meldde dus vals succes. De mock reproduceert beide gevallen
    // zodat de proxy op de BODY moet inspecteren: ref eindigend op "-live" = de
    // niet-annuleerbare (verse) zending -> 200 met error-body.
    const ref = String(payload["shipmentRef"] ?? "");
    if (ref.endsWith("-live")) {
      return { status: 200, loggedOut: false, body: { error: "Label already produced; cannot be archived." } };
    }
    return { status: 200, loggedOut: false, body: { ok: true, archived: ref } };
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
