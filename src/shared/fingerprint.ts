// Gedeelde fingerprint-logica. Recorder (ingest) én drift-probe gebruiken DEZELFDE
// functies, zodat de vergelijking apples-to-apples is en aan de portaalkant gebeurt
// (R1.6). Volatiele velden (tokens/honeypots/timestamps) tellen niet mee -> dezelfde
// form met een ander token geeft dezelfde fingerprint (diepte §A.4).

import { hashConfig } from "../fabriek/helpers.ts";

export const VOLATILE_NAME =
  /(^_?token$|csrf|xsrf|nonce|timestamp|_ts$|sessi|honeypot|^hp_|^website$|^ks$)/i;

export function looksRandom(v: unknown): boolean {
  const s = String(v ?? "");
  return s.length >= 16 && /^[A-Za-z0-9_-]+$/.test(s) && /[0-9]/.test(s) && /[A-Za-z]/.test(s);
}

/** Splitst velden in stabiel vs volatiel. `fields` mag een namen-array of naam->waarde zijn. */
export function classify(
  fields: string[] | Record<string, unknown>,
): { stable: string[]; volatile: string[] } {
  const entries: Array<readonly [string, unknown]> = Array.isArray(fields)
    ? fields.map((n) => [n, ""] as const)
    : Object.entries(fields);
  const stable: string[] = [];
  const volatile: string[] = [];
  for (const [name, value] of entries) {
    if (VOLATILE_NAME.test(name) || looksRandom(value)) volatile.push(name);
    else stable.push(name);
  }
  return { stable: stable.sort(), volatile: volatile.sort() };
}

/** Fingerprint = hash van het gesorteerde stabiele veld-stel. */
export function fingerprintOf(stable: string[]): string {
  return hashConfig([...stable].sort());
}
