// Geport uit v1 src/lib/utils/crypto.ts. Wijzigingen: geen. Alleen aangeroepen in
// event-handlers (browser); node >= 20 heeft crypto.subtle ook, dus SSR-neutraal.

export async function sha1(message: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-1', data);
  return [...new Uint8Array(hashBuffer)].map(b => b.toString(16).padStart(2, '0')).join('');
}
