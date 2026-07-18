// Ship de lokale traces naar Axiom (R3.3). In prod een periodieke/streaming stap; hier
// een expliciete flush. Draai met de key geladen:
//   node --env-file=.env --experimental-strip-types src/observability/flush-axiom.ts

import { readFileSync, existsSync } from "node:fs";
import { shipToAxiom, axiomEnabled } from "./axiom.ts";
import { TRACE_FILE } from "./trace.ts";

if (!axiomEnabled()) {
  console.log("AXIOM_API_TOKEN niet geladen (draai met --env-file=.env)");
  process.exit(1);
}
if (!existsSync(TRACE_FILE)) {
  console.log("geen traces om te shippen");
  process.exit(0);
}

const recs = readFileSync(TRACE_FILE, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const r = await shipToAxiom(recs);
console.log(`Axiom flush (${recs.length} traces):`, JSON.stringify(r));
process.exit(r.ok ? 0 : 1);
