<script lang="ts">
  // Geport uit v1 src/lib/components/validated-fields/DynamicValidatedField.svelte.
  // Wijzigingen (widget-extractie):
  // - `import domain from "../../steps/domain.json"` (generated) vervangen door een
  //   `provider: WidgetProviderLayer`-prop; de file-upload-limieten komen uit
  //   provider.domain (zelfde keys: maxFileUploadSize/maxConcurrentFileUpload/
  //   allowedFileUploadFormats). Alle overige props (m, fieldDef, fieldKey,
  //   shipmentTemplate, validator) behouden v1's componentinterface exact.
  // - SSR-veiligheid: de window-click-listener zit nu in een onMount-return i.p.v.
  //   een losse onDestroy (onDestroy draait ook server-side en mag window niet raken).
  import { readable, type Readable, type Writable, writable } from "svelte/store";
  import { onMount, onDestroy, tick } from "svelte";
  import { fieldValidity, showAllErrors } from "../../state/formValidation";
  import type { ShipmentTemplate, ValidationResult } from "../../types/config";
  import type { WidgetProviderLayer } from "../../providers/types";

  // --- config ---
  export let debug: boolean = false;

  // --- i18n (plain object expected) ---
  export let m: any;

  // --- provider-laag (v2): levert de domeintabellen die v1 uit steps/domain.json las ---
  export let provider: WidgetProviderLayer;
  const domain: any = provider.domain;

  // ---- Types ----
  type FieldDef = {
    label: string;
    inputType:
      | "text"
      | "select"
      | "multiselect"
      | "textarea"
      | "checkbox"
      | "date"
      | "file"
      | "number"
      | "blob"
      | "blobs"
      | "radio";
    options?: (string | { value: any; label?: string })[];
    description?: string;
    bindPath: string;
  };

  // Accept store **or** plain object for fieldDef + shipmentTemplate
  export let fieldDef: Readable<FieldDef> | FieldDef;
  export let fieldKey: string;
  export let shipmentTemplate: ShipmentTemplate | Writable<ShipmentTemplate>;
  export let validator: {
    dependsOn: (template: any) => any;
    validate: (fields: any) => ValidationResult | Promise<ValidationResult>;
  };

  // ---- Debug helper ----
  function dbg(event: string, data?: any) {
    if (!debug) return;
    try { console.log(`[ValidatedInput:${fieldKey}] ${event}`, data ?? ""); } catch {}
  }

  // ---- Wrap inputs into stores if needed ----
  let fieldDefStore: Readable<FieldDef> =
    typeof (fieldDef as any)?.subscribe === "function"
      ? (fieldDef as Readable<FieldDef>)
      : readable(fieldDef as FieldDef);

  let tmplStore: Readable<ShipmentTemplate> =
    typeof (shipmentTemplate as any)?.subscribe === "function"
      ? (shipmentTemplate as Writable<ShipmentTemplate>)
      : readable(shipmentTemplate as ShipmentTemplate);

  // Deref reactive
  $: def = $fieldDefStore;
  $: tmpl = $tmplStore;

  // ---- Utils ----
  function getDeep(obj: any, path: string): any {
    return path.split(".").reduce((o, k) => o?.[k], obj);
  }
  function setDeep(obj: any, path: string, value: any): void {
    const keys = path.split(".");
    const last = keys.pop();
    const target = keys.reduce((o, k) => (o[k] ??= {}), obj);
    if (last) target[last] = value;
  }
  function normalizeKey(v: any): string {
    return String(v ?? "").trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
  }

  const result = writable<ValidationResult>({ valid: true, message: "" });
  let validationToken = 0;
  let el: HTMLInputElement | HTMLTextAreaElement;
  let dragOver = false;

  // Rood pas tonen na blur/interactie of wanneer de stap alle fouten onthult
  // (zelfde touched-gating als ValidatedInput — geen rood-bij-render). De
  // validity zelf wordt wél vanaf mount bijgehouden, zodat submit-gating klopt.
  let touched = false;
  $: showInvalid = !$result.valid && (touched || $showAllErrors);

  // ---- Value from template (reactive to tmpl + bindPath) ----
  $: val = getDeep(tmpl, def.bindPath);

  // Defensive: log bindPath changes
  let _prevBind = "";
  $: if (def?.bindPath !== _prevBind) {
    dbg("bindPathChanged", { prev: _prevBind, next: def?.bindPath });
    _prevBind = def?.bindPath;
  }

  // ---- Options normalization (reactive to def.options) ----
  function normalizeOptions(
    opts?: (string | { value: any; label?: string })[],
  ): { value: string; label: string }[] {
    if (!opts?.length) return [];
    return opts.map((o) => {
      const rawValue = typeof o === "string" ? o : o.value;
      const rawLabel = typeof o === "string" ? o : (o.label ?? String(rawValue));
      return { value: String(rawValue), label: rawLabel };
    });
  }
  $: normalizedOptions = normalizeOptions(def.options);

  // Track options changes with a signature to avoid false positives
  let _prevOptSig = "";
  let optionsVersion = 0;
  $: {
    const sig = JSON.stringify(normalizedOptions.map((o) => [o.value, o.label]));
    if (sig !== _prevOptSig) {
      optionsVersion++;
      dbg("optionsChanged", { version: optionsVersion, options: normalizedOptions });
      _prevOptSig = sig;
    }
  }

  // ---- Interaction flags (avoid nuking initial values on first options load) ----
  let didInteract = false;

  // ---- Defensive reactivity logs for val ----
  let _prevVal: any = Symbol("unset");
  $: if (val !== _prevVal) {
    dbg("valChanged", { prev: _prevVal, next: val, type: typeof val });
    _prevVal = val;
  }

  // --- SELECT: coerce to string for DOM binding to avoid placeholder issues ---
  $: selectVal = def.inputType === "select" ? (val == null ? "" : String(val)) : "";

  // Try to auto-coerce non-exact values once (case/format differences)
  let coercedOnce = false;
  $: if (
    def.inputType === "select" &&
    normalizedOptions.length &&
    !coercedOnce &&
    selectVal !== "" &&
    !normalizedOptions.some((o) => o.value === selectVal)
  ) {
    const match = normalizedOptions.find((o) => normalizeKey(o.value) === normalizeKey(selectVal));
    if (match) {
      dbg("coerceValToOption", { from: selectVal, to: match.value });
      coercedOnce = true;
      update(match.value);
    } else {
      dbg("valueNotInOptions", { selectVal, options: normalizedOptions.map((o) => o.value) });
    }
  }

  // If options change and current value becomes invalid -> reset/prune
  // Guarded by interaction or after >1 options refresh (avoid nuking initial)
  $: if (def.inputType === "select" && normalizedOptions.length && (didInteract || optionsVersion > 1)) {
    if (
      selectVal !== "" &&
      !normalizedOptions.some((o) => o.value === selectVal)
    ) {
      dbg("pruneSelectValue", { current: selectVal, allowed: normalizedOptions.map((o) => o.value) });
      update("");
    }
  }
  $: if (def.inputType === "multiselect" && normalizedOptions.length && (didInteract || optionsVersion > 1)) {
    if (!Array.isArray(val)) {
      dbg("normalizeMultiselectToArray", { from: val });
      update([]);
    } else {
      const allowed = new Set(normalizedOptions.map((o) => String(o.value)));
      const pruned = (val as any[]).filter((v) => allowed.has(String(v)));
      if (pruned.length !== (val as any[]).length) {
        dbg("pruneMultiselectValues", { from: val, to: pruned });
        update(pruned);
      }
    }
  }

  // Validate whenever value or options change
  $: if (validator) { selectVal; normalizedOptions; validateNow(); }

  onMount(() => {
    dbg("mounted", {
      isShipmentStore: typeof (shipmentTemplate as any)?.subscribe === "function",
      isFieldDefStore: typeof (fieldDef as any)?.subscribe === "function"
    });
    tick().then(() => validateNow());
  });
  onDestroy(() => dbg("destroyed"));

  function update(v: any) {
    dbg("updateCalled", { to: v, type: typeof v });
    const isStore = typeof (shipmentTemplate as any)?.update === "function";
    if (isStore) {
      (shipmentTemplate as Writable<ShipmentTemplate>).update((t) => {
        setDeep(t, def.bindPath, v);
        return t;
      });
    } else {
      setDeep(shipmentTemplate as ShipmentTemplate, def.bindPath, v);
    }
    val = v;
    validateNow();
  }

  async function validateNow() {
    if (!validator) return;
    const currentToken = ++validationToken;
    const deps = validator.dependsOn(
      typeof (shipmentTemplate as any)?.subscribe === "function" ? $tmplStore : shipmentTemplate
    );
    try {
      const validationResult = await validator.validate(deps);
      if (currentToken === validationToken) {
        result.set(validationResult);
        fieldValidity.update((map) => ({ ...map, [fieldKey]: validationResult.valid }));
        dbg("validated", validationResult);
      } else {
        dbg("validateStaleTokenDiscarded");
      }
    } catch (e) {
      dbg("validateError", e);
    }
  }

  // --- file handlers (with unsupported-format + allowed ext UI) ---
  const maxSizeBytes = domain.maxFileUploadSize * 1024;
  const maxFiles = domain.maxConcurrentFileUpload;
  const allowedFileFormats: string[] = (domain as any).allowedFileUploadFormats ?? [];
  const allowedExts: string[] = allowedFileFormats.map((f) => f.replace(/^\./, "").toLowerCase());
  const acceptAttr: string = allowedExts.length ? allowedExts.map((e) => `.${e}`).join(",") : "";

  function isAllowedFile(file: File): boolean {
    if (!allowedExts.length) return true;
    const name = file.name ?? "";
    const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
    return allowedExts.includes(ext);
  }

  async function handleFiles(files: FileList | File[] | null | undefined) {
    if (!files) return;
    didInteract = true;
    touched = true;

    const fileArray = Array.from(files).filter((f) => f.size > 0);

    if (def.inputType === "blobs" && fileArray.length > maxFiles) {
      result.set({
        valid: false,
        message: `${m?.serviceSettingComponents?.maxNumOfFilesAllowedStart ?? ""}${maxFiles}${m?.serviceSettingComponents?.maxNumOfFilesAllowedEnd ?? ""}`,
      });
      fieldValidity.update((map) => ({ ...map, [fieldKey]: false }));
      return;
    }

    const invalid = fileArray.find((f) => !isAllowedFile(f));
    if (invalid) {
      const allowedPretty = allowedExts.map((e) => `.${e}`).join(", ");
      result.set({
        valid: false,
        message:
          `${m?.serviceSettingComponents?.file ?? "File"} ${invalid.name}: ` +
          `${m?.serviceSettingComponents?.unsupportedFormat ?? "unsupported format"}. ` +
          `${m?.serviceSettingComponents?.allowed ?? "Allowed"}: ${allowedPretty}.`,
      });
      fieldValidity.update((map) => ({ ...map, [fieldKey]: false }));
      return;
    }

    const oversized = fileArray.find((f) => f.size > maxSizeBytes);
    if (oversized) {
      result.set({
        valid: false,
        message: `${m?.serviceSettingComponents?.file ?? "File"} ${oversized.name} ${m?.serviceSettingComponents?.isGreaterThan ?? "is greater than"} ${domain.maxFileUploadSize} KB.`,
      });
      fieldValidity.update((map) => ({ ...map, [fieldKey]: false }));
      return;
    }

    if (def.inputType === "blob") {
      const accepted = fileArray[0];
      const reader = new FileReader();
      reader.onload = () => {
        update({
          base64: (reader.result as string).split(",")[1],
          filename: accepted.name,
          contentType: accepted.type,
        });
      };
      reader.readAsDataURL(accepted);
    } else if (def.inputType === "blobs") {
      const filesWithBase64 = await Promise.all(
        fileArray.map(
          (file) =>
            new Promise((resolve) => {
              const reader = new FileReader();
              reader.onload = () =>
                resolve({
                  base64: (reader.result as string).split(",")[1],
                  filename: file.name,
                  contentType: file.type,
                });
              reader.readAsDataURL(file);
            }),
        ),
      );
      update(filesWithBase64);
    }

    result.set({ valid: true, message: "" });
    fieldValidity.update((map) => ({ ...map, [fieldKey]: true }));
  }

  // -------- Multiselect state & helpers --------
  let msOpen = false;
  let msQuery = "";
  let msFocusIdx = -1;
  let msRoot: HTMLDivElement;

  function msDisplayLabel(v: any): string {
    const o = normalizedOptions.find((o) => String(o.value) === String(v));
    return o ? o.label : String(v);
  }
  function msSelectedSet(): Set<string> {
    return new Set((Array.isArray(val) ? val : []).map((x) => String(x)));
  }
  $: msFiltered = normalizedOptions.filter((o) =>
    msQuery.trim()
      ? o.label.toLowerCase().includes(msQuery.toLowerCase()) ||
        String(o.value).toLowerCase().includes(msQuery.toLowerCase())
      : true
  );

  function msToggle(value: any) {
    didInteract = true;
    touched = true;
    const s = msSelectedSet();
    const k = String(value);
    if (s.has(k)) {
      update((Array.isArray(val) ? val : []).filter((x: any) => String(x) !== k));
    } else {
      update([...(Array.isArray(val) ? val : []), String(value)]);
    }
  }
  function msRemove(value: any) {
    didInteract = true;
    update((Array.isArray(val) ? val : []).filter((x: any) => String(x) !== String(value)));
  }
  function msClear() {
    didInteract = true;
    update([]);
  }

  function openMs() {
    msOpen = true;
    msFocusIdx = msFiltered.length ? 0 : -1;
  }

  function closeMs() {
    msOpen = false;
    msQuery = "";
    msFocusIdx = -1;
  }

  function onMsKeyDown(e: KeyboardEvent) {
    if (!msOpen && (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      openMs();
      return;
    }
    if (!msOpen) return;

    if (e.key === "Escape") {
      e.preventDefault();
      closeMs();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (msFiltered.length) msFocusIdx = (msFocusIdx + 1) % msFiltered.length;
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (msFiltered.length) msFocusIdx = (msFocusIdx - 1 + msFiltered.length) % msFiltered.length;
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (msFocusIdx >= 0 && msFocusIdx < msFiltered.length) {
        msToggle(msFiltered[msFocusIdx].value);
      }
      return;
    }
    if (e.key === "Backspace" && !msQuery && Array.isArray(val) && val.length) {
      msRemove(val[val.length - 1]);
      return;
    }
  }

  function isSelected(value: any): boolean {
    return msSelectedSet().has(String(value));
  }

  function startEditing() {
    if (!msOpen) openMs();
  }

  const onWindowClick = (e: MouseEvent) => {
    if (!msRoot?.contains(e.target as Node)) closeMs();
  };
  onMount(() => {
    window.addEventListener("click", onWindowClick, { capture: true });
    return () => window.removeEventListener("click", onWindowClick, { capture: true });
  });

  // --- DOM debug for select ---
  let selectEl: HTMLSelectElement;
  $: if (debug && def.inputType === "select" && selectEl) {
    dbg("domState", { selectedIndex: selectEl.selectedIndex, elValue: selectEl.value, selectVal, optionsVersion });
  }

  // Placeholder text fallback
  $: placeholderText = ((m?.serviceSettingComponents?.select ?? "Select") + "...");
</script>

<svelte:window on:keydown={(e) => { /* noop */ }} />

<div class="relative w-full">
  {#if def.inputType === "select"}
    <select
      bind:this={selectEl}
      name={fieldKey}
      bind:value={selectVal}
      on:change={(e) => { didInteract = true; touched = true; update((e.currentTarget as HTMLSelectElement).value); }}
      on:blur={() => (touched = true)}
      class="block w-full text-sm px-3 rounded-md border transition-colors bg-white appearance-none
             focus:outline-none cursor-pointer h-[2.375rem] leading-[1.25rem]
             {!showInvalid ? 'border-gray-300 focus:border-blue-500' : 'border-red-500 focus:border-red-500'}"
    >
      <!-- Do NOT hide the placeholder or the closed control renders blank when value is "" -->
      <option value="" disabled>{placeholderText}</option>
      {#each normalizedOptions as opt}
        <option value={opt.value}>{opt.label}</option>
      {/each}
    </select>

  {:else if def.inputType === "multiselect"}
    <div class="w-full" bind:this={msRoot}>
      <!-- Control -->
      <div
        role="combobox"
        aria-expanded={msOpen}
        aria-haspopup="listbox"
        tabindex="0"
        on:click|stopPropagation={() => { didInteract = true; (msOpen ? closeMs() : openMs()); }}
        on:keydown={(e) => onMsKeyDown(e)}
        class="min-h-[2.375rem] w-full px-2 py-1 text-sm rounded-md border bg-white transition-colors
               placeholder-gray-400 focus:outline-none flex items-center flex-wrap gap-1
               {!showInvalid ? 'border-gray-300 focus-within:border-blue-500' : 'border-red-500 focus-within:border-red-500'}"
      >
        {#if Array.isArray(val) && val.length}
          {#each val as v (String(v))}
            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 border border-gray-200 text-gray-800">
              {msDisplayLabel(v)}
              <button
                type="button"
                aria-label="Remove"
                class="hover:text-red-600 focus:outline-none"
                on:click|stopPropagation={() => msRemove(v)}
              >
                ×
              </button>
            </span>
          {/each}
        {/if}

        <input
          class="flex-1 min-w-[6ch] px-1 py-1 outline-none bg-transparent"
          type="text"
          placeholder={placeholderText}
          value={msQuery}
          on:focus={() => { didInteract = true; startEditing(); }}
          on:input={(e) => { didInteract = true; msQuery = (e.target as HTMLInputElement).value; msFocusIdx = 0; }}
          on:keydown={(e) => onMsKeyDown(e)}
        />

        <button
          type="button"
          aria-label="Toggle"
          class="ml-auto px-1 py-1 text-gray-500 hover:text-gray-700"
          on:click|stopPropagation={() => { didInteract = true; (msOpen ? closeMs() : openMs()); }}
        >
          <svg class="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" clip-rule="evenodd" />
          </svg>
        </button>
      </div>

      <!-- Dropdown -->
      {#if msOpen}
        <div
          role="listbox"
          class="absolute z-20 mt-1 w-full max-h-56 overflow-auto rounded-md border border-gray-200 bg-white shadow-sm"
        >
          {#if msFiltered.length === 0}
            <div class="px-3 py-2 text-xs text-gray-500">
              {m?.serviceSettingComponents?.noResults ?? "No results"} {msQuery}
            </div>
          {/if}
          {#each msFiltered as opt, i (String(opt.value))}
            <div
              role="option"
              aria-selected={isSelected(opt.value)}
              class="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer
                     hover:bg-gray-50 {i === msFocusIdx ? 'bg-gray-50' : ''}"
              on:mouseenter={() => (msFocusIdx = i)}
              on:click={() => msToggle(opt.value)}
            >
              <input type="checkbox" class="w-4 h-4 rounded border-gray-300 text-blue-600" checked={isSelected(opt.value)} readonly />
              <span class="truncate">{opt.label}</span>
            </div>
          {/each}

          {#if Array.isArray(val) && val.length}
            <div class="sticky bottom-0 bg-white border-t border-gray-200 px-3 py-2 flex justify-between items-center">
              <span class="text-xs text-gray-500">{val.length} selected</span>
              <button type="button" class="text-xs text-blue-600 hover:underline" on:click={msClear}>
                Clear
              </button>
            </div>
          {/if}
        </div>
      {/if}
    </div>

  {:else if def.inputType === "textarea"}
    <textarea
      bind:this={el}
      bind:value={val}
      on:input={(e) => { didInteract = true; update((e.currentTarget as HTMLTextAreaElement).value); }}
      on:blur={() => (touched = true)}
      name={fieldKey}
      rows="2"
      class="block w-full px-3 py-2 text-sm rounded-md border bg-white transition-colors resize-none
             placeholder-gray-400 focus:outline-none
             {!showInvalid ? 'border-gray-300 focus:border-blue-500' : 'border-red-500 focus:border-red-500'}"
    ></textarea>

  {:else if def.inputType === "checkbox"}
    <input
      type="checkbox"
      name={fieldKey}
      bind:checked={val}
      on:change={(e) => { didInteract = true; touched = true; update((e.currentTarget as HTMLInputElement).checked); }}
      class="w-4 h-4 border-gray-300 rounded text-blue-600 focus:ring-blue-500"
    />

  {:else if def.inputType === "radio"}
    <div class="flex flex-wrap gap-4">
      {#each normalizedOptions as opt}
        <label class="inline-flex items-center gap-2 cursor-pointer text-sm text-gray-700">
          <input
            type="radio"
            name={fieldKey}
            value={opt.value}
            checked={String(val ?? "") === opt.value}
            on:change={() => { didInteract = true; touched = true; update(opt.value); }}
            class="w-4 h-4 border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <span>{opt.label}</span>
        </label>
      {/each}
    </div>

  {:else if def.inputType === "blob" || def.inputType === "blobs"}
    <div
      class="border-dashed border-2 rounded-xl p-6 text-sm text-gray-600 bg-gray-50 transition-colors cursor-pointer relative overflow-hidden text-center"
      class:border-blue-500={dragOver}
      class:border-gray-300={!dragOver}
      on:drop={(e) => { e.preventDefault(); dragOver = false; handleFiles(e.dataTransfer?.files); }}
      on:dragover={(e) => { e.preventDefault(); dragOver = true; }}
      on:dragleave={() => (dragOver = false)}
    >
      <input
        type="file"
        multiple={def.inputType === "blobs"}
        accept={acceptAttr}
        on:change={(e) => handleFiles((e.target as HTMLInputElement).files)}
        class="absolute inset-0 opacity-0 cursor-pointer"
      />

      <svg class="h-7 w-7 mx-auto text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16V4m0 0L3 8m4-4l4 4m5 12v-4m0 0l-4 4m4-4l4 4" />
      </svg>

      <div class="text-sm font-medium">
        {m?.serviceSettingComponents?.dragFile ?? "Drag a file"}{def.inputType === "blobs" ? " en " : " "}
        {m?.serviceSettingComponents?.orClick ?? "or click"}
      </div>
      <div class="text-xs text-gray-500">
        Max. {domain.maxFileUploadSize} KB {m?.serviceSettingComponents?.perFile ?? "per file"}
        {#if allowedExts.length} &middot; {(m?.serviceSettingComponents?.allowed ?? "Allowed")}: {allowedExts.map((e) => `.${e}`).join(", ")}{/if}
        {#if def.inputType === "blobs"}<br />Max. {domain.maxConcurrentFileUpload} {m?.serviceSettingComponents?.files ?? "files"}{/if}
      </div>

      {#if val}
        <div class="mt-2 text-xs text-gray-500">
          {#if Array.isArray(val)}
            {#each val as file (file.filename)}
              <div class="truncate">{file.filename}</div>
            {/each}
          {:else}
            <div class="truncate">{val.filename}</div>
          {/if}
        </div>
      {/if}
    </div>

  {:else}
    <input
      bind:this={el}
      name={fieldKey}
      type={def.inputType}
      bind:value={val}
      on:input={(e) => { didInteract = true; update((e.currentTarget as HTMLInputElement).value); }}
      on:blur={() => (touched = true)}
      class="block w-full px-3 py-2 text-sm rounded-md border bg-white transition-colors
             placeholder-gray-400 focus:outline-none
             {!showInvalid ? 'border-gray-300 focus:border-blue-500' : 'border-red-500 focus:border-red-500'}"
    />
  {/if}

  {#if def.description}
    <p class="mt-1 text-xs text-gray-500 leading-snug">{def.description}</p>
  {/if}

  {#if showInvalid}
    <div class="absolute right-0 bottom-[-1.25rem] text-xs text-red-600 flex items-center space-x-1 pointer-events-none select-none">
      <svg class="w-3.5 h-3.5 shrink-0" viewBox="0 0 20 20" fill="currentColor">
        <path fill-rule="evenodd"
          d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-11.5a.75.75 0 00-1.5 0v4a.75.75 0 001.5 0v-4zm0 6.5a.75.75 0 00-1.5 0v.25a.75.75 0 001.5 0V13z"
          clip-rule="evenodd" />
      </svg>
      <span>{$result.message}</span>
    </div>
  {/if}
</div>
