<!-- Geport uit v1 src/lib/components/OrderRowErrorPopover.svelte. Wijzigingen: geen —
     document/window-toegang zit in onMount/handlers en de body rendert alleen bij
     open=true (SSR-veilig). Mail-adres blijft v1's supportadres. -->
<script lang="ts">
  import { onMount, onDestroy, createEventDispatcher, tick } from "svelte";

  // ---- props (Runes 5)
  type Props = {
    anchorEl?: HTMLElement | null;
    open?: boolean;                // bindable
    errorHtml?: string;
    orderId?: string;
    customer?: string;
    createdAt?: string;
    forwarderRef?: string;
    width?: number;
  };

  let {
    anchorEl    = null,
    open        = $bindable(false),
    errorHtml   = "",
    orderId     = "",
    customer    = "",
    createdAt   = "",
    forwarderRef,
    width       = 440
  }: Props = $props();

  const dispatch = createEventDispatcher();

  // ---- utils
  const toText = (html: string) => {
    const d = document.createElement("div");
    d.innerHTML = html;
    return d.textContent || html || "";
  };

  const errorText  = $derived(() => toText(errorHtml));
  const reportBody = $derived(() =>
    encodeURIComponent(
`Order: ${orderId}
Customer: ${customer}
Date: ${createdAt}
${forwarderRef ? `ForwarderRef: ${forwarderRef}\n` : ""}
---- Error ----
${errorText()}`
    )
  );
  const mailto = $derived(() =>
    `mailto:support@tffxpress.com?subject=${encodeURIComponent(`Label mislukt — ${orderId}`)}&body=${reportBody()}`
  );

  // ---- portal + positioning
  function portal(node: HTMLElement, target: HTMLElement = document.body) {
    target.appendChild(node);
    return { destroy() { node.parentNode?.removeChild(node); } };
  }

  let container: HTMLDivElement | null = null;
  let style = $state("");

  function place() {
    // Guard if anchor was removed
    if (!anchorEl || !document.body.contains(anchorEl)) return;

    const r = anchorEl.getBoundingClientRect();
    const gap = 8;
    const margin = 12;

    if (window.innerWidth < 640) {
      style = "position:fixed;left:0;right:0;bottom:0;width:100%;z-index:99999;";
      return;
    }

    const w = width ?? 440;
    const left = Math.min(Math.max(margin, r.left), window.innerWidth - w - margin);

    // Keep the popover fully on screen: drop below the anchor when there's room, otherwise flip
    // above it (rows near the bottom of the list would otherwise push it off-screen).
    const h = container?.getBoundingClientRect().height || 360;
    const fitsBelow = r.bottom + gap + h <= window.innerHeight - margin;
    const fitsAbove = r.top - gap - h >= margin;
    let top: number;
    if (fitsBelow) top = r.bottom + gap;
    else if (fitsAbove) top = r.top - gap - h;
    else if (window.innerHeight - r.bottom >= r.top) top = window.innerHeight - margin - h; // more room below
    else top = margin;                                                                      // more room above
    top = Math.max(margin, Math.min(top, window.innerHeight - margin - h));

    style = `position:fixed;left:${left}px;top:${top}px;width:${w}px;z-index:99999;`;
  }

  // ---- closing behavior
  function close() {
    open = false;              // flips the bindable signal
    dispatch("close");         // notify parent if it listens
  }

  function onEsc(e: KeyboardEvent) {
    if (e.key === "Escape") close();
  }

  function clickAway(e: MouseEvent) {
    if (!open) return;
    const t = e.target as Node;
    if (container && !container.contains(t) && anchorEl && !anchorEl.contains(t)) {
      close();
    }
  }

  // ---- actions that also close
  function copy(txt: string) {
    navigator.clipboard?.writeText(txt).finally(close);
  }
  function dl(txt: string) {
    const blob = new Blob([txt], { type: "text/plain;charset=utf-8" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url;
    a.download = `error-${orderId || "order"}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    close();
  }

  // ---- effects
  // Double rAF: first to lay out the popover so we can measure its height, second to re-place
  // using that measured height (so the above/below decision is correct).
  $effect(() => { if (open) requestAnimationFrame(() => { place(); requestAnimationFrame(place); }); });
  $effect(() => { anchorEl; if (open) requestAnimationFrame(() => { place(); requestAnimationFrame(place); }); });

  onMount(() => {
    tick().then(place);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    window.addEventListener("keydown", onEsc);
    // capture: true so clicks are seen even if inside elements stopPropagation
    window.addEventListener("click", clickAway, true);
  });
  onDestroy(() => {
    window.removeEventListener("scroll", place, true);
    window.removeEventListener("resize", place);
    window.removeEventListener("keydown", onEsc);
    window.removeEventListener("click", clickAway, true);
  });
</script>

{#if open}
  <div
    use:portal
    bind:this={container}
    style={style}
    class="rounded-xl bg-white shadow-xl ring-1 ring-gray-200 overflow-hidden"
    role="dialog"
    aria-modal="true"
  >
    <div class="flex items-start gap-2 px-3 pt-3">
      <span class="inline-flex h-5 w-5 items-center justify-center rounded-full bg-red-100 text-red-700 ring-1 ring-red-200">!</span>
      <div class="min-w-0">
        <div class="text-[13px]! font-medium text-gray-900 truncate">{orderId} — Mislukt</div>
        <div class="text-[11px]! text-gray-500 truncate">{errorText().slice(0, 120)}</div>
      </div>
      <button
        class="ml-auto text-gray-400 hover:text-gray-700"
        aria-label="Sluiten"
        on:click={close}
      >×</button>
    </div>

    <div class="px-3 pb-2 pt-2 max-h-72 sm:max-h-80 overflow-auto text-xs! text-gray-800">
      <pre class="whitespace-pre-wrap break-words font-mono">{errorText()}</pre>
    </div>

    <div class="px-3 pb-3 flex flex-wrap gap-2 justify-between items-center">
      <div class="text-[11px]! text-gray-500">
        {createdAt}{#if forwarderRef} · Ref: {forwarderRef}{/if}
      </div>
      <div class="flex gap-2">
        <button class="px-2 py-1 rounded border text-xs! border-gray-200 hover:bg-gray-50" on:click={() => copy(errorText())}>Kopieer</button>
        <button class="px-2 py-1 rounded border  text-xs! border-gray-200 hover:bg-gray-50" on:click={() => dl(errorText())}>Download</button>
        <a class="px-2 py-1 rounded border border-gray-200 text-xs! hover:bg-gray-50" href={mailto()} on:click={close}>Mail</a>
        <button class="px-2 py-1 rounded bg-blue-600 text-xs! text-white hover:bg-blue-700" on:click={() => { dispatch("retry"); close(); }}>Opnieuw</button>
      </div>
    </div>
  </div>
{/if}
