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

/** "Laat de laatste mislukte zending van klant X zien" (R3.1) — één SQL-query. */
export function lastFailedShipment(tenant: string): Record<string, unknown> | undefined {
  return tenantDb(tenant).prepare("SELECT * FROM shipments WHERE status != 'ok' ORDER BY id DESC LIMIT 1").get() as Record<string, unknown> | undefined;
}
