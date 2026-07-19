<!-- Geport uit v1 src/lib/components/SearchFilterBar.svelte. Wijzigingen: geen —
     window/document-toegang zit in onMount/handlers en de portal-action draait alleen
     bij geopende popovers (SSR-veilig). Types uit ../types/search (mee-geport). -->
<script lang="ts">
  import { createEventDispatcher, onMount, onDestroy, tick } from "svelte";
  import type {
    DateToken,
    DepthToken,
    DepthValue,
    PlatformToken,
    StatusKey,
    StatusToken,
    Token,
  } from "../types/search";

  // ===== Props =====
  export let query = "";
  export let tokens: Token[] = [];

  export let allStatusKeys: StatusKey[] = [
    "NEW",
    "CREATED",
    "CANCELED",
    "UNPLANNED",
    "FAILED",
  ];
  export let statusLabels: Record<StatusKey, string> = {
    NEW: "Nieuw",
    CREATED: "Aangemaakt",
    AFGEROND: "Afgerond",
    CANCELED: "Geannuleerd",
    UNPLANNED: "Ongepland",
    FAILED: "Mislukt",
  };

  export let allowedPlatforms: string[] = [
    "Shopify",
    "WooCommerce",
    "Magento",
    "ExactOnline",
    "BusinessCentral",
    "afas",
    "manual",
  ];
  export let platformLabels: Record<string, string> = {
    Shopify: "Shopify",
    WooCommerce: "WooCommerce",
    Magento: "Magento",
    ExactOnline: "Exact Online",
    BusinessCentral: "Business Central",
    afas: "AFAS",
    manual: "Manual",
  };

  // labels for depth
  export let depthLabels: Record<DepthValue, string> = {
    current: "Laatste 100 orders",
    year: "Laatste 12 maanden",
    all: "Alles (alle bronnen)",
  };

  export let placeholder = "Zoek…";
  export let unseenCreated = 0;
  export let unseenFailed = 0;

  const dispatch = createEventDispatcher();

  // ===== Local helpers =====
  let rootEl: HTMLElement | null = null;

  function ensureStatusToken(): StatusToken {
    let t = tokens.find((x) => x.type === "status") as StatusToken | undefined;
    if (!t) {
      t = { id: "status", type: "status", values: [] };
      tokens = [...tokens, t];
    }
    return t;
  }
  function ensurePlatformToken(): PlatformToken {
    let t = tokens.find((x) => x.type === "platform") as
      | PlatformToken
      | undefined;
    if (!t) {
      t = { id: "platform", type: "platform", values: [] };
      tokens = [...tokens, t];
    }
    return t;
  }
  function ensureDateToken(): DateToken {
    let t = tokens.find((x) => x.type === "date") as DateToken | undefined;
    if (!t) {
      t = { id: "date", type: "date", mode: "created" };
      tokens = [...tokens, t];
    }
    return t;
  }
  function ensureDepthToken(): DepthToken {
    let t = tokens.find((x) => x.type === "depth") as DepthToken | undefined;
    if (!t) {
      t = { id: "depth", type: "depth", value: "current" };
      tokens = [...tokens, t];
    }
    return t;
  }

  const statusFirstLabel = (t: StatusToken) => statusLabels[t.values[0]];
  const statusExtraCount = (t: StatusToken) =>
    Math.max(0, (t.values?.length ?? 0) - 1);

  // ===== Reactive pointers =====
  let statusToken: StatusToken | undefined;
  let platformToken: PlatformToken | undefined;
  let dateToken: DateToken | undefined;
  let depthToken: DepthToken | undefined;

  $: statusToken = tokens.find((t) => t.id === "status") as
    | StatusToken
    | undefined;
  $: platformToken = tokens.find((t) => t.id === "platform") as
    | PlatformToken
    | undefined;
  $: dateToken = tokens.find((t) => t.id === "date") as DateToken | undefined;
  $: depthToken = tokens.find((t) => t.id === "depth") as
    | DepthToken
    | undefined;

  // ===== Pill element refs (for anchoring popovers) =====
  let statusPillEl: HTMLElement | null = null;
  let platformPillEl: HTMLElement | null = null;
  let datePillEl: HTMLElement | null = null;
  let depthPillEl: HTMLElement | null = null;

  // ===== Portal helper =====
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return {
      destroy() {
        if (node.parentNode === document.body) document.body.removeChild(node);
      },
    };
  }

  // ===== Open management (one at a time) =====
  let statusEditorEl: HTMLElement | null = null;
  let platformEditorEl: HTMLElement | null = null;
  let dateEditorEl: HTMLElement | null = null;
  let depthEditorEl: HTMLElement | null = null;

  let statusAnchor: HTMLElement | null = null;
  let platformAnchor: HTMLElement | null = null;
  let dateAnchor: HTMLElement | null = null;
  let depthAnchor: HTMLElement | null = null;

  let statusOpen = false;
  let platformOpen = false;
  let dateOpen = false;
  let depthOpen = false;

  function closeAll() {
    statusOpen = platformOpen = dateOpen = depthOpen = false;
  }

  function openOnly(
    which: "status" | "platform" | "date" | "depth",
    anchor: HTMLElement
  ) {
    closeAll();
    if (which === "status") {
      statusAnchor = anchor;
      statusOpen = true;
      tick().then(positionStatusEditor);
    }
    if (which === "platform") {
      platformAnchor = anchor;
      platformOpen = true;
      tick().then(positionPlatformEditor);
    }
    if (which === "date") {
      dateAnchor = anchor;
      dateOpen = true;
      tick().then(positionDateEditor);
    }
    if (which === "depth") {
      depthAnchor = anchor;
      depthOpen = true;
      tick().then(positionDepthEditor);
    }
  }

  // ===== Popover positioning =====
  function clampXToSearchbar(left: number, width: number) {
    if (!rootEl) return left;
    const pad = 6;
    const r = rootEl.getBoundingClientRect();
    const min = r.left + pad;
    const max = r.right - width - pad;
    return Math.min(Math.max(min, left), Math.max(min, max));
  }

  function positionStatusEditor() {
    if (!statusEditorEl || !statusAnchor) return;
    const ar =
      statusAnchor.closest(".token")?.getBoundingClientRect() ??
      statusAnchor.getBoundingClientRect();
    const vh = innerHeight,
      pad = 8;
    const ew = statusEditorEl.offsetWidth || 260,
      eh = statusEditorEl.offsetHeight || 0;
    let left = clampXToSearchbar(ar.left, ew);
    let top = ar.bottom + 6;
    if (top + eh > vh - pad) top = Math.max(pad, ar.top - eh - 6);
    Object.assign(statusEditorEl.style, {
      position: "fixed",
      left: `${left}px`,
      top: `${top}px`,
    });
  }

  function positionPlatformEditor() {
    if (!platformEditorEl || !platformAnchor) return;
    const ar =
      platformAnchor.closest(".token")?.getBoundingClientRect() ??
      platformAnchor.getBoundingClientRect();
    const vh = innerHeight,
      pad = 8;
    const ew = platformEditorEl.offsetWidth || 260,
      eh = platformEditorEl.offsetHeight || 0;
    let left = clampXToSearchbar(ar.left, ew);
    let top = ar.bottom + 6;
    if (top + eh > vh - pad) top = Math.max(pad, ar.top - eh - 6);
    Object.assign(platformEditorEl.style, {
      position: "fixed",
      left: `${left}px`,
      top: `${top}px`,
    });
  }

  function positionDateEditor() {
    if (!dateEditorEl || !dateAnchor) return;
    const ar =
      dateAnchor.closest(".token")?.getBoundingClientRect() ??
      dateAnchor.getBoundingClientRect();
    const vh = innerHeight,
      pad = 8;
    const ew = dateEditorEl.offsetWidth || 320,
      eh = dateEditorEl.offsetHeight || 0;
    let left = clampXToSearchbar(ar.left, ew);
    let top = ar.bottom + 6;
    if (top + eh > vh - pad) top = Math.max(pad, ar.top - eh - 6);
    Object.assign(dateEditorEl.style, {
      position: "fixed",
      left: `${left}px`,
      top: `${top}px`,
    });
  }

  function positionDepthEditor() {
    if (!depthEditorEl || !depthAnchor) return;
    const ar =
      depthAnchor.closest(".token")?.getBoundingClientRect() ??
      depthAnchor.getBoundingClientRect();
    const vh = innerHeight,
      pad = 8;
    const ew = depthEditorEl.offsetWidth || 260,
      eh = depthEditorEl.offsetHeight || 0;
    let left = clampXToSearchbar(ar.left, ew);
    let top = ar.bottom + 6;
    if (top + eh > vh - pad) top = Math.max(pad, ar.top - eh - 6);
    Object.assign(depthEditorEl.style, {
      position: "fixed",
      left: `${left}px`,
      top: `${top}px`,
    });
  }

  // ===== Add menu =====
  let addMenuEl: HTMLElement | null = null;
  let addAnchor: HTMLElement | null = null;
  let addOpen = false;

  function openAddMenu(anchor: HTMLElement) {
    addAnchor = anchor;
    addOpen = true;
    tick().then(positionAddMenu);
  }
  function positionAddMenu() {
    if (!addMenuEl || !addAnchor) return;
    const r = addAnchor.getBoundingClientRect();
    const mw = addMenuEl.offsetWidth || 200,
      mh = addMenuEl.offsetHeight || 0;
    let left = clampXToSearchbar(r.right - mw, mw);
    let top = r.bottom + 6;
    const vh = innerHeight,
      pad = 8;
    if (top + mh > vh - pad) top = Math.max(pad, r.top - mh - 6);
    Object.assign(addMenuEl.style, {
      position: "fixed",
      left: `${left}px`,
      top: `${top}px`,
    });
  }

  // ===== Global listeners =====
  const onWinClick = (e: MouseEvent) => {
    const t = e.target as Node;
    if (rootEl && rootEl.contains(t)) return;
    if (statusEditorEl && statusEditorEl.contains(t)) return;
    if (platformEditorEl && platformEditorEl.contains(t)) return;
    if (dateEditorEl && dateEditorEl.contains(t)) return;
    // Cast: de depth-popover (en dus z'n bind:this) is in v1 al uitgecommentarieerd,
    // waardoor TS depthEditorEl tot `never` versmalt; de guard blijft v1-verbatim.
    if (depthEditorEl && (depthEditorEl as HTMLElement).contains(t)) return;
    if (addMenuEl && addMenuEl.contains(t)) return;
    closeAll();
    addOpen = false;
  };
  const onWinResize = () => {
    statusOpen && positionStatusEditor();
    platformOpen && positionPlatformEditor();
    dateOpen && positionDateEditor();
    depthOpen && positionDepthEditor();
    addOpen && positionAddMenu();
  };
  const onWinScroll = () => onWinResize();

  onMount(() => {
    window.addEventListener("click", onWinClick);
    window.addEventListener("resize", onWinResize);
    window.addEventListener("scroll", onWinScroll, true);
  });
  onDestroy(() => {
    if (typeof window === "undefined") return;
    window.removeEventListener("click", onWinClick);
    window.removeEventListener("resize", onWinResize);
    window.removeEventListener("scroll", onWinScroll, true);
  });

  // ===== Token mutation helpers =====
  function removeTokenById(id: Token["id"]) {
    tokens = tokens.filter((t) => t.id !== id);
    dispatch("remove", id);
  }
  function setStatusValues(vals: StatusKey[]) {
    const t = ensureStatusToken();
    t.values = vals;
    tokens = [...tokens];
    dispatch("setStatusValues", { values: vals });
  }
  function setPlatformValues(vals: string[]) {
    const t = ensurePlatformToken();
    t.values = vals;
    tokens = [...tokens];
    dispatch("setPlatformValues", { values: vals });
  }
  function setDateToken(
    mode: "created" | "updated",
    from?: string,
    to?: string
  ) {
    const t = ensureDateToken();
    t.mode = mode;
    t.from = from || "";
    t.to = to || "";
    tokens = [...tokens];
    const active = !!(t.from && t.to);
    dispatch("setDateValues", { mode, from: t.from, to: t.to, active });
  }
  function setDepthValue(val: DepthValue) {
    const t = ensureDepthToken();
    t.value = val;
    tokens = [...tokens];
    dispatch("setDepthValue", { value: val });
  }

  // "/" focuses the input
  let inputEl: HTMLInputElement | null = null;
  function focusSearch(node: HTMLInputElement) {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !(e.ctrlKey || e.metaKey || e.altKey)) {
        e.preventDefault();
        node.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return {
      destroy() {
        window.removeEventListener("keydown", onKey);
      },
    };
  }

  function humanDateRange(t: DateToken) {
    const which = t.mode === "created" ? "Created" : "Updated";
    const from = t.from ? t.from : "…";
    const to = t.to ? t.to : "…";
    return `${which}: ${from} → ${to}`;
  }

  // ===== Add & open handlers =====
  async function addStatusAndOpen() {
    ensureStatusToken();
    addOpen = false;
    await tick();
    openOnly("status", statusPillEl ?? addAnchor!);
  }
  async function addPlatformAndOpen() {
    ensurePlatformToken();
    addOpen = false;
    await tick();
    openOnly("platform", platformPillEl ?? addAnchor!);
  }
  async function addDateAndOpen() {
    ensureDateToken();
    addOpen = false;
    await tick();
    openOnly("date", datePillEl ?? addAnchor!);
  }
  async function addDepthAndOpen() {
    ensureDepthToken();
    addOpen = false;
    await tick();
    openOnly("depth", depthPillEl ?? addAnchor!);
  }

  // --- keep filter button visible & fades ---
