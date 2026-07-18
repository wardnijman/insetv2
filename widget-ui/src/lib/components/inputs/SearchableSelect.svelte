<!-- src/lib/components/inputs/SearchableSelect.svelte -->
<script lang="ts">
    import { createEventDispatcher, onMount } from "svelte";

    export let options: { value: string; label: string }[] = [];
    export let selected: string | null = null; // controlled by parent
    export let placeholder = "Select…";
    export let widthClass = "w-[360px] md:w-[440px]";
    export let disabled = false;
    export let m;

    let root: HTMLDivElement;
    let inputEl: HTMLInputElement;
    let open = false;
    let query = "";
    let focusIdx = -1;

    $: normalized = options.map((o) => ({
        value: String(o.value),
        label: o.label,
    }));
    $: displayLabel =
        selected == null
            ? ""
            : (normalized.find((o) => o.value === String(selected))?.label ??
              "");

    $: filtered = normalized.filter((o) =>
        query.trim()
            ? o.label.toLowerCase().includes(query.toLowerCase()) ||
              o.value.toLowerCase().includes(query.toLowerCase())
            : true,
    );

    function choose(v: string | null) {
        selected = v;
        dispatch("change", v);
        query = "";
        open = false;
    }

    function toggle() {
        if (disabled) return;
        open = !open;
        if (open) setTimeout(() => inputEl?.focus(), 0);
    }

    function onKeyDown(e: KeyboardEvent) {
        if (
            !open &&
            (e.key === "Enter" || e.key === " " || e.key === "ArrowDown")
        ) {
            e.preventDefault();
            open = true;
            setTimeout(() => inputEl?.focus(), 0);
            return;
        }
        if (!open) return;

        if (e.key === "Escape") {
            e.preventDefault();
            open = false;
            return;
        }
        if (e.key === "ArrowDown") {
            e.preventDefault();
            if (filtered.length) focusIdx = (focusIdx + 1) % filtered.length;
            return;
        }
        if (e.key === "ArrowUp") {
            e.preventDefault();
            if (filtered.length)
                focusIdx = (focusIdx - 1 + filtered.length) % filtered.length;
            return;
        }
        if (e.key === "Enter") {
            e.preventDefault();
            if (focusIdx >= 0 && focusIdx < filtered.length)
                choose(filtered[focusIdx].value);
            return;
        }
    }

    // add "delete" event + toggle
    const dispatch = createEventDispatcher<{
        change: string | null;
        delete: string;
    }>();
    export let showDelete = false;

    const onDocClick = (e: MouseEvent) => {
        if (!root?.contains(e.target as Node)) open = false;
    };
    // v1 gebruikte een losse onDestroy voor de cleanup, maar onDestroy draait in
    // Svelte 5 óók bij server-render (waar `document` niet bestaat). Cleanup via de
    // onMount-return is browser-gedrag-identiek én SSR-veilig.
    onMount(() => {
        document.addEventListener("click", onDocClick, { capture: true });
        return () =>
            document.removeEventListener("click", onDocClick, {
                capture: true,
            });
    });
</script>

<form autocomplete="off" style="position:absolute; top:-9999px; left:-9999px;">
    <input type="text" name="fake" />
</form>

<div class={`relative ${widthClass}`} bind:this={root}>
    <div
        class="h-10 w-full flex items-center gap-2 px-2.5 rounded-lg border bg-white transition-colors
           focus-within:border-blue-500 border-gray-300"
    >
        <input
            bind:this={inputEl}
            type="text"
            class="flex-1 bg-transparent outline-none text-sm placeholder-gray-400"
            {placeholder}
            {disabled}
            value={open ? query : displayLabel}
            readonly={!open}
            autocomplete="off"
            on:focus={() => {
                if (!open) {
                    open = true;
                    query = "";
                    setTimeout(() => inputEl?.select(), 0);
                }
            }}
            on:input={(e) => {
                query = (e.target as HTMLInputElement).value;
                focusIdx = 0;
            }}
            on:keydown={onKeyDown}
        />

        {#if selected}
            <button
                type="button"
                class="px-1 text-gray-400 hover:text-gray-600"
                aria-label="Clear"
                on:click={() => choose(null)}
            >
                ×
            </button>
        {/if}

        <button
            type="button"
            class="px-1 text-gray-500 hover:text-gray-700"
            aria-label="Toggle"
            on:click={toggle}
        >
            <svg class="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                <path
                    fill-rule="evenodd"
                    d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z"
                    clip-rule="evenodd"
                />
            </svg>
        </button>
    </div>

    {#if open}
        <div
            class="absolute z-30 mt-1 w-full max-h-64 overflow-auto rounded-md border border-gray-200 bg-white shadow-sm"
            role="listbox"
        >
            {#if !filtered.length}
                <div class="px-3 py-2 text-xs text-gray-500">
                    {m.shipmentWizard.receiverStep.noResults}
                </div>
            {/if}

            {#each filtered as opt, i (opt.value)}
                <div
                    role="option"
                    aria-selected={String(opt.value) === String(selected)}
                    class="flex items-center justify-between gap-2 px-3 py-2 text-sm cursor-pointer
         hover:bg-gray-50 {i === focusIdx ? 'bg-gray-50' : ''}"
                    on:mouseenter={() => (focusIdx = i)}
                    on:click={() => choose(opt.value)}
                >
                    <span class="truncate">{opt.label}</span>

                    <div class="flex items-center gap-1">
                        {#if String(opt.value) === String(selected)}
                            <svg
                                class="w-4 h-4 text-blue-600"
                                viewBox="0 0 20 20"
                                fill="currentColor"
                            >
                                <path
                                    fill-rule="evenodd"
                                    d="M16.704 5.29a1 1 0 010 1.414l-7.25 7.25a1 1 0 01-1.415 0l-3.25-3.25a1 1 0 111.414-1.414L8.75 11.54l6.543-6.54a1 1 0 011.414 0z"
                                    clip-rule="evenodd"
                                />
                            </svg>
                        {/if}

                        {#if showDelete}
                            <button
                                type="button"
                                aria-label="Delete"
                                class="px-1 text-gray-400 hover:text-red-600"
                                on:click|stopPropagation={() =>
                                    dispatch("delete", opt.value)}
                                title="Verwijderen"
                            >
                                ×
                            </button>
                        {/if}
                    </div>
                </div>
            {/each}
        </div>
    {/if}
</div>
