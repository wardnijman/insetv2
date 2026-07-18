// Flow-executor. Laadt de gecompileerde transform, bouwt de payload IN-PROCESS
// (R2.6 — geen dubbele HTTP-hop), en stuurt 'm via de sessiepool naar het portaal.
// Deterministisch, geen LLM.

import { SessionPool } from "./pool.ts";
import type { PortalAuthAdapter } from "./adapter.ts";

type TransformFn = (input: unknown) => Record<string, unknown>;

export async function loadTransform(portal: string, flow: string): Promise<TransformFn> {
  const mod = await import(`../../generated/${portal}/${flow}.ts`);
  return mod.transform as TransformFn;
}

export async function loadAdapter(portal: string): Promise<PortalAuthAdapter> {
  const mod = await import(`../../portals/${portal}/adapter.ts`);
  return mod.adapter as PortalAuthAdapter;
}

export async function runFlow(
  pool: SessionPool,
  portal: string,
  flow: string,
  input: unknown,
): Promise<unknown> {
  const transform = await loadTransform(portal, flow);
  const payload = transform(input);
  const resp = await pool.submit(flow, payload);
  if (resp.status !== 200) throw new Error(`flow ${flow} faalde: status ${resp.status}`);
  return resp.body;
}
