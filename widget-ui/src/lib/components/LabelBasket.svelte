<!-- Geport uit v1 src/lib/components/LabelBasket.svelte. Wijzigingen:
     1) SSR-veiligheid: de mode/compact-$state-init las localStorage op top-level —
        nu achter een hasLS-guard (v1 draaide nooit server-side, de v2-smoke wel).
     2) TODO(order-flow): de proxy heeft /api/labels/* (list/merge/batch/events) en
        /integrations/v1/documents/label nog niet — alle fetches degraderen fail-soft
        naar lege lijsten (fetchScope: !ok → []), de SSE-stream valt terug op traag
        pollen. Chrome + gedrag zijn verder v1-verbatim. -->
<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { apiBaseUrl } from "../api/global";
  import { printPDFBinary } from "../print/printPDFBinary";
  import { orders } from "../state/orders";
  import { setUserPreferences, userPreferences } from "../state/userPreferences";
  import { updateUserConfig } from "../api/updateUserConfig";
  import type { EnrichedOrder } from "../types/webshop";

  // ---------- Types
  export type BasketItem = {
    orderId: string;
    orderPlatform: string;
    pdfUrl: string;
    carrier?: string;
    service?: string;
    trackingNumber?: string;
    createdAt?: string;
    printedAt?: string | null;
    printBatchId?: string | null;
    customer?: string;
    country?: string;
  };
  type Mode = "today" | "pending" | "history" | "batches";

  type BatchHeader = {
    batchId: string;
    count: number;
    firstPrintedAt: string;
    lastPrintedAt: string;
  };

  // ---- visual variant: 'pill' (default) or 'inline' (compact, no outer pill)

  // ---------- Endpoints
  const LIST = (scope: string, userId: string, days = 7) =>
    `${apiBaseUrl}/api/labels/list?userId=${encodeURIComponent(
      userId
    )}&scope=${scope}&days=${days}`;
  const MERGE_URL = `${apiBaseUrl}/api/labels/merge`;
  const CREATE_BATCH_URL = `${apiBaseUrl}/api/labels/batch`;
  // Public endpoint (no app session): window.open() carries no auth headers.
  const SINGLE_PDF_URL = (pdfUrl: string, format: LabelFormat) =>
    `${apiBaseUrl}/integrations/v1/documents/label?url=${encodeURIComponent(pdfUrl)}&format=${format}`;

  // SSR-guard: v1 las localStorage direct in de $state-init.
  const hasLS = typeof localStorage !== "undefined";

  // ---------- Label format (A4 = as delivered by the portal, A6 = server-side crop+refit
  // for label-roll printers). Persisted per user in widgetBehavior so OrderOverview's
  // bulk print picks it up too.
  type LabelFormat = "a4" | "a6";
  let labelFormat = $state<LabelFormat>(
    (userPreferences?.widgetBehavior as any)?.labelFormat === "a6" ? "a6" : "a4"
  );
  function setLabelFormat(next: LabelFormat) {
    if (labelFormat === next) return;
    labelFormat = next;
    const prevWb = (userPreferences?.widgetBehavior as any) ?? {};
    setUserPreferences({
      ...(userPreferences ?? {}),
      widgetBehavior: { ...prevWb, labelFormat: next },
    });
    void updateUserConfig(
      "preferences.widgetBehavior.labelFormat",
      next,
      String(userId)
    ).catch(() => {});
  }

  // ---------- Props
  // autoRefreshMs is only the fallback poll interval for when SSE can't be
  // established (old server, proxy stripping streams); normal updates are push.
  type Props = { userId: string; autoRefreshMs?: number; variant?: "pill" | "inline" };
  let { userId, autoRefreshMs = 30000, variant = "inline" }: Props = $props();

  // ---------- Time helpers
  function isTodayUTC(iso?: string) {
    if (!iso) return false;
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return false;
    const now = new Date();
    const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0);
    const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0);
    return t >= start && t < end;
  }
  const fmtTime = (iso?: string) =>
    iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";

  // ---------- Normalize from EnrichedOrder (for TODAY/local)
  const toTodayItem = (o: EnrichedOrder): BasketItem | null => {
    const s = o?.shipment;
    if (!s || s.status !== "CREATED" || !s.pdfUrl) return null;
    if (!isTodayUTC(s.createdAt) || s.printedAt) return null;
    return {
      orderId: o.orderId,
      orderPlatform: o.orderPlatform,
      pdfUrl: s.pdfUrl,
      carrier: s.carrier,
      service: s.service,
      trackingNumber: s.trackingNumber || "",
      createdAt: s.createdAt,
      printedAt: s.printedAt ?? null,
      printBatchId: s.printBatchId ?? null,
      customer:
        [
          o?.shippingAddress?.company,
          [o?.shippingAddress?.firstName, o?.shippingAddress?.lastName].filter(Boolean).join(" "),
        ]
          .filter(Boolean)
          .join(" ")
          .trim() || undefined,
      country: s.country,
    };
  };

  // ---------- Reactive sources
  let loadingRemote = $state(false);
  let remoteToday = $state<BasketItem[]>([]);
  let localToday = $state<BasketItem[]>([]);
  let cachedPending = $state<BasketItem[]>([]);
  let batches = $state<BatchHeader[]>([]);

  // keep counts for tabs (stable)
  let counts = $state<{ today: number; pending: number; history: number; batches: number }>({
    today: 0,
    pending: 0,
    history: 0,
    batches: 0,
  });

  // ---------- Poll TODAY (server)
  async function pollTodayRemote() {
    if (!userId || loadingRemote) return;
    loadingRemote = true;
    try {
      const res = await fetch(LIST("today", userId));
      const arr: BasketItem[] = res.ok ? await res.json() : [];
      remoteToday = arr.sort((a, b) => +new Date(b.createdAt || 0) - +new Date(a.createdAt || 0));
    } catch {
      // TODO(order-flow): /api/labels/list bestaat nog niet op de proxy — leeg laten.
    } finally {
      loadingRemote = false;
    }
  }

  // ---------- Poll PENDING (server)
  async function pollPendingRemote() {
    try {
      const arr: BasketItem[] = await fetchScope("pending", 7);
      cachedPending = arr;
      counts = { ...counts, pending: arr.length };
      if (mode === "pending") scopeRows = arr;
    } catch {}
  }

  // ---------- Subscribe to orders store (optimistic TODAY)
  const unsub = orders.subscribe((list) => {
    const acc: BasketItem[] = [];
    for (const o of list as EnrichedOrder[]) {
      const it = toTodayItem(o);
      if (it) acc.push(it);
    }
    localToday = acc.sort((a, b) => +new Date(b.createdAt || 0) - +new Date(a.createdAt || 0));
  });

  // ---------- Merge TODAY
  const todayMerged = $derived(() => {
    const by = new Map<string, BasketItem>();
    for (const it of remoteToday) by.set(it.orderId, it);
    for (const it of localToday) by.set(it.orderId, it);
    return Array.from(by.values()).sort(
      (a, b) => +new Date(b.createdAt || 0) - +new Date(a.createdAt || 0)
    );
  });

  // ---------- Active total (unique Today ∪ Pending)
  const activeTotal = $derived(() => {
    const set = new Set<string>();
    for (const it of todayMerged()) set.add(it.orderId);
    for (const it of cachedPending) set.add(it.orderId);
    return set.size;
  });

  // Flat number alias so the template can read it without invoking the derived as a
  // function every place we need it (and without using a `{@const}` at the template
  // root — runes mode disallows that).
  const totalCount = $derived(activeTotal());

  // keep counts in sync (outside derived)
  $effect(() => {
    const len = todayMerged().length;
    if (counts.today !== len) counts = { ...counts, today: len };
  });

  // ---------- Other scopes
  let scopeLoading = $state(false);
  let scopeRows = $state<BasketItem[]>([]);
  let mode: Mode = $state(hasLS ? ((localStorage.getItem("basket.mode") as Mode) || "today") : "today");
  let compact = $state(hasLS ? localStorage.getItem("basket.compact") === "1" : false);

  async function fetchScope(scope: "today" | "pending" | "history" | "batches", days = 30) {
    try {
      const r = await fetch(LIST(scope, userId, days));
      return r.ok ? await r.json() : [];
    } catch {
      return [];
    }
  }

  async function loadScope() {
    if (mode === "today") {
      scopeRows = todayMerged();
      return;
    }
    scopeLoading = true;
    try {
      if (mode === "batches") {
        batches = await fetchScope("batches", 30);
        counts = { ...counts, batches: batches.length };
      } else if (mode === "pending") {
        const arr: BasketItem[] = await fetchScope("pending", 7);
        cachedPending = arr;
        scopeRows = arr;
        counts = { ...counts, pending: arr.length };
      } else {
        const arr: BasketItem[] = await fetchScope("history", 30);
        scopeRows = arr;
        counts = { ...counts, history: arr.length };
      }
    } finally {
      scopeLoading = false;
    }
  }

  // reflect TODAY changes into view when in today mode
  $effect(() => {
    if (mode === "today") scopeRows = todayMerged();
  });

  // ---------- Actions
  function openUrl(url?: string) {
    if (url) window.open(url, "_blank", "noopener");
  }

  // Per-row open/print: in A6 mode route through our transform endpoint so the
  // user sees the same format that would come out of the printer.
  function openLabel(pdfUrl?: string) {
    if (!pdfUrl) return;
    openUrl(labelFormat === "a6" ? SINGLE_PDF_URL(pdfUrl, "a6") : pdfUrl);
  }

  async function printAllVisible() {
    if (mode === "batches") return;
    const urls = scopeRows.map((x) => x.pdfUrl).filter(Boolean);
    if (!urls.length) return;

    const res = await fetch(MERGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls, format: labelFormat }),
    });
    if (!res.ok) return console.error("Samenvoegen mislukt", await res.text());
    const buf = await res.arrayBuffer();
    printPDFBinary(buf);

    const orderIds = scopeRows.map((x) => x.orderId);
    try {
      await fetch(CREATE_BATCH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, orderIds }),
      });
    } catch {}

    const gone = new Set(orderIds);
    localToday = localToday.filter((x) => !gone.has(x.orderId));
    remoteToday = remoteToday.filter((x) => !gone.has(x.orderId));
    cachedPending = cachedPending.filter((x) => !gone.has(x.orderId));
    if (mode === "today" || mode === "pending") {
      scopeRows = scopeRows.filter((x) => !gone.has(x.orderId));
    }
    counts = { ...counts, today: todayMerged().length, pending: cachedPending.length };

    await Promise.all([
      untrack(pollTodayRemote),
      untrack(pollPendingRemote),
      fetchScope("history", 30).then((h) => (counts = { ...counts, history: h.length })),
      fetchScope("batches", 30).then((b) => (batches = b)),
    ]);
    counts = { ...counts, today: todayMerged().length, pending: cachedPending.length, batches: batches.length };
  }

  // Batch helpers
  async function viewBatch(batchId: string) {
    mode = "history";
    if (hasLS) localStorage.setItem("basket.mode", mode);
    scopeLoading = true;
    try {
      const allHistory: BasketItem[] = await fetchScope("history", 60);
      scopeRows = allHistory.filter((r) => r.printBatchId === batchId);
      counts = { ...counts, history: allHistory.length };
    } finally {
      scopeLoading = false;
    }
  }
  async function printBatch(batchId: string) {
    const rows =
      mode === "history" && scopeRows.every((r) => r.printBatchId === batchId)
        ? scopeRows
        : (await fetchScope("history", 60)).filter((r: BasketItem) => r.printBatchId === batchId);
    const urls = rows.map((x: BasketItem) => x.pdfUrl).filter(Boolean);
    if (!urls.length) return;
    const res = await fetch(MERGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls, format: labelFormat }),
    });
    if (!res.ok) return console.error("Samenvoegen mislukt", await res.text());
    const buf = await res.arrayBuffer();
    printPDFBinary(buf);
  }

  // ---------- Drawer visibility
  let showDrawer = $state(false);

  // ---------- Live updates
  // One leader tab per browser holds an SSE stream to /api/labels/events; the
  // server pushes `labels-changed` on every label-affecting write (booking,
  // print, batch). The leader refetches and rebroadcasts the fresh lists over a
  // BroadcastChannel, so N open tabs cost one connection instead of N pollers.
  let es: EventSource | null = null;
  let bc: BroadcastChannel | null = null;
  let fallbackId: number | null = null;
  let refreshDebounceId: number | null = null;
  let releaseLeadership: (() => void) | null = null;
  let disposed = false;

  async function refreshRemote(broadcast: boolean) {
    await Promise.all([pollTodayRemote(), pollPendingRemote()]);
    if (broadcast) {
      bc?.postMessage({
        type: "labels",
        today: $state.snapshot(remoteToday),
        pending: $state.snapshot(cachedPending),
      });
    }
  }

  // Writes can land in bursts (headless queue); coalesce into one refetch.
  function queueRefresh() {
    if (refreshDebounceId) clearTimeout(refreshDebounceId);
    refreshDebounceId = window.setTimeout(() => void refreshRemote(true), 300);
  }

  function startFallbackPolling() {
    if (fallbackId || disposed) return;
    fallbackId = window.setInterval(
      () => void refreshRemote(true),
      Math.max(autoRefreshMs, 15_000)
    );
  }

  function becomeLeader() {
    if (disposed) return;
    if (typeof EventSource === "undefined") return startFallbackPolling();
    es = new EventSource(
      `${apiBaseUrl}/api/labels/events?userId=${encodeURIComponent(userId)}`
    );
    es.addEventListener("labels-changed", queueRefresh);
    // Refetch on (re)connect: catches writes that happened while disconnected.
    es.onopen = () => {
      if (fallbackId) {
        clearInterval(fallbackId);
        fallbackId = null;
      }
      queueRefresh();
    };
    // A non-2xx response closes the stream without auto-retry (unlike network
    // drops, which EventSource retries itself) — degrade to slow polling.
    es.onerror = () => {
      if (es?.readyState === EventSource.CLOSED) startFallbackPolling();
    };
  }

  function startLiveUpdates() {
    if (typeof BroadcastChannel !== "undefined") {
      bc = new BroadcastChannel(`inset-basket::${userId}`);
      bc.onmessage = (e) => {
        const msg = e.data;
        if (msg?.type !== "labels") return;
        remoteToday = msg.today ?? [];
        cachedPending = msg.pending ?? [];
        counts = { ...counts, pending: cachedPending.length };
        if (mode === "pending") scopeRows = cachedPending;
      };
    }
    const locks = (navigator as any).locks;
    if (bc && locks?.request) {
      // The lock is held until the tab dies (or onDestroy resolves the
      // promise); the next queued tab then takes over as leader.
      locks
        .request(`inset-basket-leader::${userId}`, () => {
          if (disposed) return;
          becomeLeader();
          return new Promise<void>((resolve) => {
            releaseLeadership = resolve;
          });
        })
        .catch(() => {});
    } else {
      // No cross-tab infra: this tab streams for itself.
      becomeLeader();
    }
  }

  onMount(() => {
    untrack(pollTodayRemote);
    untrack(pollPendingRemote);
    startLiveUpdates();

    // Covers events missed while hidden and the UTC-midnight rollover of the
    // "today" scope.
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refreshRemote(false);
    };
    document.addEventListener("visibilitychange", onVisibility);

    (async () => {
      try {
        const [p, h, b] = await Promise.all([
          fetchScope("pending", 7),
          fetchScope("history", 30),
          fetchScope("batches", 30),
        ]);
        cachedPending = p;
        batches = b;
        counts = {
          today: todayMerged().length,
          pending: p.length,
          history: h.length,
          batches: b.length,
        };
      } catch {}
    })();

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibility);
      if (refreshDebounceId) clearTimeout(refreshDebounceId);
      if (fallbackId) clearInterval(fallbackId);
      es?.close();
      releaseLeadership?.();
      bc?.close();
      unsub?.();
    };
  });

  // ---------- Handlers
  function switchMode(next: Mode) {
    if (mode === next) return;
    mode = next;
    if (hasLS) localStorage.setItem("basket.mode", mode);
    loadScope();
  }
  function toggleCompact() {
    compact = !compact;
    if (hasLS) localStorage.setItem("basket.compact", compact ? "1" : "0");
  }
</script>

<!-- FOOTER: pill or inline.
     The counter chip IS the view-affordance now — clicking it opens the drawer. A
     trailing chevron telegraphs that. When there's nothing to show, the chip and the
     primary Printen button are both disabled so the footer reads as inert rather than
     hiding (avoids a layout shift when labels arrive). -->
<div class={`wrap ${variant === 'inline' ? 'wrap-inline' : ''}`} role="group" aria-label="Labelacties">
  <button
    class="btn basket-chip"
    on:click={() => { showDrawer = true; loadScope(); }}
    disabled={totalCount === 0}
    title={totalCount === 0 ? "Geen labels klaar" : "Bekijk labels"}
  >
    <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <!-- Lucide "package" -->
      <path d="M16.5 9.4 7.55 4.24" />
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
    <span class="basket-chip-label">{totalCount} {totalCount === 1 ? "label" : "labels"} klaar</span>
    <span class="basket-chip-chevron" aria-hidden="true">›</span>
  </button>

  <button
    class="btn primary"
    on:click={printAllVisible}
    disabled={totalCount === 0 || mode === "batches" || !scopeRows.length}
    title={totalCount === 0
      ? "Geen labels om te printen"
      : mode === "batches"
        ? "Open een batch om te printen"
        : "Alles (in beeld) printen"}
  >
    <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <path stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
        d="M7 8V4h10v4M7 16H5a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-2m-10 0v4h10v-4H7z"/>
    </svg>
    Printen
  </button>
</div>

{#if showDrawer}
  <!-- svelte-ignore a11y-no-static-element-interactions a11y-click-events-have-key-events -->
  <div
    class="drawer"
    aria-modal="true"
    role="dialog"
    on:click={(e) => {
      if ((e.target as HTMLElement).classList.contains("drawer-scrim")) showDrawer = false;
    }}
  >
    <div class="drawer-scrim"></div>

    <aside class="panel">
      <header class="panel-head">
        <div class="segmented">
          <button class:active={mode === "today"}   on:click={() => switchMode("today")  }>Vandaag <span class="chip">{counts.today}</span></button>
          <button class:active={mode === "pending"} on:click={() => switchMode("pending")}>Openstaand <span class="chip">{counts.pending}</span></button>
          <button class:active={mode === "history"} on:click={() => switchMode("history")}>Historie <span class="chip">{counts.history}</span></button>
          <button class:active={mode === "batches"} on:click={() => switchMode("batches")}>Batches <span class="chip">{counts.batches}</span></button>
        </div>

        <div class="head-actions">
          <div
            class="fmt-toggle"
            role="group"
            aria-label="Labelformaat"
            title="Printformaat: A4 = zoals aangeleverd, A6 = bijgesneden voor labelprinters"
          >
            <button class:active={labelFormat === "a4"} on:click={() => setLabelFormat("a4")}>A4</button>
            <button class:active={labelFormat === "a6"} on:click={() => setLabelFormat("a6")}>A6</button>
          </div>
          <button class="btn primary sm" on:click={printAllVisible} disabled={mode === "batches" || !scopeRows.length}>
            <svg class="icon"><use href="#icon-printer" /></svg> <span class="label">Alles printen</span>
          </button>
          <button class="btn ghost sm" on:click={() => (showDrawer = false)} title="Sluiten">
            <span class="label">Sluiten</span>
          </button>
        </div>
      </header>

      <section class="panel-body">
        {#if scopeLoading}
          <div class="skeleton-list">{#each Array(6) as _}<div class="sk-row"></div>{/each}</div>
        {:else if mode === "batches"}
          {#if !batches.length}
            <div class="empty">
              <div class="empty-icon">🗂️</div>
              <div>Geen batches in de gekozen periode.</div>
              <div class="muted">Print labels om automatisch een batch aan te maken.</div>
            </div>
          {:else}
            <ul class="list">
              {#each batches as b (b.batchId)}
                <li class="row">
                  <div class="info">
                    <div class="line1">
                      <span class="order">Batch {b.batchId}</span>
                      <span class="time">{fmtTime(b.lastPrintedAt)}</span>
                    </div>
                    <div class="line2">
                      <span class="svc">{b.count} labels</span>
                      <span class="sep">·</span>
                      <span class="tn">
                        {new Date(b.firstPrintedAt).toLocaleDateString()} – {new Date(b.lastPrintedAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  <div class="actions">
                    <button class="btn ghost sm" on:click={() => viewBatch(b.batchId)} title="Bekijken">Bekijken</button>
                    <button class="btn ghost sm" on:click={() => printBatch(b.batchId)} title="Printen">Printen</button>
                  </div>
                </li>
              {/each}
            </ul>
          {/if}
        {:else if !scopeRows.length}
          <div class="empty">
            <div>Geen items.</div>
            <div class="muted">
              {mode === "today"
                ? "Vandaag aangemaakte labels verschijnen hier."
                : mode === "pending"
                ? "Ongeprinte labels van de afgelopen 7 dagen verschijnen hier."
                : "Recent geprinte labels verschijnen hier."}
            </div>
          </div>
        {:else}
          <ul class="list" class:compact={compact}>
            {#each scopeRows as it (it.orderId)}
              <li class="row">
                <div class="info">
                  <div class="line1">
                    <span class="order">#{it.orderId}</span>
                    <span class="plat">{it.orderPlatform}</span>
                    <span class="time">{fmtTime(it.createdAt || it.printedAt || undefined)}</span>
                  </div>
                  <div class="line2">
                    <span class="cust">{it.customer || "—"}</span>
                    <span class="sep">·</span>
                    <span class="svc">
                      {it.carrier || "—"}{it.service ? ` • ${it.service}` : ""}{it.country ? ` → ${it.country}` : ""}
                    </span>
                    {#if it.trackingNumber || ""}<span class="sep">·</span><span class="tn">TN {it.trackingNumber || ""}</span>{/if}
                    {#if it.printBatchId}<span class="sep">·</span><span class="badge">Batch {it.printBatchId}</span>{/if}
                  </div>
                </div>
                <div class="actions">
                  <button class="btn ghost sm" on:click={() => openLabel(it.pdfUrl)} title="Openen">Openen</button>
                  <button class="btn ghost sm" on:click={() => openLabel(it.pdfUrl)} title="Printen">Printen</button>
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    </aside>
  </div>
{/if}

<svg xmlns="http://www.w3.org/2000/svg" style="display:none">
  <symbol id="icon-refresh" viewBox="0 0 24 24"><path fill="currentColor" d="M12 6V3L8 7l4 4V8a4 4 0 1 1-4 4H6a6 6 0 1 0 6-6z"/></symbol>
  <symbol id="icon-printer" viewBox="0 0 24 24"><path fill="currentColor" d="M7 8V4h10v4H7zm10 8h2a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h2v4h10v-4z"/></symbol>
  <symbol id="icon-dots" viewBox="0 0 24 24"><path fill="currentColor" d="M5 12a2 2 0 1 1 4 0 2 2 0 0 1-4 0zm5 0a2 2 0 1 1 4 0 2 2 0 0 1-4 0zm5 0a2 2 0 1 1 4 0 2 2 0 0 1-4 0z"/></symbol>
</svg>

<style>
  /* legacy footer helper (safe to keep) */
  :global(.orders-basket-footer){ display:flex; justify-content:flex-end; margin-top:12px; }

  /* Pill variant */
  .wrap{
    display:inline-flex; align-items:center; gap:8px;
    padding:6px 8px; background:#fff; border:1px solid #e5e7eb; border-radius:9999px;
  }
  .btn{
    height:32px; padding:0 10px; border-radius:9999px; border:1px solid #e5e7eb;
    background:#fff; color:#0f172a; font-size:12px; line-height:1; display:inline-flex; align-items:center; gap:6px;
  }
  .btn:hover{ background:#f8fafc; }
  .btn:disabled{ opacity:.5; cursor:not-allowed; }
  .btn.primary{ border-color:rgba(0,105,180,1); background:rgba(0,105,180,1); color:#fff; }
  .btn.primary:hover{ filter:brightness(.98); }
  .btn.ghost{ background:#fff; border-color:#e5e7eb; }
  .btn.sm{ height:30px; padding:0 8px; font-size:12px; }
  .icon{ width:14px; height:14px; display:block; }


  /* Inline variant: no outer pill; lock vertical metrics to 32px */
  .wrap-inline{ padding:0; background:transparent; border:0; border-radius:0; height:2rem; }
  .wrap-inline .btn{ height:2rem; padding-top:0; padding-bottom:0; border-radius:8px; }
  .wrap-inline .icon{ height:14px; width:14px; }

  /* Counter-as-button chip — neutral surface so it sits behind the primary Printen
     button visually. Slightly tighter padding than the default .btn so the icon +
     label + chevron read as a single unit. Chevron uses a muted neutral so it
     telegraphs "opens" without competing with the count. */
  .basket-chip{
    color:#374151;             /* neutral-700 */
    background:#f9fafb;        /* neutral-50  */
    border-color:#e5e7eb;      /* neutral-200 */
    gap:6px;
  }
  .basket-chip:hover:not(:disabled){ background:#f3f4f6; /* neutral-100 */ }
  .basket-chip:disabled{ color:#9ca3af; background:#f9fafb; }
  .basket-chip-label{ font-size:12px; line-height:1; }
  .basket-chip-chevron{
    color:#9ca3af;             /* neutral-400 */
    font-size:14px;
    line-height:1;
    margin-left:2px;
    /* Glyph sits a hair below the optical centre; nudge it up to align with the text. */
    transform:translateY(-1px);
  }

  /* Drawer */
  .drawer{ position:fixed; inset:0; z-index:50; }
  .drawer-scrim{ position:absolute; inset:0; background:rgba(0,0,0,.2); backdrop-filter:blur(1px); }

  :root{
    --basket-pad-x:max(12px, env(safe-area-inset-right, 0px));
    --basket-pad-y:max(12px, env(safe-area-inset-top, 0px));
    --basket-pad-b:max(12px, env(safe-area-inset-bottom, 0px));
  }

  .panel{
    position:fixed; top:var(--basket-pad-y); right:var(--basket-pad-x); bottom:var(--basket-pad-b);
    width:clamp(680px, 50vw, 560px);
    background:#fff; border:1px solid #e5e7eb; border-radius:12px; box-shadow:-8px 10px 24px rgba(0,0,0,.08);
    display:flex; flex-direction:column; overflow:hidden; animation:slideIn .16s ease-out;
  }
  .panel-head{ padding:10px 12px; border-bottom:1px solid #f1f5f9; display:flex; align-items:center; justify-content:space-between; gap:10px; flex:0 0 auto; min-width:0; }
  .panel-head > *{ min-width:0; }

  .segmented{
    flex:1 1 auto; min-width:0; overflow:hidden; background:#f8fafc; padding:4px; border:1px solid #e5e7eb; border-radius:9999px; display:flex; gap:6px;
  }
  .segmented > button{
    border:0; background:transparent; padding:6px 10px; font-size:12px; color:#334155; border-radius:9999px; display:flex; align-items:center; gap:6px;
  }
  .segmented > button:hover{ background:#fff; }
  .segmented > button.active{ background:#fff; box-shadow:0 1px 0 rgba(0,0,0,.04); color:#0f172a; }
  .chip{ min-width:16px; height:16px; padding:0 6px; border-radius:9999px; background:#eef2f7; color:#334155; display:inline-flex; align-items:center; justify-content:center; font-size:11px; }

  .head-actions{ display:flex; align-items:center; gap:8px; }

  /* Label format toggle — mini segmented control, visually matched to .segmented */
  .fmt-toggle{
    display:flex; gap:2px; background:#f8fafc; border:1px solid #e5e7eb; border-radius:9999px; padding:2px;
  }
  .fmt-toggle > button{
    border:0; background:transparent; padding:4px 8px; font-size:11px; color:#64748b; border-radius:9999px; line-height:1;
  }
  .fmt-toggle > button:hover{ background:#fff; }
  .fmt-toggle > button.active{ background:#fff; color:#0f172a; box-shadow:0 1px 0 rgba(0,0,0,.04); font-weight:600; }

  .panel-body{ flex:1 1 auto; min-height:0; overflow:auto; overscroll-behavior:contain; padding:8px 0; }

  @keyframes slideIn{ from{ transform:translateX(16px); opacity:.98 } to{ transform:translateX(0); opacity:1 } }
  @media (min-width:1200px){ .panel{ border-radius:8px; } }

  /* List */
  .list{ list-style:none; margin:0; padding:0; }
  .row{ display:flex; align-items:flex-start; justify-content:space-between; gap:10px; padding:10px 12px; border-bottom:1px solid #f8fafc; }
  .row:hover{ background:#fafbff; }
  .list.compact .row{ padding:8px 10px; }

  .info{ min-width:0; }
  .line1{ display:flex; align-items:center; gap:8px; min-width:0; }
  .order{ font-size:13px; font-weight:600; color:#0f172a; }
  .plat{ font-size:11px; color:#64748b; }
  .time{ margin-left:auto; font-size:11px; color:#94a3b8; }
  .line2{ margin-top:2px; display:flex; align-items:center; gap:6px; min-width:0; }
  .cust,.svc,.tn{ font-size:12px; color:#475569; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .cust{ max-width:45%; } .svc{ max-width:45%; }
  .sep{ color:#cbd5e1; }
  .badge{ background:#eef2f7; color:#334155; border-radius:9999px; padding:0 6px; font-size:11px; }
  .actions{ display:flex; align-items:center; gap:6px; }

  /* Empty state */
  .empty{ padding:24px 16px; text-align:center; color:#475569; }
  .empty-icon{ font-size:20px; margin-bottom:6px; }
  .muted{ color:#94a3b8; font-size:12px; margin-top:4px; }

  /* Skeleton */
  .skeleton-list{ padding:8px 12px; }
  .sk-row{
    height:34px; border-radius:8px; margin-bottom:6px;
    background:linear-gradient(90deg,#f6f7f9 25%,#eceff3 37%,#f6f7f9 63%); background-size:400% 100%; animation:shimmer 1.3s ease infinite;
  }
  @keyframes shimmer{ 0%{ background-position:100% 0; } 100%{ background-position:-100% 0; } }
</style>
