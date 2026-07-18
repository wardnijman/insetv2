// Axiom-exporter (R3.3): ship trace-records naar Axiom (OTel-vormige events).
// Best-effort en fail-stil — observability mag de flow nooit blokkeren. Token uit env
// (AXIOM_API_TOKEN), nooit in de repo. Backend inwisselbaar: alleen dit bestand verandert.

// Regionaal edge-endpoint (Wards account = EU, eu-central-1). Ingest gaat via de edge-host
// + pad /v1/ingest/<dataset> (niet api.axiom.co/v1/datasets/…). Override via AXIOM_URL.
const BASE = process.env.AXIOM_URL ?? "https://eu-central-1.aws.edge.axiom.co";

export function axiomEnabled(): boolean {
  return !!process.env.AXIOM_API_TOKEN;
}

export async function shipToAxiom(records: unknown[]): Promise<{ ok: boolean; status?: number; error?: string }> {
  const token = process.env.AXIOM_API_TOKEN;
  const dataset = process.env.AXIOM_DATASET ?? "inset-traces";
  if (!token) return { ok: false, error: "geen AXIOM_API_TOKEN" };
  try {
    const res = await fetch(`${BASE}/v1/ingest/${dataset}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(records.map((r) => ({ _time: new Date().toISOString(), ...(r as object) }))),
    });
    return { ok: res.ok, status: res.status, error: res.ok ? undefined : await res.text() };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
