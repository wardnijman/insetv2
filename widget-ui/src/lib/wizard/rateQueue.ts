// Geport uit v1 src/lib/wizard/rateQueue.ts. Wijzigingen: geen (pure store/mutex-logica).
// v2-notitie: de PHP-sessie-serialisatie leeft nu serverside in de proxy (SessionPool),
// maar de client-side mutex blijft nuttig om de proxy niet met parallelle dure
// rate-calls per widget te bestoken; de wacht-badges (rateQueueWaiting /
// sessionQueueWaiting) worden door de UI-port geconsumeerd.

import { writable } from "svelte/store";

// Two visibility queues for the UI: rate-fetch waiters vs session waiters
// (rendered as separate "Wacht op tarieven" / "Wacht op sessie" badges).
// Both queues share the SAME underlying mutex — see the explanation below.
export const rateQueueWaiting = writable<string[]>([]);
export const sessionQueueWaiting = writable<string[]>([]);

/**
 * Single mutex shared by getRates + chooseOption + submitShipment.
 *
 * TFF's backend keeps the chosen carrier/service in its PHP session ($_SESSION,
 * keyed by PHPSESSID). All three step types read or write that state, so even
 * though we'd like to pipeline rate fetches alongside another shipment's
 * chooseOption/submit, doing so causes the in-flight getRates to read a
 * partially-written session and come back with an empty result (`0 rate(s)
 * returned`). The original design split this into two separate slots — one
 * for rates, one for session — and we observed exactly that failure mode.
 *
 * Serializing every TFF call through ONE slot prevents the cross-shipment
 * interference. The trade-off: total batch time goes up (no rate-fetch
 * parallelism while another shipment submits), but each call returns the
 * rates it should.
 */
let _active = false;
type Waiter = { orderId: string; resolve: () => void; queue: "rate" | "session" };
const _waiters: Waiter[] = [];

async function acquireSlot(orderId: string, queue: "rate" | "session"): Promise<() => void> {
  if (!_active) {
    _active = true;
    return makeRelease();
  }

  const targetStore = queue === "rate" ? rateQueueWaiting : sessionQueueWaiting;
  targetStore.update((q) => [...q, orderId]);
  await new Promise<void>((resolve) => _waiters.push({ orderId, resolve, queue }));
  targetStore.update((q) => q.filter((id) => id !== orderId));
  return makeRelease();
}

function makeRelease(): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = _waiters.shift();
    if (next) {
      next.resolve();
    } else {
      _active = false;
    }
  };
}

export function acquireRateSlot(orderId: string): Promise<() => void> {
  return acquireSlot(orderId, "rate");
}

export function acquireSessionSlot(orderId: string): Promise<() => void> {
  return acquireSlot(orderId, "session");
}
