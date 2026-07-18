// Live-check van de Axiom-wiring: stuurt één test-event. Draai met de key geladen:
//   node --env-file=.env --experimental-strip-types src/observability/verify-axiom.ts

import { shipToAxiom, axiomEnabled } from "./axiom.ts";

if (!axiomEnabled()) {
  console.log("AXIOM_API_TOKEN niet geladen (draai met --env-file=.env)");
  process.exit(1);
}

const r = await shipToAxiom([{ source: "inset", kind: "wire-test", note: "axiom-exporter live-check" }]);
console.log("Axiom ingest:", JSON.stringify(r));
process.exit(r.ok ? 0 : 1);
