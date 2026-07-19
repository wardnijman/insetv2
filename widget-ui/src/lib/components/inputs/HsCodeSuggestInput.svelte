<!-- Geport uit v1 src/lib/components/inputs/HsCodeSuggestInput.svelte.
     Wijzigingen: geen. (onDestroy doet alleen clearTimeout — SSR-veilig;
     portal-action en svelte:window draaien niet serverside.) -->
<svelte:options runes={false} />

<script lang="ts">
  // HS-code cell for the customs grid. The cell itself only *shows* state —
  // the 100px column is too small to work in. All interaction lives in a
  // roomy picker popover that opens on focus (empty field) or click (filled
  // field): its own search input, the AI suggestion for this product pinned
  // on top with its rationale, search results below, and a "use this code"
  // row for directly typed/pasted digits. An AI-filled value (equal to the
  // suggestion) is marked with a blue dotted underline until the user edits
  // it; hovering the cell shows the model's one-line rationale. Wraps
  // ValidatedInput so validation/submit-gating behaves like every other
  // grid field.
  import { onDestroy, tick } from "svelte";
  import ValidatedInput from "./ValidatedInput.svelte";
  import { m } from "../../state/messageStore";
  import type { ShipmentTemplate, ValidationResult } from "../../types/config";
  import type { HsSuggestion, HsSearchResult } from "../../api/hsSuggest";
  import { searchHsCodes } from "../../api/hsSuggest";

  export let name: string;
  export let value: any;
  export let shipmentTemplate: ShipmentTemplate;
  export let validator: {
    dependsOn: (template: any) => any;
    validate: (fields: any) => ValidationResult | Promise<ValidationResult>;
  };
  export let inputClass: string = "";
  export let placeholder = "";
  export let suggestion: HsSuggestion | undefined = undefined;
  export let userId: string = "";
  // The grid row's product — shown in the picker header and passed to the
  // search model as context so short queries resolve against the right item.
  export let searchProduct: { name?: string; description?: string } | undefined =
    undefined;

  let wrapperEl: HTMLDivElement;
  let panelEl: HTMLDivElement | null = null;
  let searchEl: HTMLInputElement;
  let focused = false;

  // ── Picker state ──
  let pickerOpen = false;
  let panelTop = 0;
  let panelLeft = 0;
  let pickerQuery = "";
  let searchLoading = false;
  let searchResults: HsSearchResult[] = [];
  let highlight = 0;
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let searchSeq = 0;

  $: msgs = m?.shipmentWizard?.productStep?.hsSuggest ?? {};

  // AI-filled and not yet touched by the user: blue dotted underline; the
  // marker drops as soon as the value diverges from the suggestion.
  $: unconfirmed =
    !!suggestion?.hsCode && !!value && value === suggestion?.hsCode;

  $: effectiveInputClass =
    inputClass +
    (unconfirmed
      ? " underline decoration-dotted decoration-blue-400 underline-offset-2"
      : "");

  // Red feedback is deferred while the user is actually working in this
  // field — the picker is open, or they're typing digits directly.
  $: suppressInvalid = pickerOpen || (focused && !!value);

  // ── Option list (keyboard-navigable, top to bottom) ──
  $: trimmedQuery = pickerQuery.trim();
  $: rawDigits = trimmedQuery.replace(/\D/g, "");
  $: queryIsNumeric = /^[\d.\s]+$/.test(trimmedQuery);
  $: canUseRaw = queryIsNumeric && rawDigits.length >= 6 && rawDigits.length <= 10;

  type PickerOption = {
    kind: "raw" | "ai" | "result";
    hsCode: string;
    label: string;
  };

  $: options = [
    ...(canUseRaw
      ? [{ kind: "raw", hsCode: rawDigits, label: msgs.useCode ?? "Gebruik code" } as PickerOption]
      : []),
    ...(suggestion?.hsCode
      ? [{ kind: "ai", hsCode: suggestion.hsCode, label: suggestion.note } as PickerOption]
      : []),
    ...searchResults
      .filter(
        (r) =>
          r.hsCode !== suggestion?.hsCode &&
          (!canUseRaw || r.hsCode !== rawDigits),
      )
      .map((r) => ({ kind: "result", hsCode: r.hsCode, label: r.description }) as PickerOption),
  ];
  $: if (highlight >= options.length || (highlight < 0 && options.length)) {
    highlight = options.length ? 0 : -1;
  }

  // The grid sits above sections that create their own stacking contexts
  // (the customs-invoice card paints OVER an absolutely-positioned panel and
  // swallows its clicks). So the panel is portaled to document.body with
  // fixed positioning — inline styles, since host-page CSS on the TFF
  // back-office can override generic utility classes but never inline style.
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return {
      destroy() {
        if (node.parentNode) node.parentNode.removeChild(node);
      },
    };
  }

  const PANEL_WIDTH = 340;

  function positionPanel() {
    if (!wrapperEl) return;
    const r = wrapperEl.getBoundingClientRect();
    const margin = 8;
    let left = r.left;
    if (left + PANEL_WIDTH > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - margin - PANEL_WIDTH);
    }
    panelTop = r.bottom + 4;
    panelLeft = left;
  }

  function onWindowScrollOrResize() {
    if (pickerOpen) positionPanel();
  }

  function openPicker() {
    if (pickerOpen) return;
    positionPanel();
    pickerOpen = true;
    pickerQuery = "";
    searchResults = [];
    highlight = 0;
    void tick().then(() => searchEl?.focus());
  }

  function closePicker() {
    clearTimeout(searchTimer);
    searchSeq++;
    pickerOpen = false;
    pickerQuery = "";
    searchResults = [];
    searchLoading = false;
    highlight = 0;
  }

  function applyOption(opt: PickerOption | undefined) {
    if (!opt?.hsCode) return;
    value = opt.hsCode;
    closePicker();
  }

  // ── Search (debounced, inside the picker) ──
  function onQueryInput() {
    clearTimeout(searchTimer);
    const q = pickerQuery.trim();
    const digits = q.replace(/\D/g, "");
    const numeric = /^[\d.\s]*$/.test(q);
    const searchable =
      !!userId &&
      !!q &&
      (numeric ? digits.length >= 2 && digits.length < 8 : q.length >= 3);

    if (!searchable) {
      searchSeq++;
      searchResults = [];
      searchLoading = false;
      return;
    }
    searchTimer = setTimeout(() => void runSearch(q), 450);
  }

  async function runSearch(q: string) {
    const seq = ++searchSeq;
    searchLoading = true;
    const results = await searchHsCodes(userId, q, searchProduct);
    if (seq !== searchSeq) return;
    searchResults = results;
    searchLoading = false;
  }

  onDestroy(() => clearTimeout(searchTimer));

  // ── Open/close triggers ──
  // Focusing an empty cell opens the picker (that's the field the user still
  // has to fill); a filled cell opens on click so tabbing across the grid
  // doesn't pop panels.
  function onFocusIn(e: FocusEvent) {
    focused = true;
    const target = e.target as HTMLElement | null;
    if (target === innerInput() && !value) openPicker();
  }
  function onFocusOut(e: FocusEvent) {
    const rt = e.relatedTarget as Node | null;
    if (!wrapperEl?.contains(rt) && !panelEl?.contains(rt)) {
      focused = false;
      closePicker();
    }
  }
  function onCellClick(e: MouseEvent) {
    if ((e.target as HTMLElement | null) === innerInput()) openPicker();
  }
  function onWindowPointerDown(e: MouseEvent) {
    const t = e.target as Node;
    if (
      pickerOpen &&
      wrapperEl &&
      !wrapperEl.contains(t) &&
      !panelEl?.contains(t)
    ) {
      closePicker();
    }
  }
  function innerInput(): HTMLInputElement | null {
    return wrapperEl?.querySelector(`input[name="${name}"]`) ?? null;
  }

  function onPickerKeydown(e: KeyboardEvent) {
    if (e.key === "ArrowDown" && options.length) {
      e.preventDefault();
      highlight = (highlight + 1) % options.length;
    } else if (e.key === "ArrowUp" && options.length) {
      e.preventDefault();
      highlight = (highlight - 1 + options.length) % options.length;
    } else if (e.key === "Enter") {
      e.preventDefault();
      applyOption(options[highlight]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closePicker();
    }
  }

  // CN codes read best in their customary 4-2-2 grouping ("9506 69 00").
  // Display only — the stored value stays digits.
  function formatCn(code: string | undefined): string {
    const d = String(code ?? "");
    return d.length === 8 ? `${d.slice(0, 4)} ${d.slice(4, 6)} ${d.slice(6)}` : d;
  }

  const confidenceDot: Record<string, string> = {
    high: "bg-emerald-400",
    medium: "bg-amber-400",
    low: "bg-gray-300",
  };
</script>

<svelte:window
  on:mousedown={onWindowPointerDown}
  on:scroll|capture={onWindowScrollOrResize}
  on:resize={onWindowScrollOrResize}
/>

<div
  bind:this={wrapperEl}
  class="relative"
  title={unconfirmed ? suggestion?.note : undefined}
  on:focusin={onFocusIn}
  on:focusout={onFocusOut}
  on:click={onCellClick}
>
  <ValidatedInput
    {name}
    type="text"
    bind:value
    {placeholder}
    {shipmentTemplate}
    {validator}
    compactValidation={true}
    inputClass={effectiveInputClass}
    {suppressInvalid}
  />

  {#if pickerOpen}
    <div
      use:portal
      bind:this={panelEl}
      on:focusout={onFocusOut}
      style={`position:fixed;top:${panelTop}px;left:${panelLeft}px;width:${PANEL_WIDTH}px;z-index:2147483000;`}
      class="overflow-hidden rounded-lg bg-white text-left shadow-xl ring-1 ring-gray-200"
    >
      {#if searchProduct?.name}
        <div class="truncate px-3 pt-2 text-[11px] text-gray-400">
          {msgs.pickerTitle ?? "HS-code voor"}
          <span class="text-gray-500">“{searchProduct.name}”</span>
        </div>
      {/if}

      <div class="px-2.5 pt-1.5 pb-1">
        <div class="relative">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            class="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-300"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <input
            bind:this={searchEl}
            bind:value={pickerQuery}
            on:input={onQueryInput}
            on:keydown={onPickerKeydown}
            type="text"
            placeholder={msgs.pickerSearchPlaceholder ??
              "Zoek op omschrijving of code…"}
            class="w-full rounded-md border border-gray-200 bg-gray-50/50 py-1.5 pl-7 pr-2 text-[13px] text-gray-700 placeholder-gray-400 focus:border-blue-400 focus:bg-white focus:outline-none"
          />
        </div>
      </div>

      <div class="max-h-56 overflow-y-auto pb-1">
        {#each options as opt, i}
          <button
            type="button"
            tabindex="-1"
            class={`flex w-full items-baseline gap-2.5 px-3 py-1.5 text-left cursor-pointer transition-colors ${
              i === highlight ? "bg-blue-50" : "hover:bg-gray-50"
            }`}
            on:mousedown|preventDefault={() => applyOption(opt)}
            on:mouseenter={() => (highlight = i)}
          >
            {#if opt.kind === "ai"}
              <svg
                viewBox="0 0 24 24"
                fill="currentColor"
                class="h-3 w-3 shrink-0 self-center text-blue-400"
              >
                <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
              </svg>
            {/if}
            <span
              class="shrink-0 whitespace-nowrap font-mono text-[13px] font-medium tabular-nums text-gray-900"
              >{formatCn(opt.hsCode)}</span
            >
            <span class="truncate text-xs text-gray-500">{opt.label}</span>
            {#if opt.kind === "ai" && suggestion}
              <span
                class={`ml-auto h-1.5 w-1.5 shrink-0 self-center rounded-full ${confidenceDot[suggestion.confidence] ?? "bg-gray-300"}`}
                title={suggestion.confidence}
              ></span>
            {/if}
          </button>
        {/each}

        {#if searchLoading}
          <div class="flex items-center gap-2 px-3 py-2 text-xs text-gray-400">
            <span
              class="h-3 w-3 shrink-0 animate-spin rounded-full border-[1.5px] border-gray-300 border-t-transparent"
            ></span>
            {msgs.searching ?? "Zoeken…"}
          </div>
        {:else if trimmedQuery && !options.length}
          <div class="px-3 py-2 text-xs text-gray-400">
            {msgs.noResults ?? "Geen resultaten — probeer een productomschrijving"}
          </div>
        {:else if !trimmedQuery && !options.length}
          <div class="px-3 py-2 text-xs text-gray-400">
            {msgs.searchHint ?? "Typ een code of omschrijving, bijv. 'zonnebril'"}
          </div>
        {/if}
      </div>

      <div
        class="flex items-center gap-1.5 border-t border-gray-100 px-3 py-1.5 text-[10px] text-gray-400"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" class="h-2.5 w-2.5 shrink-0">
          <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
        </svg>
        {msgs.disclaimer ?? "AI-suggestie — controleer de goederencode."}
      </div>
    </div>
  {/if}
</div>
