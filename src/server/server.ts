// Widget-proxy (PROXY-FIRST besluit 2026-07-18): de widget praat NOOIT rechtstreeks
// met een portaal — alle portaal-verkeer loopt via deze server, die de bestaande
// runtime hergebruikt (SessionPool + adapter + gecompileerde transforms). Creds en
// sessies blijven daarmee serverside (vault/pool), voor embedded én standalone tenants.
//
// Tenant-scoping via het PAD: /t/<tenantId>/api/… — de tenant-config zet precies deze
// base in host.endpoints.api, dus de widget hoeft nergens een tenant mee te sturen.
// Dependency-vrij: node:http + node:sqlite (draai met --experimental-sqlite).

import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { SessionPool } from "../runtime/pool.ts";
import { loadAdapter, runFlow } from "../runtime/execute.ts";
import { assertBookable } from "../runtime/capabilities.ts";
import { startRun, record, finishRun } from "../observability/trace.ts";
import { tenantDb, recordShipment, recordMail } from "../db/tenant-db.ts";
import { US_STATES, CA_PROVINCES } from "./regions.ts";

interface TenantConfig {
  id: string;
  providers: string[];
}

// --- tenant + pool cache ---------------------------------------------------------
const tenants = new Map<string, TenantConfig>();
function getTenant(id: string): TenantConfig {
  let t = tenants.get(id);
  if (!t) {
    t = JSON.parse(readFileSync(`tenants/${id}.json`, "utf8")) as TenantConfig;
    tenants.set(id, t);
  }
  return t;
}

const pools = new Map<string, SessionPool>();
async function getPool(portal: string): Promise<SessionPool> {
  let p = pools.get(portal);
  if (!p) {
    p = new SessionPool(await loadAdapter(portal));
    pools.set(portal, p);
  }
  return p;
}

// Payload-builders per portaal (fabriek-emit, oracle-bewezen) — lazy zoals loadTransform.
const payloadMods = new Map<string, { buildChoosePayload: (i: any) => Record<string, unknown>; buildSubmitPayload: (formId: string, i: any) => Record<string, unknown> }>();
async function getPayloadBuilders(portal: string) {
  let m = payloadMods.get(portal);
  if (!m) {
    m = await import(`../../generated/${portal}/widget/payload.ts`);
    payloadMods.set(portal, m!);
  }
  return m!;
}

/** Als runFlow, maar met een VOORGEBOUWDE payload (choose/submit uit de payload-builders). */
async function runPrebuilt(pool: SessionPool, tenant: string, portal: string, flow: string, payload: Record<string, unknown>): Promise<any> {
  const ctx = startRun(tenant, portal, flow);
  record(ctx, "payload", payload);
  try {
    const resp = await pool.submit(flow, payload);
    record(ctx, "response", { status: resp.status });
    if (resp.status !== 200) throw new Error(`flow ${flow} faalde: status ${resp.status}`);
    finishRun(ctx, { status: "ok" });
    return resp.body;
  } catch (e) {
    finishRun(ctx, { status: "error", error: (e as Error).message });
    throw e;
  }
}

// --- prefs-opslag (adresboek, pakket-templates) in de per-tenant SQLite -----------
function prefsTable(tenant: string) {
  const db = tenantDb(tenant);
  db.exec("CREATE TABLE IF NOT EXISTS prefs (userId TEXT PRIMARY KEY, json TEXT)");
  return db;
}

function getPrefs(tenant: string, userId: string): Record<string, unknown> {
  const row = prefsTable(tenant)
    .prepare("SELECT json FROM prefs WHERE userId = ?")
    .get(userId) as { json?: string } | undefined;
  return row?.json ? JSON.parse(row.json) : {};
}

function setPrefs(tenant: string, userId: string, prefs: Record<string, unknown>): void {
  prefsTable(tenant)
    .prepare("INSERT OR REPLACE INTO prefs (userId, json) VALUES (?, ?)")
    .run(userId, JSON.stringify(prefs));
}

/** v1-contract: update = { "preferences.receiverProfiles": value } — pad diep zetten. */
function deepSet(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split(".");
  let cur: Record<string, unknown> = obj;
  for (const k of keys.slice(0, -1)) {
    if (typeof cur[k] !== "object" || cur[k] === null) cur[k] = {};
    cur = cur[k] as Record<string, unknown>;
  }
  cur[keys[keys.length - 1]] = value;
}

// --- canoniek zendingsmodel (widget) -> flow-input (fabriek-veld-stel) -------------
interface WidgetAddress {
  country?: string;
  postalCode?: string;
  street?: string[];
}
interface WidgetShipment {
  shipperAddress?: WidgetAddress;
  recipientAddress?: WidgetAddress;
  packages?: { weight?: number }[];
}

function toFlowInput(s: WidgetShipment) {
  const addr = (a?: WidgetAddress) => ({
    country: a?.country ?? "",
    postcode: a?.postalCode ?? "",
    street: a?.street?.[0] ?? "",
  });
  const weightKg = (s.packages ?? []).reduce((sum, p) => sum + (Number(p.weight) || 0), 0);
  return {
    shipper: addr(s.shipperAddress),
    recipient: addr(s.recipientAddress),
    package: { weightKg },
  };
}

