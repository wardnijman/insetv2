// SQLite-per-tenant (R4.1/O6, dossier §10). Elke tenant een eigen bestand
// .data/<tenant>.db → backup/restore = één bestand kopiëren, isolatie gratis, geen
// noisy-neighbor. Gedeelde portaal-metadata (config/fingerprints) staat NIET hier maar
// in de repo. In prod naast Litestream (WAL→S3) voor continue backup.
//
// Dependency-vrij: Node's ingebouwde node:sqlite (draai met --experimental-sqlite).

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";

const DATA_DIR = ".data";
const cache = new Map<string, DatabaseSync>();

export function tenantDb(tenant: string): DatabaseSync {
  let db = cache.get(tenant);
  if (!db) {
    mkdirSync(DATA_DIR, { recursive: true });
    db = new DatabaseSync(`${DATA_DIR}/${tenant}.db`);
    db.exec(`
      CREATE TABLE IF NOT EXISTS shipments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        portal TEXT, carrier TEXT, service TEXT,
        shipmentRef TEXT, labelUrl TEXT, status TEXT, at TEXT
      );
      CREATE TABLE IF NOT EXISTS traces (
        traceId TEXT PRIMARY KEY, portal TEXT, flow TEXT,
        status TEXT, error TEXT, durationMs INTEGER, at TEXT
      );
      CREATE TABLE IF NOT EXISTS mails (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        shipmentRef TEXT, email TEXT, types TEXT, status TEXT, at TEXT
      );
      CREATE TABLE IF NOT EXISTS orders (
        orderKey TEXT PRIMARY KEY,   -- userId|orderPlatform|orderId
        userId TEXT, orderJson TEXT, shipmentJson TEXT, at TEXT
      );
      CREATE TABLE IF NOT EXISTS errors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId TEXT, token TEXT, error TEXT, shipmentJson TEXT, at TEXT
      );
    `);
    cache.set(tenant, db);
  }
  return db;
}

export interface Shipment {
  portal: string;
  carrier: string;
  service: string;
  shipmentRef: string;
  labelUrl?: string;
  status: "ok" | "error";
}

export function recordShipment(tenant: string, s: Shipment): void {
  tenantDb(tenant)
    .prepare("INSERT INTO shipments (portal, carrier, service, shipmentRef, labelUrl, status, at) VALUES (?,?,?,?,?,?,?)")
    .run(s.portal, s.carrier, s.service, s.shipmentRef, s.labelUrl ?? null, s.status, new Date().toISOString());
}

export function recordTrace(tenant: string, t: { traceId: string; portal: string; flow: string; status: string; error?: string | null; durationMs: number }): void {
  tenantDb(tenant)
    .prepare("INSERT OR REPLACE INTO traces (traceId, portal, flow, status, error, durationMs, at) VALUES (?,?,?,?,?,?,?)")
    .run(t.traceId, t.portal, t.flow, t.status, t.error ?? null, t.durationMs, new Date().toISOString());
}

export function listShipments(tenant: string): Record<string, unknown>[] {
  return tenantDb(tenant).prepare("SELECT * FROM shipments ORDER BY id DESC").all() as Record<string, unknown>[];
}

/** Mail-OUTBOX (audit van de mail-finalisatie na boeken; verzending loopt via de
 *  portaal-flow — de outbox maakt het per tenant navraagbaar). */
export function recordMail(tenant: string, m: { shipmentRef: string; email: string; types: string[]; status: "sent-to-portal" | "skipped" | "error" }): void {
  tenantDb(tenant)
    .prepare("INSERT INTO mails (shipmentRef, email, types, status, at) VALUES (?,?,?,?,?)")
    .run(m.shipmentRef, m.email, m.types.join(","), m.status, new Date().toISOString());
}

export function listMails(tenant: string): Record<string, unknown>[] {
  return tenantDb(tenant).prepare("SELECT * FROM mails ORDER BY id DESC").all() as Record<string, unknown>[];
}

// --- Orders (interim webshop-vervanger tot de sync bedraad is) --------------------
// De OrderOverview leest orders + hun laatste shipment-status hier; manueel gemaakte
// orders en per-order shipment-updates (geboekt/mislukt/geannuleerd) persisteren zo
// echt per tenant, i.p.v. alleen in de browser-store.
function orderKey(userId: string, orderPlatform: string, orderId: string): string {
  return `${userId}|${orderPlatform}|${orderId}`;
}

/** Bewaar/merge een volledige order (v1: /api/orders/set met manueel gemaakte order). */
export function upsertOrder(tenant: string, userId: string, order: any): void {
  const key = orderKey(userId, String(order.orderPlatform ?? "manual"), String(order.orderId ?? ""));
  const db = tenantDb(tenant);
  const existing = db.prepare("SELECT shipmentJson FROM orders WHERE orderKey = ?").get(key) as { shipmentJson?: string } | undefined;
  db.prepare("INSERT OR REPLACE INTO orders (orderKey, userId, orderJson, shipmentJson, at) VALUES (?,?,?,?,?)")
    .run(key, userId, JSON.stringify(order), existing?.shipmentJson ?? null, new Date().toISOString());
}

/** Zet alleen de shipment-status van een order (v1: /api/orders/shipment/set). */
export function setOrderShipment(tenant: string, userId: string, orderPlatform: string, orderId: string, shipment: any): void {
  const key = orderKey(userId, orderPlatform, orderId);
  const db = tenantDb(tenant);
  const existing = db.prepare("SELECT orderJson FROM orders WHERE orderKey = ?").get(key) as { orderJson?: string } | undefined;
  // Order kan nog niet bestaan (shipment-status vóór order-persist) — dan alleen de status.
  db.prepare("INSERT OR REPLACE INTO orders (orderKey, userId, orderJson, shipmentJson, at) VALUES (?,?,?,?,?)")
    .run(key, userId, existing?.orderJson ?? null, JSON.stringify(shipment), new Date().toISOString());
}

/** Alle orders van een gebruiker, elk verrijkt met z'n laatste shipment-status. */
export function listOrders(tenant: string, userId: string): any[] {
  const rows = tenantDb(tenant)
    .prepare("SELECT orderJson, shipmentJson FROM orders WHERE userId = ? ORDER BY at DESC")
    .all(userId) as { orderJson?: string; shipmentJson?: string }[];
  return rows
    .filter((r) => r.orderJson)
    .map((r) => {
      const order = JSON.parse(r.orderJson!);
      if (r.shipmentJson) order.shipment = JSON.parse(r.shipmentJson);
      return order;
    });
}

export function recordError(tenant: string, e: { userId: string; token: string; error: string; shipment: unknown }): void {
  tenantDb(tenant)
    .prepare("INSERT INTO errors (userId, token, error, shipmentJson, at) VALUES (?,?,?,?,?)")
    .run(e.userId, e.token, e.error, JSON.stringify(e.shipment ?? null), new Date().toISOString());
}

/** "Laat de laatste mislukte zending van klant X zien" (R3.1) — één SQL-query. */
export function lastFailedShipment(tenant: string): Record<string, unknown> | undefined {
  return tenantDb(tenant).prepare("SELECT * FROM shipments WHERE status != 'ok' ORDER BY id DESC LIMIT 1").get() as Record<string, unknown> | undefined;
}
