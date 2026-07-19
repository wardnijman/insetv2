<script lang="ts">
  // Geport uit v1 src/lib/components/validated-fields/AccessPointSelector.svelte.
  // Wijzigingen: geen — verbatim port. Dit component doet ZELF geen netwerk-calls:
  // de accessPoints worden upstream door chooseOption op shipmentOptions.chosenRate
  // gepatcht (v2: de `${apiBaseUrl}`/api/service-points-route, die nu leeg retourneert —
  // dan valt dit component netjes terug op het bestaande "geen access points"-pad).
  import { onMount, tick } from "svelte";
  import { writable } from "svelte/store";
  import type { ShipmentTemplate, ValidationResult } from "../../types/config";
  import { fieldValidity } from "../../state/formValidation";
  import { m } from "../../state/messageStore";

  export let shipmentTemplate: ShipmentTemplate;
  export let validator: {
    dependsOn: (template: any) => any;
    validate: (fields: any) => ValidationResult | Promise<ValidationResult>;
  };

  const result = writable<ValidationResult>({ valid: true, message: "" });
  let validationToken = 0;

  $: accessPoints =
    shipmentTemplate?.shipmentOptions?.chosenRate?.accessPoints ?? [];

  // The access points list is populated by chooseOption (it patches them onto the shipment
  // template). While chooseOption is still in flight, keep showing the spinner — there used
  // to be a 10s wall-clock timeout here that would give up early, but chooseOption can take
  // longer than that on TFF, and dropping the spinner before chooseOption finishes left the
  // user staring at "geen afhaalpunten" while the Verzenden button stayed disabled (because
  // the sessionKey hadn't arrived yet either). Just wait for chooseOption to decide.
  $: chooseOptionLoading = !!(shipmentTemplate?.shipmentOptions as any)?.__chooseOptionLoading;
  $: chooseOptionError = String(
    (shipmentTemplate?.shipmentOptions as any)?.__chooseOptionError ?? "",
  ).trim();
  $: loading = chooseOptionLoading && accessPoints.length === 0;

function updateChosenAccessPoint(id: string | null) {
  for (const ap of accessPoints) {
    ap.chosen = ap.id === id;
  }
  // Force reactivity
  shipmentTemplate = {
    ...shipmentTemplate,
    shipmentOptions: {
      ...shipmentTemplate.shipmentOptions!,
      chosenRate: {
        ...shipmentTemplate.shipmentOptions!.chosenRate!,
        accessPoints: [...accessPoints],
      },
    },
  };

  validateNow();
}

  async function validateNow() {
    if (!validator) return;

    const currentToken = ++validationToken;
    const deps = validator.dependsOn(shipmentTemplate);
    const validationResult = await validator.validate(deps);

    if (validationToken === currentToken) {
      result.set(validationResult);
      fieldValidity.update((map) => ({
        ...map,
        shipmentOptions_chosenRate_accessPoints: validationResult.valid,
      }));
    }
  }

  onMount(() => {
    tick().then(validateNow);
  });
</script>

{#if loading}
  <div
    class="flex flex-col items-center justify-center text-center py-16 px-6 text-gray-700"
  >
    <div
      class="mb-6 w-8 h-8 border-t-[3px] border-r-[3px] border-solid border-transparent border-t-black/50 rounded-full"
      style="animation: spin-linear 0.8s linear infinite;"
    ></div>
    <style>
      @keyframes spin-linear {
        from {
          transform: rotate(0deg);
        }
        to {
          transform: rotate(360deg);
        }
      }
    </style>
  </div>
{:else if accessPoints.length > 0}
  <div class="space-y-2">
    <!-- Default unselected option -->
    <div
      class="flex items-center justify-between border rounded-lg px-4 py-3 text-sm cursor-pointer bg-white hover:bg-gray-50 transition"
      class:border-blue-500={!accessPoints.some((ap) => ap.chosen)}
      class:border-gray-300={accessPoints.some((ap) => ap.chosen)}
      on:click={() => updateChosenAccessPoint(null)}
    >
      <span class="text-sm font-medium">{m.serviceSettingComponents.noAccessPointsSelected}</span>
      <input
        type="radio"
        name="accessPoint"
        checked={!accessPoints.some((ap) => ap.chosen)}
        class="form-radio text-blue-600 pointer-events-none"
      />
    </div>

    <!-- Real access points -->
    {#each accessPoints as ap (ap.id)}
      <div
        class="flex items-center justify-between border rounded-lg px-4 py-3 text-sm cursor-pointer bg-white hover:bg-gray-50 transition"
        class:border-blue-500={ap.chosen}
        class:border-gray-300={!ap.chosen}
        on:click={() => updateChosenAccessPoint(ap.id)}
      >
        <div class="space-y-0.5">
          <div class="font-semibold">{ap.name}</div>
          <div>{ap.address}</div>
          <div>{ap.postalCode} {ap.city}</div>
        </div>
        <input
          type="radio"
          name="accessPoint"
          checked={ap.chosen}
          class="form-radio text-blue-600 pointer-events-none"
        />
      </div>
    {/each}

    {#if !$result.valid}
      <div class="text-xs text-red-600 mt-1 flex items-center space-x-1">
        <svg
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
        <span>{$result.message}</span>
      </div>
    {/if}
  </div>
{:else if chooseOptionError}
  <div class="text-sm text-red-600">{chooseOptionError}</div>
{:else}
  <div class="text-sm text-gray-500 italic">{m.serviceSettingComponents.noAccessPointsAvailable}</div>
{/if}
