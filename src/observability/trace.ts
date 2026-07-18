// Trace-laag (R3.1/R3.3). Elke run (getRates, boeking, sync) krijgt een trace-ID en
// legt zijn verloop vast — gemaskeerd (nooit creds/tokens). "Laat de laatste mislukte
// run van portaal X zien" wordt dan één query (trace-query.ts). OTel-vormig: één
// trace-ID per run met events; backend (Axiom/BetterStack) later inpluggen op ditzelfde.

import { randomBytes } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";

const TRACE_DIR = ".traces";
const TRACE_FILE = `${TRACE_DIR}/traces.jsonl`;

// Veldnamen die nooit in een trace mogen belanden.
const SENSITIVE = /pass|token|cookie|authorization|csrf|secret|bearer|phpsessid/i;

export function mask(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(mask);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) out[k] = SENSITIVE.test(k) ? "[REDACTED]" : mask(val);
    return out;
  }
  return v;
}

export interface RunCtx { traceId: string; portal: string; flow: string; t0: number; events: unknown[] }

export function startRun(portal: string, flow: string): RunCtx {
  return { traceId: randomBytes(8).toString("hex"), portal, flow, t0: Date.now(), events: [] };
}

export function record(ctx: RunCtx, name: string, data: unknown): void {
  ctx.events.push({ name, atMs: Date.now() - ctx.t0, data: mask(data) });
}

export function finishRun(ctx: RunCtx, outcome: { status: "ok" | "error"; error?: string }): void {
  mkdirSync(TRACE_DIR, { recursive: true });
  const rec = {
    traceId: ctx.traceId,
    portal: ctx.portal,
    flow: ctx.flow,
    status: outcome.status,
    error: outcome.error ?? null,
    durationMs: Date.now() - ctx.t0,
    at: new Date().toISOString(),
    events: ctx.events,
  };
  appendFileSync(TRACE_FILE, JSON.stringify(rec) + "\n");
}

export { TRACE_FILE };
