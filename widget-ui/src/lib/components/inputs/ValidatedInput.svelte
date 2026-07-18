<svelte:options runes={false} />

<script lang="ts">
  import { afterUpdate, onDestroy, tick } from "svelte";
  import type { ShipmentTemplate, ValidationResult } from "../../types/config";
  import {
    fieldValidity,
    clearFieldValidityKey,
    showAllErrors,
  } from "../../state/formValidation";

  export let name: string;
  export let value: any;
  export let shipmentTemplate: ShipmentTemplate;
  export let type: string = "text";
  export let inputClass: string = "";
  export let shouldAutofocus = false;
  export let focusToken: number = 0; // 👈 new prop
  export let compactValidation = false;
  export let placeholder = "";
  // Visual-only: hide the red border/icon while the parent knows the current
  // value is transient (e.g. a search query being typed in the HS field).
  // fieldValidity still records the real state, so submit stays gated.
  export let suppressInvalid = false;

  export let validator: {
    dependsOn: (template: any) => any;
    validate: (fields: any) => ValidationResult | Promise<ValidationResult>;
  };

  let result: ValidationResult = { valid: true, message: "" };
  let inputEl: HTMLInputElement;

  // Error styling is gated on "touched" (field was blurred) or the global
  // showAllErrors flag (user pressed Verder on an invalid step). Validity
  // itself is tracked from mount so step gating keeps working.
  let touched = false;
  $: showInvalid = !result.valid && !suppressInvalid && (touched || $showAllErrors);

  let lastDepKey = "";
  let lastValue: any = undefined;
  let runSeq = 0;
  let scheduled = false;

  function depKeyOf(x: any) {
    try {
      return x === undefined ? "" : JSON.stringify(x);
    } catch {
      return `__nonserializable__:${Date.now()}`;
    }
  }

  function validateSoon() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      void validateNow();
    });
  }

  async function validateNow() {
    if (!validator) return;

    // ensure parent bind:value wrote into product.* before we read via closure
    await tick();

    const deps = validator.dependsOn
      ? validator.dependsOn(shipmentTemplate)
      : undefined;
    const depKey = depKeyOf(deps);
    const v = value;

    if (depKey === lastDepKey && v === lastValue) return;
    lastDepKey = depKey;
    lastValue = v;

    const seq = ++runSeq;
    const res = await validator.validate(deps);
    if (seq !== runSeq) return;

    result = res;
    fieldValidity.update((m) =>
      m[name] === res.valid ? m : { ...m, [name]: res.valid }
    );
  }

  // When this input unmounts (e.g. a conditionally-rendered field is hidden, or the customs
  // product grid collapses in "upload own invoice" mode), drop its validity entry. Otherwise a
  // stale `false` lingers in the global map and keeps the step's submit button disabled even
  // though the field is no longer on screen.
  onDestroy(() => clearFieldValidityKey(name));

  // Triggers:
  function onInput() {
    validateSoon();
  }

  // programmatic changes from parent also revalidate
  $: value, validateSoon();
  $: shipmentTemplate, validateSoon();

  // --- AUTOFOCUS ---
  // ---------- AUTOFOCUS ----------
  let lastFocusToken = -1;

  afterUpdate(() => {
    if (!shouldAutofocus) return;
    if (focusToken === lastFocusToken) return;
    lastFocusToken = focusToken;
    void focusNow();
  });

  async function focusNow() {
    if (!inputEl) return;
    await tick();
    inputEl.focus();
    inputEl.select?.();
  }
</script>

<div class="relative w-full">
  <input
    bind:this={inputEl}
    {name}
    {type}
    bind:value
    on:input={onInput}
    on:blur={() => (touched = true)}
    {placeholder}
    class={`block w-full px-3 py-2 text-sm rounded-md border bg-white transition-colors placeholder-gray-400 focus:outline-none
      ${!showInvalid ? "border-gray-300 focus:border-blue-500" : "border-red-500 focus:border-red-500"}
      ${inputClass}`}
  />

  {#if showInvalid}
    {#if compactValidation}
      <div class="absolute bottom-[2px] right-[2px] group cursor-help z-10">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="w-3.5 h-3.5 text-red-600"
          viewBox="0 0 20 20"
          fill="currentColor"
          ><path
            fill-rule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-11.5a.75.75 0 00-1.5 0v4a.75.75 0 001.5 0v-4zm0 6.5a.75.75 0 00-1.5 0v.25a.75.75 0 001.5 0V13z"
            clip-rule="evenodd"
          /></svg
        >
        <div
          class="absolute bottom-[125%] right-0 max-w-[200px] bg-red-600 text-white text-xs px-2 py-1 rounded shadow-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50"
        >
          {result.message}
        </div>
      </div>
    {:else}
      <div
        class="absolute right-0 bottom-[-1.25rem] text-xs text-red-600 flex items-center space-x-1 pointer-events-none select-none"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="w-3.5 h-3.5 shrink-0"
          viewBox="0 0 20 20"
          fill="currentColor"
          ><path
            fill-rule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-11.5a.75.75 0 00-1.5 0v4a.75.75 0 001.5 0v-4zm0 6.5a.75.75 0 00-1.5 0v.25a.75.75 0 001.5 0V13z"
            clip-rule="evenodd"
          /></svg
        >
        <span>{result.message}</span>
      </div>
    {/if}
  {/if}
</div>
