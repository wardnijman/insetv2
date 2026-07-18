// Validatie van de compiler-generalisatie (§4.6, wijziging 3): draai TransHeroes'
// fields.json door de ECHTE fabriek en vergelijk de output met de handgeschreven
// oracle (transformGetRatesInput in adapter-live.ts). Zelfde zending -> zelfde
// TransHeroes JSON-body, ondanks nested paden + array-of-objects + const + reference-lookup.
//
// Draai eerst: npm run compile transheroes
// Draai dit:   node --experimental-strip-types src/fabriek/verify-generalized.ts

import { transform as compiled } from "../../generated/transheroes/getRates.ts";
import { transformGetRatesInput as oracle } from "../../portals/transheroes/adapter-live.ts";

const NOW = "2026-07-18T00:00:00.000Z";
const shipment = {
  shipper:   { country: "NL", street: ["Damrak", "1"], city: "Amsterdam", postalCode: "1011AB" },
  recipient: { country: "DE", street: ["Unter den Linden", "1"], city: "Berlin", postalCode: "10117" },
  packages:  [{ type: "pallet", length: 120, width: 80, height: 100, weight: 250, stackable: true }],
};

// De config gebruikt een schonere canonieke vorm (shipper.*, postcode, meta.now);
// de oracle gebruikt de v1-vorm (shipperAddress.*, postalCode). Zelfde zending.
const cfgInput = {
  meta: { now: NOW },
  shipper:   { country: shipment.shipper.country, street: shipment.shipper.street, city: shipment.shipper.city, postcode: shipment.shipper.postalCode },
  recipient: { country: shipment.recipient.country, street: shipment.recipient.street, city: shipment.recipient.city, postcode: shipment.recipient.postalCode },
  packages:  shipment.packages,
};
const oracleInput = {
  shipperAddress:   shipment.shipper,
  recipientAddress: shipment.recipient,
  packages:         shipment.packages,
};

function deepEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a == null || b == null) return false;
  if (typeof a === "object") {
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

const got: any = compiled(cfgInput);
const want: any = oracle(oracleInput);

// departureDate is een timestamp: apart toetsen, uit de deep-equal halen.
const gotDate = got.departureDate;
delete got.departureDate;
delete want.departureDate;

const structuralMatch = deepEqual(got, want);
const dateOk = gotDate === NOW;

console.log("TransHeroes: gecompileerde transform vs hand-oracle (excl. departureDate):", structuralMatch ? "IDENTIEK ✓" : "VERSCHIL ✗");
if (!structuralMatch) {
  console.log("  got :", JSON.stringify(got));
  console.log("  want:", JSON.stringify(want));
}
console.log("departureDate uit meta.now (deterministisch):", dateOk ? `OK (${gotDate})` : `MISMATCH (${gotDate})`);
console.log(structuralMatch && dateOk ? "\nOK — de fabriek reproduceert de API-portaal-transform exact." : "\nFAIL");
process.exit(structuralMatch && dateOk ? 0 : 1);
