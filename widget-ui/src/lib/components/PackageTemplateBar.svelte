<!-- src/lib/components/PackageTemplateBar.svelte
     Eén combobox voor pakketprofielen (creatable-combobox-patroon): zoeken,
     toepassen én bewaren in hetzelfde veld. De bovenste dropdown-rij is altijd
     de bewaar/overschrijf-actie voor de geselecteerde tabelregel; bewaren zet
     isFavorited, dus het profiel verschijnt direct als pill. Er is bewust geen
     aparte beheer-modal meer: ster/prullenbak in de dropdown + hernoemen via
     dubbelklik op een pill dekken alle beheer. -->
<script lang="ts">
  import { onMount } from "svelte";
  import type { PackageTemplate } from "../types/config";

  export let templates: PackageTemplate[] = [];
  export let suggestedName = "";
  // Of de geselecteerde tabelregel compleet genoeg is om als profiel te bewaren.
  export let canSaveCurrent = true;
  export let onApply: (tpl: PackageTemplate) => void;
  export let onSaveCurrent: (name: string, overwriteId?: string) => void | Promise<void>;
  export let onToggleFavorite: (id: string, value: boolean) => void;
  export let onDeleteTemplate: (id: string) => void | Promise<void> = () => {};
  export let onRenameTemplate: (id: string, name: string) => void | Promise<void> = () => {};
  export let onReorderFavorites: (idsInOrder: string[]) => void | Promise<void> = () => {};
  export let className = "";
  export let m: any;

  // Niet elke taalcatalogus heeft alle keys; NL is de app-default.
  const rs = (key: string, fallback: string) =>
    m?.shipmentWizard?.receiverStep?.[key] ?? fallback;

  let q = "";
  let dropdownOpen = false;
  let active = 0;
  let saving = false;
  let rootEl: HTMLDivElement;
  let listEl: HTMLDivElement;

  function keystr(t: PackageTemplate) {
    return [
      t.name, t.type,
      `${t.length}x${t.width}x${t.height}`,
      t.weight ? `${t.weight}kg` : "",
      t.dangerousGoods ? "dg" : "",
      t.bioGoods ? "bio" : "",
    ].join(" ").toLowerCase();
  }
  function score(t: PackageTemplate, q: string) {
    const s = keystr(t), qi = q.toLowerCase().trim();
    if (!qi) return 0;
    if (s.startsWith(qi)) return 100;
    if (s.includes(qi)) return 50;
    if (s.replace(/×/g, "x").includes(qi.replace(/×/g, "x"))) return 40;
    return -1;
  }

  $: baseSorted = [...templates].sort(
    (a, b) =>
      (b.isFavorited ? 1 : 0) - (a.isFavorited ? 1 : 0) ||
      (b.updatedAt || "").localeCompare(a.updatedAt || "")
  );
  $: filtered = q.trim()
    ? baseSorted
        .map((t) => ({ t, s: score(t, q) }))
        .filter((x) => x.s >= 0)
        .sort((a, b) => b.s - a.s || (b.t.updatedAt || "").localeCompare(a.t.updatedAt || ""))
        .map((x) => x.t)
    : baseSorted;

  // ---- bewaar/overschrijf-actie (bovenste rij van de dropdown) ----
  $: saveTargetName = (q.trim() || suggestedName || "").trim();
  $: overwriteTarget = saveTargetName
    ? (templates.find(
        (t) => (t.name || "").trim().toLowerCase() === saveTargetName.toLowerCase()
      ) ?? null)
    : null;
  $: showAction = !!saveTargetName;
  $: actionEnabled = showAction && canSaveCurrent && !saving;
  // Virtuele lijst voor toetsenbordnavigatie: index 0 = actie-rij (indien getoond).
  $: actionOffset = showAction ? 1 : 0;
  $: itemCount = actionOffset + filtered.length;

  async function saveCurrent() {
    if (!actionEnabled) return;
    saving = true;
    try {
      await onSaveCurrent(saveTargetName, overwriteTarget?.templateId);
      q = "";
      dropdownOpen = false;
    } finally {
      saving = false;
    }
  }

  // Pills honour the user's manual order (sortOrder); items without one go last.
  $: favorites = baseSorted
    .filter((t) => t.isFavorited)
    .sort(
      (a, b) =>
        (a.sortOrder ?? Number.MAX_SAFE_INTEGER) -
        (b.sortOrder ?? Number.MAX_SAFE_INTEGER)
    );

  // ---- drag & drop reordering of pills ----
  let dragId: string | null = null;
  let dragOrder: string[] | null = null;
  $: displayedFavorites = dragOrder
    ? (dragOrder
        .map((id) => favorites.find((f) => f.templateId === id))
        .filter(Boolean) as PackageTemplate[])
    : favorites;

  function handleDragStart(e: DragEvent, id: string) {
    if (editingId) { e.preventDefault(); return; }
    dragId = id;
    dragOrder = favorites.map((f) => f.templateId);
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", id); // Firefox needs data for DnD
    }
  }
  function handleDragOver(e: DragEvent, overId: string) {
    e.preventDefault();
    if (!dragId || !dragOrder || overId === dragId) return;
    const from = dragOrder.indexOf(dragId);
    const to = dragOrder.indexOf(overId);
    if (from === -1 || to === -1 || from === to) return;
    const next = [...dragOrder];
    next.splice(from, 1);
    next.splice(to, 0, dragId);
    dragOrder = next;
  }
  async function handleDragEnd() {
    const order = dragOrder;
    const changed =
      order && order.join("|") !== favorites.map((f) => f.templateId).join("|");
    dragId = null;
    try {
      if (changed && order) await onReorderFavorites(order);
    } finally {
      dragOrder = null;
    }
  }

  // ---- inline rename (double-click a pill) ----
  let editingId: string | null = null;
  let editName = "";

  function startRename(f: PackageTemplate) {
    editingId = f.templateId;
    editName = f.name;
  }
  async function commitRename() {
    const id = editingId;
    const name = editName.trim();
    editingId = null;
    if (!id || !name) return;
    const current = templates.find((t) => t.templateId === id);
    if (!current || current.name === name) return;
    await onRenameTemplate(id, name);
  }
  function renameKey(e: KeyboardEvent) {
    if (e.key === "Enter") { e.preventDefault(); commitRename(); }
    else if (e.key === "Escape") { e.preventDefault(); editingId = null; }
  }
  function focusSelect(node: HTMLInputElement) {
    node.focus();
    node.select();
  }

  onMount(() => {
    positionDropdown();
    const onSR = () => positionDropdown();
    window.addEventListener("scroll", onSR, true);
    window.addEventListener("resize", onSR);
    document.addEventListener("click", onDocClick, true);
    return () => {
      window.removeEventListener("scroll", onSR, true);
      window.removeEventListener("resize", onSR);
      document.removeEventListener("click", onDocClick, true);
    };
  });

  function onDocClick(e: MouseEvent) {
    if (!rootEl?.contains(e.target as Node)) dropdownOpen = false;
  }
  function positionDropdown() {
    if (!rootEl || !listEl) return;
    const r = rootEl.getBoundingClientRect();
    const spaceBelow = Math.max(160, window.innerHeight - r.bottom - 16);
    listEl.style.maxHeight = `${spaceBelow}px`;
  }
  function openDropdown() { dropdownOpen = true; active = 0; positionDropdown(); }
  function applyIndex(i: number) {
    if (showAction && i === 0) { saveCurrent(); return; }
    const it = filtered[i - actionOffset];
    if (it) { onApply(it); dropdownOpen = false; q = ""; }
  }
  function onSearchKey(e: KeyboardEvent) {
    if (!dropdownOpen && (e.key === "ArrowDown" || e.key === "Enter")) {
      openDropdown();
      // Enter mag alleen selecteren in een al geopende lijst — niet in dezelfde
      // toetsaanslag openen én meteen de actie-rij (bewaren!) uitvoeren.
      return;
    }
    if (!dropdownOpen) return;
    if (e.key === "ArrowDown") { e.preventDefault(); active = Math.min(active + 1, itemCount - 1); scrollActiveIntoView(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); active = Math.max(active - 1, 0); scrollActiveIntoView(); }
    else if (e.key === "Enter") { e.preventDefault(); applyIndex(active); }
    else if (e.key === "Escape") { dropdownOpen = false; }
  }
  function scrollActiveIntoView() {
    const el = listEl?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }
  function meta(t: PackageTemplate) {
    const dims = t.type === "document"
      ? "Document"
      : `${t.length}×${t.width}×${t.height}${t.weight ? ` / ${t.weight}kg` : ""}`;
    const tags = [
      t.type === "pallet" ? "Pallet" : t.type === "package" ? "Package" : "Document",
      t.dangerousGoods ? "DG" : null,
      t.bioGoods ? "BIO" : null,
    ].filter(Boolean);
    return `${dims}${tags.length ? " • " + tags.join(" • ") : ""}`;
  }

  async function handleDelete(t: PackageTemplate) {
    if (!t?.templateId) return;
    const name = (t.name || "").trim() || "Template";
    if (!confirm(`Verwijderen?\n\n${name}\n`)) return;
    await onDeleteTemplate(t.templateId);
    // parent should update `templates`; component will react automatically
  }
