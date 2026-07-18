// Trace-query (R3.1). CLI + functies: "toon een trace" en "toon de laatste mislukte
// run [van portaal X]" — één commando i.p.v. handmatig de db pollen (v1's pijn).
//
// CLI:  node --experimental-strip-types src/observability/trace-query.ts <traceId>
//       node --experimental-strip-types src/observability/trace-query.ts --last-failed [portaal]

import { readFileSync, existsSync } from "node:fs";
import { TRACE_FILE } from "./trace.ts";

export interface TraceRec {
  traceId: string;
  portal: string;
  flow: string;
  status: string;
  error: string | null;
  durationMs: number;
  at: string;
  events: unknown[];
}

function all(): TraceRec[] {
  if (!existsSync(TRACE_FILE)) return [];
  return readFileSync(TRACE_FILE, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as TraceRec);
}

export function getTrace(id: string): TraceRec | undefined {
  return all().find((r) => r.traceId === id);
}

export function findLastFailed(portal?: string): TraceRec | undefined {
  const failed = all().filter((r) => r.status !== "ok" && (!portal || r.portal === portal));
  return failed[failed.length - 1];
}

// CLI (alleen als dit bestand direct wordt gedraaid, niet bij import).
if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = process.argv[2];
  if (arg === "--last-failed") {
    const r = findLastFailed(process.argv[3]);
    console.log(r ? JSON.stringify(r, null, 2) : "geen mislukte run gevonden");
  } else if (arg) {
    const r = getTrace(arg);
    console.log(r ? JSON.stringify(r, null, 2) : `geen trace met id ${arg}`);
  } else {
    console.log("gebruik: trace-query <traceId> | --last-failed [portaal]");
  }
}
