// Test van de trace-laag (R3.1): trace-ID per run, gevoelige velden gemaskeerd, en
// "laatste mislukte run van portaal X" opvraagbaar. Gebruikt de trace-API direct
// (portaal 'verify-demo') zodat het offline/overal draait.

import { readFileSync } from "node:fs";
import { startRun, record, finishRun, TRACE_FILE } from "./trace.ts";
import { findLastFailed, getTrace } from "./trace-query.ts";

let fail = 0;
function check(n: string, ok: boolean): void {
  console.log(`  ${ok ? "✓" : "✗"} ${n}`);
  if (!ok) fail++;
}

// 1 geslaagde run — mét gevoelige velden in de payload om masking te toetsen.
const a = startRun("verify-demo", "getRates");
record(a, "payload", { shipper: "NL", password: "geheim-xyz", session: { token: "abc-123" }, cookie: "SID=999" });
finishRun(a, { status: "ok" });

// 1 mislukte run
const b = startRun("verify-demo", "getRates");
record(b, "response", { status: 500 });
finishRun(b, { status: "error", error: "status 500" });

const raw = readFileSync(TRACE_FILE, "utf8");
check("gevoelige velden gemaskeerd (geen 'geheim-xyz'/'abc-123'/'SID=999' in de trace)",
  !raw.includes("geheim-xyz") && !raw.includes("abc-123") && !raw.includes("SID=999"));

const lf = findLastFailed("verify-demo");
check("findLastFailed(portaal) vindt de mislukte run", lf?.traceId === b.traceId && lf?.status === "error");

check("getTrace(id) haalt de geslaagde run op", getTrace(a.traceId)?.status === "ok");

console.log(fail ? `\nFAIL — ${fail} check(s) fout` : "\nOK — trace-laag: trace-ID per run, masking, query op mislukte run per portaal");
process.exit(fail ? 1 : 0);
