<script lang="ts">
  // Geport uit v1 src/lib/components/validated-fields/CarrierAccountNumberValidatedBlock.svelte.
  // Wijzigingen (widget-extractie):
  // - `import domain from "../../steps/domain.json"` (generated) vervangen door een
  //   `provider: WidgetProviderLayer`-prop; countryOptions komt uit provider.domain.countries.
  //   De validator-props (validator_account/validator_country) behouden v1's interface exact.
  // - SSR-veiligheid: v1's `const locale = navigator.language.split("-")[0]` verwijderd —
  //   de waarde werd nergens gebruikt en navigator bestaat niet bij server-side init.
  // - Strict-TS: validateField-params getypeerd (any) en e.target-casts toegevoegd;
  //   runtime-gedrag ongewijzigd. Let op (v1-quirk, bewust behouden): de postcode-input
  //   roept validateField aan met een STRING als validator — die validatie faalt stil
  //   (unhandled rejection), exact zoals in v1.
  import { onMount, tick } from "svelte";
  import { writable } from "svelte/store";
  import { fieldValidity } from "../../state/formValidation";
  import type { ShipmentTemplate, ValidationResult } from "../../types/config";
  import type { WidgetProviderLayer } from "../../providers/types";
  import { getCountryOptions } from "../../utils/countries";
  import { currentLang, m } from "../../state/messageStore";

  export let provider: WidgetProviderLayer;
  export let shipmentTemplate: ShipmentTemplate;
  export let validator_account: {
    dependsOn: (template: any) => any;
    validate: (fields: any) => ValidationResult | Promise<ValidationResult>;
  };
  export let validator_country: {
    dependsOn: (template: any) => any;
    validate: (fields: any) => ValidationResult | Promise<ValidationResult>;
  };

  const resultAccount = writable<ValidationResult>({
    valid: true,
    message: "",
  });
  const resultCountry = writable<ValidationResult>({
    valid: true,
    message: "",
  });

  const countryOptions = getCountryOptions(provider.domain.countries, currentLang.toLowerCase());

  let tokenA = 0;
  let tokenC = 0;

  $: show = getDeep(
    shipmentTemplate,
    "shipmentOptions.carrierAccountNumber.specifyCarrierAccountNumber",
  );

  function getDeep(obj: any, path: string): any {
    return path.split(".").reduce((o, k) => (o as any)?.[k], obj);
  }

  function setDeep(obj: any, path: string, value: any): void {
    const keys = path.split(".");
    const last = keys.pop();
    const target = keys.reduce((o, k) => ((o as any)[k] ??= {}), obj);
    if (last) (target as any)[last] = value;
  }

  function update(path: string, value: any) {
    setDeep(shipmentTemplate, path, value);
  }

  async function validateField(
    validator: any,
    resultStore: any,
    tokenRef: "A" | "C",
    key: string,
  ) {
    if (!validator) return;

    let currentToken: number;
    if (tokenRef === "A") {
      tokenA++;
      currentToken = tokenA;
    } else {
      tokenC++;
      currentToken = tokenC;
    }

    const deps = validator.dependsOn(shipmentTemplate);
    const validationResult = await validator.validate(deps);

    if (
      (tokenRef === "A" && tokenA === currentToken) ||
      (tokenRef === "C" && tokenC === currentToken)
    ) {
      resultStore.set(validationResult);
      fieldValidity.update((map) => ({
        ...map,
        [key]: validationResult.valid,
      }));
    }
  }

  onMount(() => {
    tick().then(() => {
      validateField(
        validator_account,
        resultAccount,
        "A",
        "shipmentOptions_carrierAccountNumber",
      );
      validateField(
        validator_country,
        resultCountry,
        "C",
        "shipmentOptions_carrierAccountNumber_carrierAccountNumberCountry",
      );
    });
  });
</script>

