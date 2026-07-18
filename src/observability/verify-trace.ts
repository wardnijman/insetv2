// Test van de multi-tenant trace-laag (R3.1): trace-ID per run, gevoelige velden
// gemaskeerd, en "laatste mislukte run van klant X" opvraagbaar per tenant.

import { readFileSync } from "node:fs";
import { startRun, record, finishRun, TRACE_FILE } from "./trace.ts";
import { findLastFailed, getTrace } from "./trace-query.ts";

let fail = 0;
function check(n: string, ok: boolean): void {
  console.log(`  ${ok ? "✓" : "✗"} ${n}`);
  if (!ok) fail++;
}

// geslaagde run mét gevoelige velden (masking-toets)
const a = startRun("verify-demo", "tff", "getRates");
record(a, "payload", { shipper: "NL", password: "geheim-xyz", session: { token: "abc-123" }, cookie: "SID=999" });
finishRun(a, { status: "ok" });

// mislukte run voor dezelfde tenant
const b = startRun("verify-demo", "tff", "getRates");
record(b, "response", { status: 500 });
finishRun(b, { status: "error", error: "status 500" });

const raw = readFileSync(TRACE_FILE, "utf8");
check("gevoelige velden gemaskeerd (geen 'geheim-xyz'/'abc-123'/'SID=999')",
  !raw.includes("geheim-xyz") && !raw.includes("abc-123") && !raw.includes("SID=999"));

const lf = findLastFailed("verify-demo");
check("findLastFailed(tenant) vindt de mislukte run van die klant", lf?.traceId === b.traceId && lf?.status === "error");

check("getTrace(id) haalt de geslaagde run op", getTrace(a.traceId)?.status === "ok");

console.log(fail ? `\nFAIL — ${fail} check(s) fout` : "\nOK — multi-tenant trace: trace-ID per run, masking, 'laatste mislukte run van klant X'");
process.exit(fail ? 1 : 0);
