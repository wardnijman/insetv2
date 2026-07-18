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

/** Zet een waarde op een genest pad ("departureLocation.address.country"), tussenobjecten aanmakend. */
export function setPath(obj: Record<string, any>, path: string, value: unknown): void {
  const parts = path.split(".");
  let cur: Record<string, any> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (cur[k] == null || typeof cur[k] !== "object") cur[k] = {};
    cur = cur[k];
  }
  cur[parts[parts.length - 1]] = value;
}

/** Deterministische, content-addressed hash van een config (compiler is hermetisch). */
export function hashConfig(obj: unknown): string {
  return createHash("sha256").update(JSON.stringify(obj)).digest("hex").slice(0, 12);
}
