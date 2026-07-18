// Boek-capabilities per portaal (R1.3). Écht boeken is geen routinetestlaag maar een
// per-portaal capability met harde grenzen; deze guard dwingt Wards regels af in code,
// niet in geheugen. De booking-flow MOET assertBookable() aanroepen vóór een submit.

import { readFileSync } from "node:fs";

export interface BookingCapability {
  /** live = echte boeking mag; sandbox = alleen sandbox; deletable = alleen als verwijderbaar; never = nooit. */
  mode: "live" | "sandbox" | "deletable" | "never";
  blockCarriers?: string[];
  blockServicePatterns?: string[];
  deletionVerified?: boolean;
  note?: string;
}

export function loadBooking(portal: string): BookingCapability {
  const cap = JSON.parse(readFileSync(`portals/${portal}/capabilities.json`, "utf8"));
  return cap.booking as BookingCapability;
}

/** Gooit als een boeking voor deze carrier/service niet is toegestaan. Faalt gesloten. */
export function assertBookable(portal: string, rate: { carrier?: string; service?: string }): void {
  const b = loadBooking(portal);
  const carrier = String(rate.carrier ?? "");
  const service = String(rate.service ?? "");

  if (b.mode === "never") {
    throw new Error(`[capability] ${portal}: boeken staat uit (mode=never)`);
  }
  if (b.mode === "deletable" && !b.deletionVerified) {
    throw new Error(`[capability] ${portal}: boeken geblokkeerd — verwijderen nog niet geverifieerd (deletionVerified=false). ${b.note ?? ""}`);
  }
  for (const c of b.blockCarriers ?? []) {
    if (carrier.toLowerCase().includes(c.toLowerCase())) {
      throw new Error(`[capability] ${portal}: carrier '${carrier}' geblokkeerd (bevat '${c}'). ${b.note ?? ""}`);
    }
  }
  for (const p of b.blockServicePatterns ?? []) {
    if (new RegExp(p, "i").test(service)) {
      throw new Error(`[capability] ${portal}: service '${service}' geblokkeerd (express-patroon '${p}').`);
    }
  }
}
