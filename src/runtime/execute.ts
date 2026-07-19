// Flow-executor. Laadt de gecompileerde transform, bouwt de payload IN-PROCESS
// (R2.6 — geen dubbele HTTP-hop), en stuurt 'm via de sessiepool naar het portaal.
// Deterministisch, geen LLM.

import { SessionPool } from "./pool.ts";
import type { PortalAuthAdapter } from "./adapter.ts";
import { startRun, record, finishRun } from "../observability/trace.ts";

type TransformFn = (input: unknown) => Record<string, unknown>;

export async function loadTransform(portal: string, flow: string): Promise<TransformFn> {
  const mod = await import(`../../generated/${portal}/${flow}.ts`);
  return mod.transform as TransformFn;
}

export async function loadAdapter(portal: string): Promise<PortalAuthAdapter> {
  // INSET_ADAPTER=live -> de echte portaal-adapter (adapter-live.ts, read-only;
  // creds uit env/.env). Default mock: CI/offline harnas raakt nooit een portaal.
  if ((process.env.INSET_ADAPTER ?? "mock") === "live") {
    const mod = await import(`../../portals/${portal}/adapter-live.ts`);
    return (mod.adapterLive ?? mod.adapter) as PortalAuthAdapter;
  }
  const mod = await import(`../../portals/${portal}/adapter.ts`);
  return mod.adapter as PortalAuthAdapter;
}

export async function runFlow(
  pool: SessionPool,
  tenant: string,
  portal: string,
  flow: string,
  input: unknown,
): Promise<unknown> {
  const transform = await loadTransform(portal, flow);
  const payload = transform(input);
  const ctx = startRun(tenant, portal, flow);
  record(ctx, "payload", payload);
  try {
    const resp = await pool.submit(flow, payload);
    record(ctx, "response", { status: resp.status });
    if (resp.status !== 200) throw new Error(`flow ${flow} faalde: status ${resp.status}`);
    finishRun(ctx, { status: "ok" });
    return resp.body;
  } catch (e) {
    finishRun(ctx, { status: "error", error: (e as Error).message });
    throw e;
  }
}
