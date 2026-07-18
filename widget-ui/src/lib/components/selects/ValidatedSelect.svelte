<script lang="ts">
  import { onDestroy } from "svelte";
  import {
    fieldValidity,
    clearFieldValidityKey,
    showAllErrors,
  } from "../../state/formValidation";
  import type { ShipmentTemplate, ValidationResult } from "../../types/config";

  export let name: string;
  export let value: any;
  export let shipmentTemplate: ShipmentTemplate;
  export let validator: {
    dependsOn: (template: any) => any;
    validate: (fields: any) => ValidationResult | Promise<ValidationResult>;
  };

  export let options: { value: string; label: string }[];
  export let inputClass: string = "";
  export let compactValidation: boolean = false;

  let result: ValidationResult = { valid: true, message: "" };

  // Error styling gated on touched/showAllErrors — see ValidatedInput.
  let touched = false;
  $: showInvalid = !result.valid && (touched || $showAllErrors);

  // Drop this field's validity entry when it unmounts — see ValidatedInput for why a stale
  // `false` would otherwise keep the submit button disabled after the field is hidden.
  onDestroy(() => clearFieldValidityKey(name));

  $: (async () => {
    if (!validator || shipmentTemplate == null || value === undefined) return;

    const deps = validator.dependsOn(shipmentTemplate);
    const res = await validator.validate(deps);
    result = res;
    fieldValidity.update((map) => ({ ...map, [name]: res.valid }));
  })();

  $: baseClass = `
    block w-full text-sm px-3 transition-colors bg-white appearance-none
    focus:outline-none cursor-pointer
    h-[2.375rem] min-h-[2.375rem] leading-[1.25rem]
    ${!showInvalid ? "border border-gray-300 focus:border-blue-500" : "border border-red-500 focus:border-red-500"}
    ${inputClass}
  `.trim();
</script>

<div class="relative w-full">
  <select
    {name}
    bind:value
    on:blur={() => (touched = true)}
    on:change={() => (touched = true)}
    class={baseClass}
    style="line-height: 1.25rem; height: 2.5rem; border-radius: 4px !important;"
  >
    <option value="" disabled hidden>Select...</option>
    {#each options as opt}
      <option value={opt.value}>{opt.label}</option>
    {/each}
  </select>

  <!-- Dropdown caret -->
  <div
    class="pointer-events-none absolute top-1/2 right-3 transform -translate-y-1/2 text-gray-400"
  >
    <svg
      class="w-4 h-4"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      viewBox="0 0 24 24"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  </div>

  {#if showInvalid}
    {#if compactValidation}
      <div class="absolute bottom-[2px] right-[2px] group cursor-help z-10">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="w-3.5 h-3.5 text-red-600"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fill-rule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-11.5a.75.75 0 00-1.5 0v4a.75.75 0 001.5 0v-4zm0 6.5a.75.75 0 00-1.5 0v.25a.75.75 0 001.5 0V13z"
            clip-rule="evenodd"
          />
        </svg>
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
        >
          <path
            fill-rule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-11.5a.75.75 0 00-1.5 0v4a.75.75 0 001.5 0v-4zm0 6.5a.75.75 0 00-1.5 0v.25a.75.75 0 001.5 0V13z"
            clip-rule="evenodd"
          />
        </svg>
        <span>{result.message}</span>
      </div>
    {/if}
  {/if}
</div>

<style>
  select {
    -webkit-appearance: none;
    -moz-appearance: none;
    appearance: none;
  }
</style>