// --- http-machinerie ---------------------------------------------------------------
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.setHeader(k, v);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url ?? "/", "http://localhost");
  const m = /^\/t\/([^/]+)(\/api\/.*)$/.exec(url.pathname);
  if (!m) return json(res, 404, { error: "unknown_route" });
  const [, tenantId, route] = m;

  let tenant: TenantConfig;
  try {
    tenant = getTenant(tenantId);
  } catch {
    return json(res, 404, { error: "unknown_tenant" });
  }

  try {
    if (route === "/api/rates" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const portal = tenant.providers[0];
      const pool = await getPool(portal);
      const shipment = body.shipment ?? {};

      let raw: any;
      if ((process.env.INSET_ADAPTER ?? "mock") === "live") {
        // Live: de volledige wizard-velden-transform van de live adapter (de
        // generated getRates-transform is de compacte demo-subset).
        const mod = await import(`../../portals/${portal}/adapter-live.ts`);
        const input = {
          ...shipment,
          shipmentOptions: {
            ...(shipment.shipmentOptions ?? {}),
            truckShipmentInfo: shipment.shipmentOptions?.truckShipmentInfo ?? {},
          },
        };
        raw = await runPrebuilt(pool, tenantId, portal, "getRates", mod.transformGetRatesInput(input));
      } else {
        raw = await runFlow(pool, tenantId, portal, "getRates", toFlowInput(shipment));
      }
      // Normaliseer: mock geeft {rates}, live geeft {result, reason}.
      return json(res, 200, { rates: raw?.rates ?? raw?.result ?? [], ...(raw?.reason ? { reason: raw.reason } : {}) });
    }

    if (route === "/api/config/get" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)) || "{}");
      return json(res, 200, getPrefs(tenantId, String(body.userId ?? "")));
    }

    if (route === "/api/config/update" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const userId = String(body.userId ?? "");
      const prefs = getPrefs(tenantId, userId);
      for (const [path, value] of Object.entries(body.update ?? {})) deepSet(prefs, path, value);
      setPrefs(tenantId, userId, prefs);
      return json(res, 200, { ok: true });
    }

    if (route === "/api/domain/country-and-region" && req.method === "GET") {
      const country = (url.searchParams.get("country") ?? "").toUpperCase();
      const regions = country === "US" ? US_STATES : country === "CA" ? CA_PROVINCES : [];
      return json(res, 200, regions);
    }

    if (route === "/api/ai/parse-address" && req.method === "POST") {
      // Interim: paste-parse (LLM) is nog niet bedraad in v2; de widget toont dan
      // netjes "Automatisch invullen is niet beschikbaar" (503-contract van v1).
      return json(res, 503, { ok: false, error: "ai_not_configured" });
    }

    if (route === "/api/choose" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const portal = tenant.providers[0];
      const { buildChoosePayload } = await getPayloadBuilders(portal);
      const pool = await getPool(portal);
      const result = await runPrebuilt(pool, tenantId, portal, "chooseOption",
        buildChoosePayload({ reusableData: body.chosenRate?.reusableData ?? {} }));
      return json(res, 200, result);
    }

    if (route === "/api/book" && req.method === "POST") {
      // De volledige boek-keten: capability-guard -> chooseOption -> submit -> registratie.
      const body = JSON.parse((await readBody(req)) || "{}");
      const portal = tenant.providers[0];
      const shipment = body.shipment ?? {};
      const chosenRate = body.chosenRate ?? shipment?.shipmentOptions?.chosenRate ?? {};
      const carrier = String(chosenRate?.reusableData?.choose_carrier ?? chosenRate?.carrier ?? "");
      const service = String(chosenRate?.reusableData?.choose_service ?? chosenRate?.service ?? "");
      const formId = String(body.fingerprint ?? "");
      if (!formId) return json(res, 422, { error: "missing_fingerprint", message: "Geen formulier-fingerprint voor deze lane/rate." });

      // Wards boek-beleid in CODE — faalt gesloten (nooit Mainfreight/express, R1.3).
      try {
        assertBookable(portal, { carrier, service });
      } catch (e) {
        return json(res, 403, { error: "blocked_by_policy", message: (e as Error).message });
      }

      const { buildChoosePayload, buildSubmitPayload } = await getPayloadBuilders(portal);
      const pool = await getPool(portal);
      await runPrebuilt(pool, tenantId, portal, "chooseOption",
        buildChoosePayload({ reusableData: chosenRate?.reusableData ?? {} }));
      const input = { ...shipment, source: shipment.source ?? "manual", customsDocuments: shipment.customsDocuments ?? [] };
      const result = await runPrebuilt(pool, tenantId, portal, `submitShipment${formId}`, buildSubmitPayload(formId, input));

      const shipmentRef = String(result?.zendingnummer ?? result?.shipmentRef ?? "");
      recordShipment(tenantId, { portal, carrier, service, shipmentRef, status: "ok" });

      // MAIL-FINALISATIE (v1-clientlogica, nu serverside): tracking-/bevestigings-
      // mails via TFF's /api/email/ — een portaal-flow door de pool. Fail-soft:
      // een mailfout mag de (al gelukte) boeking nooit laten falen. Outbox in de
      // tenant-DB maakt het navraagbaar.
      const userId = String(body.userId ?? "");
      let mailStatus: "sent-to-portal" | "skipped" | "error" = "skipped";
      try {
        const prefs = getPrefs(tenantId, userId);
        const trackingMail = (prefs as any).trackingMailEnabled ?? true;
        const confirmationMail = (prefs as any).labelConfirmationMailEnabled ?? true;
        const email = String(shipment.recipientAddress?.email ?? "");
        const types = [...(trackingMail ? ["tracking"] : []), ...(confirmationMail ? ["confirmation", "labels"] : [])];
        if ((trackingMail || confirmationMail) && email) {
          const rows = [{
            shipment_id: shipmentRef,
            email,
            shipmentDetails: confirmationMail,
            shipmentTracking: trackingMail,
            shipmentConfirmation: confirmationMail,
            shipmentLabels: confirmationMail,
            language: (prefs as any).language ?? "NL",
            pageId: "",
            i: 0,
          }];
          await runPrebuilt(pool, tenantId, portal, "finalizeShipment", { rows, extCustomerId: userId, sessionkey: "" });
          mailStatus = "sent-to-portal";
        }
        recordMail(tenantId, { shipmentRef, email, types, status: mailStatus });
      } catch (e) {
        mailStatus = "error";
        recordMail(tenantId, { shipmentRef, email: String(shipment.recipientAddress?.email ?? ""), types: [], status: "error" });
        console.warn(`mail-finalisatie faalde (boeking staat): ${(e as Error).message}`);
      }

      return json(res, 200, { ok: true, carrier, service, mailFinalization: mailStatus, ...result });
    }

    if (route === "/api/service-points" && req.method === "GET") {
      // Interim: access points komen later via het portaal; lege lijst degradeert
      // de AccessPointSelector netjes ("geen access points beschikbaar").
      return json(res, 200, []);
    }

    if ((route === "/api/ai/suggest-hs" || route === "/api/ai/search-hs") && req.method === "POST") {
      // Interim: HS-suggestie (LLM) nog niet bedraad — zelfde 503-contract; de
      // HS-input degradeert naar handmatig invullen (v1 is daar al fail-soft op).
      return json(res, 503, { ok: false, error: "ai_not_configured" });
    }

    if (route === "/api/product-profiles/get" && req.method === "GET") {
      // Per-SKU productgeheugen (HS/waarde/gewicht/herkomst uit eerdere boekingen).
      // Opslag in de per-tenant prefs onder "productProfiles" — zelfde DB als config.
      const userId = url.searchParams.get("userId") ?? "";
      const prefs = getPrefs(tenantId, userId);
      return json(res, 200, (prefs.productProfiles as Record<string, unknown>) ?? {});
    }

    if (route === "/api/product-profiles/learn" && req.method === "POST") {
      // v1-contract: body = { userId, products: ProductTemplate[] }; de server leidt
      // per-SKU profielen af en merget PER VELD — deeldata wist nooit een eerder
      // geleerde waarde.
      const body = JSON.parse((await readBody(req)) || "{}");
      const userId = String(body.userId ?? "");
      const prefs = getPrefs(tenantId, userId);
      const profiles = (prefs.productProfiles as Record<string, Record<string, unknown>>) ?? {};
      for (const p of (body.products ?? []) as Record<string, unknown>[]) {
        const sku = String(p.sku ?? "");
        if (!sku) continue;
        const prof = profiles[sku] ?? {};
        if (typeof p.hsCode === "string" && p.hsCode.trim()) prof.hsCode = p.hsCode;
        if (Number(p.value) > 0) prof.value = Number(p.value);
        if (Number(p.weight) > 0) prof.weight = Number(p.weight);
        if (typeof p.originCountry === "string" && p.originCountry.trim()) prof.originCountry = p.originCountry;
        profiles[sku] = prof;
      }
      prefs.productProfiles = profiles;
      setPrefs(tenantId, userId, prefs);
      return json(res, 200, { ok: true });
    }

    return json(res, 404, { error: "unknown_route" });
  } catch (e) {
    return json(res, 500, { error: (e as Error).message });
  }
}

export function startServer(port: number): Promise<{ port: number; close: () => Promise<void> }> {
  const server = createServer((req, res) => void handle(req, res));
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      const actualPort = typeof addr === "object" && addr ? addr.port : port;
      resolve({
        port: actualPort,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

// Direct gestart (npm run server) — niet bij import door verify-server. Let op:
// basename-VERGELIJKING, geen endsWith ("verify-server.ts" eindigt óók op "server.ts").
if (process.argv[1] && basename(process.argv[1]) === "server.ts") {
  const port = Number(process.env.PORT ?? 5199);
  const { port: p } = await startServer(port);
  console.log(`widget-proxy luistert op http://127.0.0.1:${p} (routes: /t/<tenant>/api/...)`);
}