<div class="space-y-2">
  <!-- Checkbox toggle -->
  <label class="flex items-center gap-2 text-sm">
    <input
      type="checkbox"
      bind:checked={
        shipmentTemplate!.shipmentOptions!.carrierAccountNumber!
          .specifyCarrierAccountNumber
      }
      on:change={() => {
        if (
          !shipmentTemplate!.shipmentOptions!.carrierAccountNumber!
            .specifyCarrierAccountNumber
        ) {
          update(
            "shipmentOptions.carrierAccountNumber.carrierAccountNumber",
            "",
          );
          update(
            "shipmentOptions.carrierAccountNumber.carrierAccountNumberCountry",
            "",
          );
        }
      }}
      class="w-4 h-4 border-gray-300 rounded text-blue-600 focus:ring-blue-500"
    />
    {m.serviceSettingComponents.specifyYourOwnCarrierAccount}
  </label>

  {#if show}
    <!-- Carrier account number input -->
    <div class="relative">
      <input
        type="text"
        bind:value={
          shipmentTemplate!.shipmentOptions!.carrierAccountNumber!
            .carrierAccountNumber
        }
        on:input={(e) => {
          update(
            "shipmentOptions.carrierAccountNumber.carrierAccountNumber",
            (e.target as HTMLInputElement).value,
          );
          validateField(
            validator_account,
            resultAccount,
            "A",
            "carrierAccountNumber",
          );
        }}
        class="w-full px-3 py-2 text-sm rounded-md border bg-white transition-colors
          placeholder-gray-400 focus:outline-none
          {$resultAccount.valid
          ? 'border-gray-300 focus:border-blue-500'
          : 'border-red-500 focus:border-red-500'}"
        placeholder="Carrier account nummer"
      />
      {#if !$resultAccount.valid}
        <div
          class="absolute right-0 bottom-[-1.25rem] text-xs text-red-600 flex items-center space-x-1 pointer-events-none"
        >
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
          <span>{$resultAccount.message}</span>
        </div>
      {/if}
    </div>

    <!-- Country select -->
    <div class="relative">
      <select
        bind:value={
          shipmentTemplate!.shipmentOptions!.carrierAccountNumber!
            .carrierAccountNumberCountry
        }
        on:change={(e) => {
          update(
            "shipmentOptions.carrierAccountNumber.carrierAccountNumberCountry",
            (e.target as HTMLSelectElement).value,
          );
          validateField(
            validator_country,
            resultCountry,
            "C",
            "carrierAccountNumberCountry",
          );
        }}
        class="w-full text-sm px-3 border transition-colors bg-white appearance-none
          focus:outline-none cursor-pointer h-[2.5rem] leading-[1.25rem]
          {$resultCountry.valid
          ? 'border-gray-300 focus:border-blue-500'
          : 'border-red-500 focus:border-red-500'}"
        style="border-radius: 4px;"
      >
        <option value="" disabled hidden>{m.serviceSettingComponents.selectAccountNumberCountry}</option>
        {#each countryOptions as opt}
          <option value={opt.value}>{opt.label}</option>
        {/each}
      </select>
      {#if !$resultCountry.valid}
        <div
          class="absolute right-0 bottom-[-1.25rem] text-xs text-red-600 flex items-center space-x-1 pointer-events-none"
        >
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
          <span>{$resultCountry.message}</span>
        </div>
      {/if}
    </div>

    <!-- Postal code input -->
    <div>
      <label class="block text-sm text-gray-600 mb-1 mt-2"> {m.serviceSettingComponents.postalCode} </label>
      <input
        type="text"
        bind:value={
          shipmentTemplate!.shipmentOptions!.carrierAccountNumber!
            .carrierAccountNumberPostalCode
        }
        on:input={(e) => {
          update(
            "shipmentOptions.carrierAccountNumber.carrierAccountNumberPostalCode",
            (e.target as HTMLInputElement).value,
          );
          validateField(
            "shipmentOptions_carrierAccountNumber_carrierAccountNumberPostalCode",
            resultAccount, // or separate resultPostalCode store if needed
            "A", // or "P" if you distinguish this from others
            "carrierAccountNumberPostalCode",
          );
        }}
        class="w-full px-3 py-2 text-sm rounded-md border bg-white transition-colors
      placeholder-gray-400 focus:outline-none
      border-gray-300 focus:border-blue-500"
        placeholder="Account postcode"
      />
    </div>
  {/if}
</div>
