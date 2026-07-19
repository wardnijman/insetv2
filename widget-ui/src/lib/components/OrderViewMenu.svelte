<!-- Geport uit v1 src/lib/components/OrderViewMenu.svelte. Wijzigingen: geen —
     document-listener zit in onMount (SSR-veilig). -->
<script lang="ts">
  import { onMount } from "svelte";
  import type { Columns } from "../state/orderViewColumns";
  import { ORDER_ROW_LAYOUT, FIELD_LABEL, type OrderFieldKey, DEFAULT_VISIBLE } from "./orderViewFields";
  import type { Writable } from "svelte/store";

  export let columns: Writable<Columns>;

  let open = false;
  let anchor: HTMLButtonElement | null = null;
  let panel: HTMLDivElement | null = null;

  // close on outside click
  onMount(() => {
    const onDocPointerDown = (e: Event) => {
      if (!open) return;
      const t = e.target as Node;
      if (panel && !panel.contains(t) && anchor && !anchor.contains(t)) open = false;
    };
    document.addEventListener("pointerdown", onDocPointerDown, true);
    return () => document.removeEventListener("pointerdown", onDocPointerDown, true);
  });

  const setField = (k: OrderFieldKey, checked: boolean) =>
    columns.update(v => ({ ...v, [k]: checked }));
</script>

<div class="relative inline-block">
  <button
    bind:this={anchor}
    aria-haspopup="menu"
    aria-expanded={open}
    aria-label="Weergave"
    title="Weergave"
    on:click={() => (open = !open)}
    class="inline-flex items-center justify-center h-7 w-7
           border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:border-gray-300
           focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(0,105,180,0.18)]
           shadow-[0_1px_3px_rgba(0,0,0,0.04)] transition-colors"
  >
    <svg viewBox="0 0 24 24" class="w-4 h-4" aria-hidden="true">
      <rect x="4" y="5" width="16" height="3" rx="1.5" stroke="currentColor" fill="none"/>
      <rect x="4" y="10.5" width="16" height="3" rx="1.5" stroke="currentColor" fill="none"/>
      <rect x="4" y="16" width="16" height="3" rx="1.5" stroke="currentColor" fill="none"/>
    </svg>
  </button>

  {#if open}
    <div
      bind:this={panel}
      role="menu"
      tabindex="-1"
      on:keydown={(e) => e.key === 'Escape' && (open = false)}
      class="absolute right-0 mt-2 w-72 z-20 border border-gray-200 bg-white
             shadow-[0_8px_30px_rgba(0,0,0,0.06)] p-3 space-y-3"
    >
      <div class="text-[11px] font-medium text-gray-500 uppercase tracking-wide">Weergave</div>

      <div class="text-[11px] text-gray-500">Rij 1</div>
      <div class="grid grid-cols-2 gap-y-1.5">
        {#each ORDER_ROW_LAYOUT.firstLine as key}
          <label class="inline-flex items-center gap-2 text-[13px] text-gray-700">
            <input
              type="checkbox"
              checked={$columns[key]}
              on:change={(e) => setField(key, (e.currentTarget as HTMLInputElement).checked)}
              class="h-3.5 w-3.5 border-gray-300 focus:ring-[rgba(0,105,180,1)]"
            />
            {FIELD_LABEL[key]}
          </label>
        {/each}
      </div>

      <div class="pt-2 text-[11px] text-gray-500">Rij 2</div>
      <div class="grid grid-cols-2 gap-y-1.5">
        {#each ORDER_ROW_LAYOUT.secondLine as key}
          <label class="inline-flex items-center gap-2 text-[13px] text-gray-700">
            <input
              type="checkbox"
              checked={$columns[key]}
              on:change={(e) => setField(key, (e.currentTarget as HTMLInputElement).checked)}
              class="h-3.5 w-3.5 rounded border-gray-300 focus:ring-[rgba(0,105,180,1)]"
            />
            {FIELD_LABEL[key]}
          </label>
        {/each}
      </div>

      <div class="pt-2 text-[11px] text-gray-500">Avatar</div>
      <label class="inline-flex items-center gap-2 text-[13px] text-gray-700">
        <input
          type="checkbox"
          checked={$columns.platform}
          on:change={(e) => setField("platform", (e.currentTarget as HTMLInputElement).checked)}
          class="h-3.5 w-3.5 rounded border-gray-300 focus:ring-[rgba(0,105,180,1)]"
        />
        Platform
      </label>

      <div class="pt-2">
        <button class="text-[11px] text-gray-500 hover:text-gray-700" on:click={() => columns.set?.(DEFAULT_VISIBLE)}>
          Reset
        </button>
      </div>
    </div>
  {/if}
</div>