</script>

<div class={`bar ${className}`} bind:this={rootEl}>
  <!-- Row 1: één zoek-/bewaarveld -->
  <div class="field">
    <input
      class="input text-xs!"
      placeholder={rs("searchOrSavePackageProfile", "Zoek of bewaar pakketprofiel…")}
      bind:value={q}
      on:focus={openDropdown}
      on:input={() => { dropdownOpen = true; active = 0; }}
      on:keydown={onSearchKey}
    />

    {#if dropdownOpen}
      <div class="dropdown" bind:this={listEl}>
        {#if showAction}
          <div
            class={`row action ${active === 0 ? "active" : ""} ${actionEnabled ? "" : "disabled"}`}
            data-idx={0}
            role="button"
            tabindex="0"
            on:mouseenter={() => (active = 0)}
            on:click={saveCurrent}
            on:keydown={(e) => (e.key === "Enter" || e.key === " ") && saveCurrent()}
          >
            <div class="row-main">
              <div class="row-title action-title">
                {#if overwriteTarget}
                  <span class="action-glyph">↻</span>
                  {rs("overwrite", "Overschrijf")} “{overwriteTarget.name}” {rs("withCurrentRow", "met huidige regel")}
                {:else}
                  <span class="action-glyph">+</span>
                  {rs("saveCurrentRowAs", "Bewaar huidige regel als")} “{saveTargetName}”
                {/if}
              </div>
              {#if !canSaveCurrent}
                <div class="row-sub">{rs("completeRowToSave", "Vul afmetingen en gewicht in om te kunnen bewaren")}</div>
              {:else if q.trim() && suggestedName && q.trim() !== suggestedName}
                <div class="row-sub">{suggestedName}</div>
              {/if}
            </div>
          </div>
        {/if}

        {#if filtered.length === 0}
          {#if q.trim()}
            <div class="empty">{rs("noResults", "Geen resultaten")}</div>
          {/if}
        {:else}
          {#each filtered.slice(0, 60) as t, i (t.templateId)}
            <div
              class={`row ${i + actionOffset === active ? "active" : ""}`}
              data-idx={i + actionOffset}
              role="button"
              tabindex="0"
              on:mouseenter={() => (active = i + actionOffset)}
              on:click={() => applyIndex(i + actionOffset)}
              on:keydown={(e)=> (e.key === "Enter" || e.key === " ") && applyIndex(i + actionOffset)}
            >
              <div class="row-main">
                <div class="row-title" title={t.name}>{t.name}</div>
                <div class="row-sub" title={meta(t)}>{meta(t)}</div>
              </div>
              <div class="row-actions">
                <button
                  class={`icon star ${t.isFavorited ? "on" : ""}`}
                  on:click|stopPropagation={() => onToggleFavorite(t.templateId, !t.isFavorited)}
                  aria-label={t.isFavorited ? rs("removeFromFavorites", "Verwijder uit favorieten") : rs("addToFavorites", "Voeg toe aan favorieten")}
                  title={t.isFavorited ? rs("favorite", "Favoriet") : rs("markAsFavorite", "Markeer als favoriet")}
                >★</button>

                <button
                  class="icon trash"
                  on:click|stopPropagation={() => handleDelete(t)}
                  aria-label="Verwijderen"
                  title="Verwijderen"
                >
                  <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
                    <path fill="currentColor" d="M9 3h6a1 1 0 0 1 1 1v2h4v2h-1v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V8H4V6h4V4a1 1 0 0 1 1-1zm2 3h2V5h-2v1zM7 8v11h10V8H7zm3 2h2v7h-2v-7zm4 0h2v7h-2v-7z"/>
                  </svg>
                </button>
              </div>
            </div>
          {/each}
        {/if}
      </div>
    {/if}
  </div>

  <!-- Row 2: favorites -->
  <div class="row2">
    {#if favorites.length === 0}
      <div class="emptyfav">{rs("noFavoritesYet", "Nog geen profielen. Vul een regel in en bewaar die via het zoekveld.")}</div>
    {:else}
      <div class="favwrap">
        {#each displayedFavorites as f (f.templateId)}
          <div
            class={`favchip ${dragId === f.templateId ? "dragging" : ""}`}
            draggable={editingId !== f.templateId}
            on:dragstart={(e) => handleDragStart(e, f.templateId)}
            on:dragover={(e) => handleDragOver(e, f.templateId)}
            on:drop={(e) => e.preventDefault()}
            on:dragend={handleDragEnd}
          >
            {#if editingId === f.templateId}
              <span class="starchip">★</span>
              <input
                class="chip-edit"
                bind:value={editName}
                use:focusSelect
                on:keydown={renameKey}
                on:blur={commitRename}
                on:click|stopPropagation
              />
            {:else}
              <div class="chip-main" role="button" tabindex="0"
                   title={`${meta(f)} — ${rs("doubleClickToRename", "Dubbelklik om te hernoemen")}`}
                   on:click={() => onApply(f)}
                   on:dblclick|preventDefault={() => startRename(f)}
                   on:keydown={(e)=> (e.key === "Enter" || e.key === " ") && onApply(f)}>
                <span class="starchip">★</span>
                <span class="chip-text">{f.name}</span>
              </div>
              <button class="chip-x" aria-label="Verwijder uit favorieten" title="Verwijder"
                      on:click={() => onToggleFavorite(f.templateId, false)}>×</button>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .bar, .bar * { box-sizing: border-box; }

  /* Vlak, geen card: de wizard werkt met StepSection-haarlijnen; een omkaderde
     blur-kaart viel daar visueel buiten (en backdrop-filter is op de TFF-host
     sowieso een compositing-risico). */
  .bar{
    display:grid;
    grid-template-rows:auto auto;
    gap:10px;
    position:relative;
    z-index:45;
    width:100%;
  }

  .field{ position:relative; }
  /* Zelfde maatvoering als ValidatedInput (rounded-md, gray-300, blue-500 focus). */
  .input{
    display:block;
    width:100%;
    border:1px solid #d1d5db;
    border-radius:6px;
    padding:8px 12px;
    font-size:14px;
    background:#fff;
    transition:border-color .15s ease;
  }
  .input:focus{ outline:none; border-color:#3b82f6; }

  .dropdown{
    position:absolute; left:0; right:0; top:calc(100% + 6px);
    background:#fff; border:1px solid #e5e7eb; border-radius:12px;
    box-shadow:0 6px 24px rgba(0,0,0,.08);
    overflow-y:auto; z-index:70;
  }
  .empty{ padding:12px; font-size:13px; color:#8a8f98; }

  /* ROWS AS GRID: text left, actions right */
  .row{
    display:grid;
    grid-template-columns: 1fr auto;
    align-items:center;
    column-gap:10px;
    padding:8px 10px;
    border-bottom:1px solid #f3f4f6;
    cursor:pointer;
    outline:0;
  }
  .row:last-child{ border-bottom:none; }
  .row:hover{ background:#fafafa; }
  .row.active{ background:#f4f6f9; }

  /* Bewaar/overschrijf-actie bovenaan de lijst. */
  .row.action{ border-bottom:1px solid #e8ebf0; }
  .action-title{ color:#2563eb; }
  .action-glyph{
    display:inline-block;
    width:14px;
    font-weight:700;
  }
  .row.action.disabled{ cursor:default; }
  .row.action.disabled .action-title{ color:#9ca3af; }
  .row.action.disabled:hover{ background:transparent; }

  .row-main{
    min-width:0;
    display:flex;
    flex-direction:column;
    gap:2px;
  }
  .row-title{
    font-size:13px;
    font-weight:600;
    color:#0f172a;
    line-height:1.2;
    white-space:nowrap;
    overflow:hidden;
    text-overflow:ellipsis;
  }
  .row-sub{
    font-size:11px;
    color:#6b7280;
    line-height:1.2;
    white-space:nowrap;
    overflow:hidden;
    text-overflow:ellipsis;
  }

  .row-actions{
    display:flex;
    align-items:center;
    justify-content:flex-end;
    gap:6px;
  }

  .icon{
    border:0;
    background:transparent;
    padding:0 2px;
    line-height:1;
    display:inline-flex;
    align-items:center;
    justify-content:center;
    color:#c8ccd2;
  }
  .icon:hover{ color:#6b7280; }

  .star{ font-size:16px; }
  .star.on{ color:#2563eb; }

  .trash svg{ display:block; }
  .trash:hover{ color:#b91c1c; } /* subtle red on hover */

  .row2{ margin-top:2px; }
  .emptyfav{ font-size:12px; color:#9aa0a6; padding:2px 4px; }

  .favwrap{ display:flex; flex-wrap:wrap; gap:8px 10px; }
  /* Chips in dezelfde stille toon als de .seg-controls (#f3f4f6, geen randjes). */
  .favchip{
    display:flex; align-items:center; gap:4px;
    background:#f3f4f6; border:0; border-radius:999px;
    padding:4px 7px 4px 6px; max-width:260px;
    cursor:grab;
  }
  .favchip:active{ cursor:grabbing; }
  .favchip.dragging{ opacity:.35; }
  .favchip:hover{ background:#e9ebee; }
  .chip-edit{
    font-size:12px;
    border:none; outline:none; background:transparent;
    padding:0 2px; min-width:60px; max-width:200px;
    color:#111827;
  }
  .chip-main{ display:flex; align-items:center; gap:6px; cursor:pointer; }
  .chip-main:focus{ outline:none; box-shadow:inset 0 0 0 2px #e5e7eb; border-radius:999px; }
  .starchip{ color:#9ca3af; font-size:12px; }
  .chip-text{ font-size:12px; color:#374151; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:200px; }
  .chip-x{
    width:18px; height:18px; line-height:18px; border-radius:50%;
    display:inline-flex; align-items:center; justify-content:center;
    border:0; background:transparent; color:#9ca3af; font-weight:700;
  }
  .chip-x:hover{ background:#dfe2e6; color:#374151; }
</style>