let pillWrap: HTMLDivElement | null = null;
let canScrollLeft = false;
let canScrollRight = false;

function updateFades() {
  if (!pillWrap) return;
  const { scrollLeft, clientWidth, scrollWidth } = pillWrap;
  canScrollLeft  = scrollLeft > 1;
  canScrollRight = scrollLeft + clientWidth < scrollWidth - 1;
}

function onPillScroll() { updateFades(); }

let ro: ResizeObserver | null = null;
onMount(() => {
  updateFades();
  ro = new ResizeObserver(updateFades);
  pillWrap && ro.observe(pillWrap);
  window.addEventListener("resize", updateFades);
});
onDestroy(() => {
  if (typeof window === "undefined") return;
  if (ro && pillWrap) ro.unobserve(pillWrap);
  window.removeEventListener("resize", updateFades);
});

// re-evaluate when tokens change
$: tokens, updateFades();
</script>

<!-- Search box + filter pills -->
<div class="w-full relative searchbar" bind:this={rootEl}>
  <div
    role="search"
    class="flex items-center gap-2 border border-gray-200 rounded-lg bg-white px-2.5 py-1
           transition-colors focus-within:border-blue-500"
  >
    <!-- icon -->
    <svg
      class="w-4 h-4 text-gray-400 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
    >
      <circle cx="11" cy="11" r="7" stroke-width="2"></circle>
      <line
        x1="21"
        y1="21"
        x2="16.65"
        y2="16.65"
        stroke-width="2"
        stroke-linecap="round"
      ></line>
    </svg>

    <!-- free text query -->
    <input
      bind:this={inputEl}
      use:focusSearch
      type="search"
      bind:value={query}
      {placeholder}
      class="flex-1 min-w-0 bg-transparent border-0 outline-none focus:ring-0 text-sm placeholder:text-gray-400 appearance-none"
      aria-label="Zoeken"
    />

    <!-- Pills: single row, no wrap, scrollable, with fade edges -->
    <div
      class="ml-auto flex items-center gap-2 overflow-x-auto no-scrollbar whitespace-nowrap max-w-[55%]"
      tabindex="0"
      role="group"
      aria-label="Actieve filters"
      title="Scroll horizontaal om meer filters te zien"
    >
      <!-- Status pill -->
      {#if statusToken}
        <div class="relative token shrink-0" bind:this={statusPillEl}>
          <div class="token-pill inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-gray-100 text-xs text-gray-700 whitespace-nowrap">
            <span class="text-gray-500 shrink-0">Status</span>
            {#if statusToken.values.length > 0}
              <span class="font-medium truncate min-w-0">{statusFirstLabel(statusToken)}</span>
              {#if statusExtraCount(statusToken) > 0}
                <span class="text-gray-400 shrink-0">(+{statusExtraCount(statusToken)})</span>
              {/if}
            {:else}
              <span class="font-medium truncate text-gray-400">Geen selectie</span>
            {/if}

            {#if statusToken.values.includes("CREATED") && unseenCreated > 0}
              <span class="ml-1 px-1.5 min-w-4 h-4 text-[10px] leading-4 text-center rounded-full bg-blue-600 text-white">
                {unseenCreated > 9 ? "9+" : unseenCreated}
              </span>
            {/if}
            {#if statusToken.values.includes("FAILED") && unseenFailed > 0}
              <span class="ml-1 px-1.5 min-w-4 h-4 text-[10px] leading-4 text-center rounded-full bg-blue-600 text-white">
                {unseenFailed > 9 ? "9+" : unseenFailed}
              </span>
            {/if}

            <button class="p-0.5 rounded hover:bg-gray-200" on:click={(e) => openOnly("status", e.currentTarget as HTMLElement)} aria-label="Wijzig statusfilter" title="Wijzig statusfilter">
              <svg class="w-3.5 h-3.5 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M6 9l6 6 6-6" stroke-width="2" stroke-linecap="round"/></svg>
            </button>
            <button class="p-0.5 rounded hover:bg-gray-200" on:click={() => removeTokenById("status")} aria-label="Verwijder" title="Verwijder">
              <svg class="w-3.5 h-3.5 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M6 6l12 12M18 6L6 18" stroke-width="2" stroke-linecap="round"/></svg>
            </button>
          </div>

          {#if statusOpen}
            <div use:portal bind:this={statusEditorEl} class="z-50 w-64 rounded-lg border border-gray-200 bg-white shadow-lg p-1 text-sm">
              <div class="max-h-60 overflow-auto">
                {#each allStatusKeys as k}
                  <label class="flex items-center gap-2 px-2 py-2 rounded hover:bg-gray-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={statusToken?.values.includes(k) ?? false}
                      on:change={(e) => {
                        const st = ensureStatusToken();
                        const set = new Set(st.values);
                        if ((e.target as HTMLInputElement).checked) set.add(k);
                        else set.delete(k);
                        setStatusValues(Array.from(set));
                        tick().then(positionStatusEditor);
                      }}
                    />
                    <span class="truncate">{statusLabels[k]}</span>
                  </label>
                {/each}
              </div>
              <div class="sticky bottom-0 bg-white border-t border-gray-200 px-2 py-1.5 flex justify-end">
                <button class="px-2 py-1 text-xs rounded-md border border-gray-200 bg-white text-gray-700 hover:bg-gray-50" on:click={closeAll}>Close</button>
              </div>
            </div>
          {/if}
        </div>
      {/if}

      <!-- Platform pill -->
      {#if platformToken}
        <div class="relative token shrink-0" bind:this={platformPillEl}>
          <div class="token-pill inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-gray-100 text-xs text-gray-700 whitespace-nowrap">
            <span class="text-gray-500 shrink-0">Platform</span>
            {#if platformToken.values.length > 0}
              <span class="font-medium truncate min-w-0">
                {platformLabels[platformToken.values[0]] ?? platformToken.values[0]}
              </span>
              {#if platformToken.values.length > 1}
                <span class="text-gray-400 shrink-0">(+{platformToken.values.length - 1})</span>
              {/if}
            {:else}
              <span class="font-medium truncate text-gray-400">Geen selectie</span>
            {/if}
            <button class="p-0.5 rounded hover:bg-gray-200" on:click={(e) => openOnly("platform", e.currentTarget as HTMLElement)} aria-label="Wijzig platformfilter" title="Wijzig platformfilter">
              <svg class="w-3.5 h-3.5 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M6 9l6 6 6-6" stroke-width="2" stroke-linecap="round"/></svg>
            </button>
            <button class="p-0.5 rounded hover:bg-gray-200" on:click={() => removeTokenById("platform")} aria-label="Verwijder" title="Verwijder">
              <svg class="w-3.5 h-3.5 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M6 6l12 12M18 6L6 18" stroke-width="2" stroke-linecap="round"/></svg>
            </button>
          </div>

          {#if platformOpen}
            <div use:portal bind:this={platformEditorEl} class="z-50 w-64 rounded-lg border border-gray-200 bg-white shadow-lg p-1 text-sm">
              <div class="max-h-60 overflow-auto">
                {#each allowedPlatforms as p}
                  <label class="flex items-center gap-2 px-2 py-2 rounded hover:bg-gray-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={platformToken?.values.includes(p) ?? false}
                      on:change={(e) => {
                        const pt = ensurePlatformToken();
                        const set = new Set(pt.values);
                        if ((e.target as HTMLInputElement).checked) set.add(p);
                        else set.delete(p);
                        setPlatformValues(Array.from(set));
                        tick().then(positionPlatformEditor);
                      }}
                    />
                    <span class="truncate">{platformLabels[p] ?? p}</span>
                  </label>
                {/each}
              </div>
              <div class="sticky bottom-0 bg-white border-t border-gray-200 px-2 py-1.5 flex justify-end">
                <button class="px-2 py-1 text-xs rounded-md border border-gray-200 bg-white text-gray-700 hover:bg-gray-50" on:click={closeAll}>Close</button>
              </div>
            </div>
          {/if}
        </div>
      {/if}

      <!-- Date pill -->
      {#if dateToken}
        <div class="relative token shrink-0" bind:this={datePillEl}>
          <div class="token-pill inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-gray-100 text-xs text-gray-700 whitespace-nowrap">
            <span class="text-gray-500 shrink-0">Datum</span>
            <span class="font-medium truncate min-w-0">{humanDateRange(dateToken)}</span>
            <button class="p-0.5 rounded hover:bg-gray-200" on:click={(e) => openOnly("date", e.currentTarget as HTMLElement)} aria-label="Wijzig datumfilter" title="Wijzig datumfilter">
              <svg class="w-3.5 h-3.5 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M6 9l6 6 6-6" stroke-width="2" stroke-linecap="round"/></svg>
            </button>
            <button class="p-0.5 rounded hover:bg-gray-200" on:click={() => removeTokenById("date")} aria-label="Verwijder" title="Verwijder">
              <svg class="w-3.5 h-3.5 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M6 6l12 12M18 6L6 18" stroke-width="2" stroke-linecap="round"/></svg>
            </button>
          </div>

          {#if dateOpen}
            <div use:portal bind:this={dateEditorEl} class="z-50 w-80 rounded-lg border border-gray-200 bg-white shadow-lg p-2 text-sm">
              <div class="flex items-center gap-3 px-1 pb-2">
                <label class="inline-flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="dateMode" value="created" checked={dateToken.mode === "created"} on:change={() => setDateToken("created", dateToken.from, dateToken.to)} />
                  <span>Aangemaakt</span>
                </label>
                <label class="inline-flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="dateMode" value="updated" checked={dateToken.mode === "updated"} on:change={() => setDateToken("updated", dateToken.from, dateToken.to)} />
                  <span>Bijgewerkt</span>
                </label>
              </div>
              <div class="grid grid-cols-2 gap-2">
                <div class="flex flex-col gap-1">
                  <span class="text-xs text-gray-500">Vanaf</span>
                  <input type="date" class="px-2 py-1 border border-gray-200 rounded-lg outline-none focus:border-blue-500" value={dateToken.from ?? ""} on:input={(e) => setDateToken(dateToken.mode, (e.target as HTMLInputElement).value, dateToken.to)} />
                </div>
                <div class="flex flex-col gap-1">
                  <span class="text-xs text-gray-500">Tot en met</span>
                  <input type="date" class="px-2 py-1 border border-gray-200 rounded-lg outline-none focus:border-blue-500" value={dateToken.to ?? ""} on:input={(e) => setDateToken(dateToken.mode, dateToken.from, (e.target as HTMLInputElement).value)} />
                </div>
              </div>
              <div class="mt-2 flex justify-end gap-2">
                <button class="px-2 py-1 text-xs rounded-md border border-gray-200 bg-white text-gray-700 hover:bg-gray-50" on:click={closeAll}>Close</button>
              </div>
            </div>
          {/if}
        </div>
      {/if}

      <!-- Add new -->
      <div class="relative shrink-0">
        <button
          class="h-6 w-6 grid place-items-center rounded hover:bg-gray-100"
          aria-label="Filter toevoegen"
          title="Filter toevoegen"
          on:click|stopPropagation={(e)=>{ addOpen ? addOpen=false : openAddMenu(e.currentTarget as HTMLElement); }}
        >
          <!-- modern subtle funnel icon -->
          <svg class="w-4 h-4 text-gray-600" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path d="M3 5h18l-7 8v5l-4 1v-6L3 5z" stroke-width="1.6" stroke-linejoin="round"></path>
          </svg>
        </button>
      </div>
    </div>
  </div>

  <!-- Add menu -->
  {#if addOpen}
    <!-- svelte-ignore a11y-no-static-element-interactions a11y-click-events-have-key-events -->
    <div
      use:portal
      bind:this={addMenuEl}
      class="z-50 w-44 rounded-lg border border-gray-200 bg-white shadow-lg py-1 text-sm"
      on:click|stopPropagation
    >
      <div class="px-2 pb-1 text-[11px] uppercase tracking-wide text-gray-400">
        Filter
      </div>
      <button class="w-full text-left px-2 py-2 hover:bg-gray-50" on:click={addStatusAndOpen}>Status</button>
      <button class="w-full text-left px-2 py-2 hover:bg-gray-50" on:click={addPlatformAndOpen}>Platform</button>
      <button class="w-full text-left px-2 py-2 hover:bg-gray-50" on:click={addDateAndOpen}>Datum</button>
    </div>
  {/if}
</div>

<style>
  .no-scrollbar::-webkit-scrollbar { display: none; }
  .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }

  /* Clamp pill width; allow truncation */
  .token-pill { max-width: 200px; }
  @media (min-width: 640px) { .token-pill { max-width: 240px; } }
  @media (min-width: 1024px) { .token-pill { max-width: 280px; } }
</style>
