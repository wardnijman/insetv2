<script lang="ts">
    // Geport uit v1 SenderStepBlock.svelte. Wijzigingen (widget-extractie):
    // - fieldValidators + domain komen uit de provider-PARAMETER (WidgetProviderLayer)
    //   i.p.v. de hardcoded generated imports (steps/getRatesValidate, steps/domain.json).
    // - apiBaseUrl komt uit api/global, dat bij boot uit de tenant host-config gezet wordt.
    import type { ShipmentTemplate } from "../types/config";
    import type { WidgetProviderLayer } from "../providers/types";
    import ValidatedInput from "./inputs/ValidatedInput.svelte";
    import InputWithRecall from "./inputs/InputWithRecall.svelte";
    import {
        countriesRequiringRegion,
        getCountryOptions,
    } from "../utils/countries";
    import ValidatedSelect from "./selects/ValidatedSelect.svelte";
    import { persistentFieldValidators } from "../validations/field-validators";
    import type { Writable } from "svelte/store";
    import { writable } from "svelte/store";
    import { currentLang, m } from "../state/messageStore";
    import { apiBaseUrl } from "../api/global";
    import { toast } from "./toast/toast";
    import StepSection from "./wizard/StepSection.svelte";

    export let provider: WidgetProviderLayer;
    export let shipment: Writable<ShipmentTemplate>;
    export let userId: string = "";

    const countryOptions = getCountryOptions(
        provider.domain.countries,
        currentLang.toLowerCase(),
    );

    // v1-merge-volgorde (SenderStepBlock): persistent WINT van generated.
    const mergedFieldValidators = {
        ...provider.fieldValidators,
        ...persistentFieldValidators,
    };

    const regionOptions: Writable<{ value: string; label: string }[]> =
        writable([]);
    let lastFetchedCountry = "";

    $: currentCountry = ($shipment.shipperAddress?.country || "").toUpperCase();
    $: showRegion = countriesRequiringRegion.has(currentCountry);
    $: if (
        showRegion &&
        currentCountry &&
        currentCountry !== lastFetchedCountry
    ) {
        lastFetchedCountry = currentCountry;
        fetchRegionOptions(currentCountry);
    }

    function resetShipperFields() {
        shipment.update((s) => {
            s.shipperAddress = {
                company: "",
                firstName: "",
                lastName: "",
                email: "",
                street: ["", ""],
                postalCode: "",
                city: "",
                country: "",
                phoneNumber: "",
                region: "",
            };
            return s;
        });
    }

    async function fetchRegionOptions(country: string) {
        try {
            const res = await fetch(
                `${apiBaseUrl}/api/domain/country-and-region?country=${encodeURIComponent(country)}`,
                { credentials: "include" },
            );
            const result = await res.json();
            regionOptions.set(
                result.sort((a: any, b: any) => a.label.localeCompare(b.label)),
            );
        } catch (err) {
            // TODO(toast-port): v1 meldt dit via toast.error; toast-systeem volgt met de modal-slice.
            console.warn("❌ Region lookup failed", err);
        }
    }
</script>

<!-- Compact: de verzendersstap moet mét footer op een MacBook-scherm (100% zoom)
     passen. Daarom naam-velden naast het preset-veld en het adres in twee rijen
     i.p.v. losse rijen per veldpaar. -->
