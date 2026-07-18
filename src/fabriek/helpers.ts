// Fabriek-hulpstukken: padresolutie, canonicalisatie-pass en config-hash.

import { createHash } from "node:crypto";

/** Leest een genest pad ("shipper.country") uit een object. */
export function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>(
    (o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]),
    obj,
  );
}

/**
 * Canonicalisatie-pass (diepte §A.4): strip volatiele velden (sessietokens,
 * honeypots, timestamps) en zet een stabiele sleutelvolgorde, vóór vergelijken/hashen.
 * Hier komt bijna alle valse drift vandaan als je het NIET doet.
 */
export function canonicalize(
  payload: Record<string, unknown>,
  dropFields: string[] = [],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(payload).sort()) {
    if (dropFields.includes(k)) continue;
    out[k] = payload[k];
  }
  return out;
}

/** Deterministische, content-addressed hash van een config (compiler is hermetisch). */
export function hashConfig(obj: unknown): string {
  return createHash("sha256").update(JSON.stringify(obj)).digest("hex").slice(0, 12);
}
