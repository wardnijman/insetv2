// Trace-query (R3.1). "Toon de laatste mislukte run van klant X [op portaal Y]" — één
// commando i.p.v. handmatig de db pollen (v1's pijn).
//
// CLI:  node --experimental-strip-types src/observability/trace-query.ts <traceId>
//       node --experimental-strip-types src/observability/trace-query.ts --last-failed <tenant> [portaal]

import { readFileSync, existsSync } from "node:fs";
import { TRACE_FILE } from "./trace.ts";

export interface TraceRec {
  traceId: string;
  tenant: string;
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

export function findLastFailed(tenant?: string, portal?: string): TraceRec | undefined {
  const failed = all().filter((r) => r.status !== "ok" && (!tenant || r.tenant === tenant) && (!portal || r.portal === portal));
  return failed[failed.length - 1];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = process.argv[2];
  if (arg === "--last-failed") {
    const r = findLastFailed(process.argv[3], process.argv[4]);
    console.log(r ? JSON.stringify(r, null, 2) : "geen mislukte run gevonden");
  } else if (arg) {
    const r = getTrace(arg);
    console.log(r ? JSON.stringify(r, null, 2) : `geen trace met id ${arg}`);
  } else {
    console.log("gebruik: trace-query <traceId> | --last-failed <tenant> [portaal]");
  }
}