<div class="w-full max-w-[920px] mx-auto text-sm text-gray-800">
    <StepSection label={m.shipmentWizard.senderStep.senderStepLabel}>
        <div class="grid gap-x-5 gap-y-5 md:grid-cols-[1.2fr_1fr_1fr]">
            <div>
                <InputWithRecall
                    {userId}
                    label={m.shipmentWizard.senderStep.companyLabel}
                    typeKey="shipperAddress"
                    name="shipperAddress_company"
                    bind:bindValue={$shipment.shipperAddress!.company}
                    bindObject={$shipment.shipperAddress}
                    onReset={resetShipperFields}
                    emptyTemplate={{
                        company: "",
                        firstName: "",
                        lastName: "",
                        email: "",
                        street: ["", ""],
                        postalCode: "",
                        city: "",
                        region: "",
                        country: "",
                        phoneNumber: "",
                    }}
                />
            </div>
            <div>
                <label class="mb-1 block text-xs text-gray-500"
                    >{m.shipmentWizard.senderStep.firstNameLabel}</label
                >
                <ValidatedInput
                    name="shipperAddress_firstName"
                    bind:value={$shipment.shipperAddress!.firstName}
                    shipmentTemplate={$shipment}
                    validator={mergedFieldValidators["shipperAddress_firstName"]}
                />
            </div>
            <div>
                <label class="mb-1 block text-xs text-gray-500"
                    >{m.shipmentWizard.senderStep.lastNameLabel}</label
                >
                <ValidatedInput
                    name="shipperAddress_lastName"
                    bind:value={$shipment.shipperAddress!.lastName}
                    shipmentTemplate={$shipment}
                    validator={mergedFieldValidators["shipperAddress_lastName"]}
                />
            </div>
        </div>
    </StepSection>

    <StepSection
        label={m.shipmentWizard.receiverStep.addressGroupLabel ?? "Adres"}
    >
        <div class="grid gap-x-5 gap-y-5 md:grid-cols-[1fr_1.4fr_0.8fr]">
            <div>
                <label class="mb-1 block text-xs text-gray-500"
                    >{m.shipmentWizard.senderStep.countryLabel}</label
                >
                <ValidatedSelect
                    name="shipperAddress_country"
                    bind:value={$shipment.shipperAddress!.country}
                    shipmentTemplate={$shipment}
                    validator={mergedFieldValidators["shipperAddress_country"]}
                    options={countryOptions}
                />
            </div>
            <div>
                <label class="mb-1 block text-xs text-gray-500"
                    >{m.shipmentWizard.senderStep.streetLabel}</label
                >
                <ValidatedInput
                    name="shipperAddress_street_0_"
                    bind:value={$shipment.shipperAddress!.street[0]}
                    shipmentTemplate={$shipment}
                    validator={mergedFieldValidators["shipperAddress_street_0_"]}
                />
            </div>
            <div>
                <label class="mb-1 block text-xs text-gray-500"
                    >{m.shipmentWizard.senderStep.additionLabel}</label
                >
                <ValidatedInput
                    name="shipperAddress_street_1_"
                    bind:value={$shipment.shipperAddress!.street[1]}
                    shipmentTemplate={$shipment}
                    validator={mergedFieldValidators["shipperAddress_street_1_"]}
                />
            </div>
        </div>

        <div
            class={`grid gap-x-5 gap-y-5 ${showRegion ? "md:grid-cols-3" : "md:grid-cols-2"}`}
        >
            <div>
                <label class="mb-1 block text-xs text-gray-500"
                    >{m.shipmentWizard.senderStep.postalCodeLabel}</label
                >
                <ValidatedInput
                    name="shipperAddress_postalCode"
                    bind:value={$shipment.shipperAddress!.postalCode}
                    shipmentTemplate={$shipment}
                    validator={mergedFieldValidators["shipperAddress_postalCode"]}
                />
            </div>
            <div>
                <label class="mb-1 block text-xs text-gray-500"
                    >{m.shipmentWizard.senderStep.placeLabel}</label
                >
                <ValidatedInput
                    name="shipperAddress_city"
                    bind:value={$shipment.shipperAddress!.city}
                    shipmentTemplate={$shipment}
                    validator={mergedFieldValidators["shipperAddress_city"]}
                />
            </div>
            {#if showRegion}
                <div>
                    <label class="mb-1 block text-xs text-gray-500"
                        >{m.shipmentWizard.receiverStep.regionLabel}</label
                    >
                    <ValidatedSelect
                        name="shipperAddress_region"
                        bind:value={$shipment.shipperAddress!.region}
                        shipmentTemplate={$shipment}
                        validator={mergedFieldValidators["shipperAddress_region"]}
                        options={$regionOptions}
                    />
                </div>
            {/if}
        </div>
    </StepSection>

    <StepSection
        label={m.shipmentWizard.receiverStep.contactGroupLabel ?? "Contact"}
    >
        <div class="grid gap-x-5 gap-y-5 md:grid-cols-2">
            <div>
                <label class="mb-1 block text-xs text-gray-500"
                    >{m.shipmentWizard.senderStep.telephoneLabel}</label
                >
                <ValidatedInput
                    name="shipperAddress_phoneNumber"
                    bind:value={$shipment.shipperAddress!.phoneNumber}
                    shipmentTemplate={$shipment}
                    validator={mergedFieldValidators["shipperAddress_phoneNumber"]}
                />
            </div>
            <div>
                <label class="mb-1 block text-xs text-gray-500"
                    >{m.shipmentWizard.senderStep.emailLabel}</label
                >
                <ValidatedInput
                    name="shipperAddress_email"
                    bind:value={$shipment.shipperAddress!.email}
                    shipmentTemplate={$shipment}
                    validator={mergedFieldValidators["shipperAddress_email"]}
                />
            </div>
        </div>
    </StepSection>
</div>
