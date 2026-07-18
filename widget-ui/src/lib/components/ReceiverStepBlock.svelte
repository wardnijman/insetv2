<script lang="ts">
    // Geport uit v1 ReceiverStepBlock.svelte. Wijzigingen (widget-extractie):
    // - fieldValidators + domain uit de provider-PARAMETER (geen generated imports)
    // - apiBaseUrl uit tenant-config (api/global wordt bij boot gezet)
    // - adresboek-persist via de geporte updateUserConfig (fail-soft; backend volgt)
    // Verder 1-op-1: type-toggle, adresboek, PDOK-lookup, NL/non-NL-adresrijen.
    import { type Writable, derived, get, writable } from "svelte/store";
    import type { Address, ShipmentTemplate } from "../types/config";
    import type { WidgetProviderLayer } from "../providers/types";
    import ValidatedInput from "./inputs/ValidatedInput.svelte";
    import ValidatedSelect from "./selects/ValidatedSelect.svelte";
    import {
        countriesRequiringRegion,
        getCountryOptions,
    } from "../utils/countries";
    import { apiBaseUrl } from "../api/global";
    import { toast } from "./toast/toast";
    import { currentLang, m } from "../state/messageStore";
    import {
        userPreferences,
        setUserPreferences,
    } from "../state/userPreferences";
    import { updateUserConfig } from "../api/updateUserConfig";
    import SearchableSelect from "./inputs/SearchableSelect.svelte";
    import { clearFieldValidityKey } from "../state/formValidation";
    import StepSection from "./wizard/StepSection.svelte";
    import PasteAddressBox from "./PasteAddressBox.svelte";
    import { isNlPostcode, lookupNlAddress } from "../api/nlAddressLookup";

    export let shipment: Writable<ShipmentTemplate>;
    export let provider: WidgetProviderLayer;
    export let userId: string; // needed to persist receiverProfiles

    type ReceiverProfile = { label: string; address: Address };

    const countryOptions = getCountryOptions(
        provider.domain.countries,
        currentLang.toLowerCase(),
    );

    const mergedFieldValidators = provider.fieldValidators;

    const regionOptions: Writable<{ value: string; label: string }[]> =
        writable([]);
    let lastFetchedCountry = "";

    // ===== Address book (profiles) =====
    const receiverProfiles = writable<ReceiverProfile[]>(
        (userPreferences?.receiverProfiles as ReceiverProfile[]) ?? [],
    );

    const selectedProfileIndex = writable<number | null>(null);
    const profilesOptions = derived(receiverProfiles, ($p) =>
        $p.map((p, i) => ({ value: String(i), label: p.label })),
    );

    function cloneAddress(a: Address): Address {
        return {
            company: a.company ?? "",
            firstName: a.firstName ?? "",
            lastName: a.lastName ?? "",
            email: a.email ?? "",
            phoneNumber: (a as any).phoneNumber ?? "", // keep legacy key
            street: [...(a.street ?? ["", ""])],
            city: a.city ?? "",
            region: a.region ?? "",
            postalCode: a.postalCode ?? "",
            country: a.country ?? "",
            isPrivateIndividual: a.isPrivateIndividual,
        };
    }

    // ===== Recipient type (bedrijf / particulier) =====
    // Explicit flag wins; while unset (webshop orders, old profiles) it's deduced from
    // the company field, so the toggle tracks what the transform would send.
    $: recipientIsPrivate =
        $shipment.recipientAddress?.isPrivateIndividual ??
        !$shipment.recipientAddress?.company?.trim();

    function setRecipientType(isPrivateIndividual: boolean) {
        shipment.update((s) => ({
            ...s,
            recipientAddress: {
                ...s.recipientAddress!,
                isPrivateIndividual,
            },
        }));
    }

    function makeProfileLabel(addr: Address): string {
        const who =
            (addr.company && addr.company.trim()) ||
            [addr.firstName, addr.lastName].filter(Boolean).join(" ").trim() ||
            (addr.street?.[0] ?? "").trim();
        const pcCity = [addr.postalCode, addr.city].filter(Boolean).join(" ");
        const cc = (addr.country || "").toUpperCase();
        return [who, pcCity, cc].filter(Boolean).join(" • ");
    }

    // Selecting a profile applies it directly — no separate "Gebruik" click.
    function onProfileChosen(detail: string | null) {
        if (detail == null) {
            selectedProfileIndex.set(null);
            return;
        }
        const idx = Number(detail);
        selectedProfileIndex.set(idx);
        applyReceiverProfile(idx);
    }

    function applyReceiverProfile(idx: number) {
        const prof = get(receiverProfiles)[idx];
        if (!prof) return;

        const next = cloneAddress(prof.address);
        if (!Array.isArray(next.street)) next.street = ["", ""];
        if (next.street.length === 1) next.street.push("");

        shipment.update((s) => ({ ...s, recipientAddress: next })); // new reference
        toast.success("Adres geladen uit adresboek.");
    }

    async function persistProfiles(newProfiles: ReceiverProfile[]) {
        await updateUserConfig(
            "preferences.receiverProfiles",
            newProfiles,
            userId,
        );
        // keep in local singleton + local store
        setUserPreferences({
            ...(userPreferences ?? {}),
            receiverProfiles: newProfiles,
        });
        receiverProfiles.set(newProfiles);
    }

    async function deleteProfileAt(idx: number) {
        if (idx == null || Number.isNaN(idx) || idx < 0) return;

        const list = get(receiverProfiles);
        const target = list[idx];
        if (!target) return;

        if (
            !confirm(
                `Adresprofiel verwijderen:\n\n${target.label}\n\nWeet je het zeker?`,
            )
        )
            return;

        const next = [...list.slice(0, idx), ...list.slice(idx + 1)];
        await persistProfiles(next);

        // keep selection consistent after reindexing
        const cur = get(selectedProfileIndex);
        if (cur == null) {
            // no-op
        } else if (cur === idx) {
            selectedProfileIndex.set(null);
        } else if (cur > idx) {
            selectedProfileIndex.set(cur - 1);
        }

        toast.success("Adresprofiel verwijderd.");
    }

    async function saveCurrentAsNew() {
        const s = get(shipment).recipientAddress!;
        const profile: ReceiverProfile = {
            label: makeProfileLabel(s),
            address: cloneAddress(s),
        };
        const next = [...get(receiverProfiles), profile];
        await persistProfiles(next);
        toast.success("Adres opgeslagen in adresboek.");
    }

    async function overwriteSelected() {
        const idx = Number(get(selectedProfileIndex));
        if (Number.isNaN(idx) || idx < 0) return;
        const s = get(shipment).recipientAddress!;
        const next = [...get(receiverProfiles)];
        next[idx] = { label: makeProfileLabel(s), address: cloneAddress(s) };
        await persistProfiles(next);
        toast.success("Adresprofiel overschreven.");
    }

    // ===== Region show/fetch =====
    $: currentCountry = (
        $shipment.recipientAddress?.country || ""
    ).toUpperCase();
    $: showRegion = countriesRequiringRegion.has(currentCountry);
    $: if (
        showRegion &&
        currentCountry &&
        currentCountry !== lastFetchedCountry
    ) {
        lastFetchedCountry = currentCountry;
        fetchRegionOptions(currentCountry);
    }

    $: if (!showRegion) {
        clearFieldValidityKey("recipientAddress_region");
        regionOptions.set([]);
        lastFetchedCountry = "";
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
            console.error("❌ Region lookup failed", err);
            toast.error(m.serviceSettingComponents.couldNotLoadRegionOptions);
        }
    }

    // ===== NL postcode-lookup (PDOK) =====
    // In NL-modus voert de gebruiker postcode + huisnummer in; straat en plaats
    // worden opgehaald. street[0] blijft in het datamodel "straat + huisnummer"
    // (dat verwacht de transform), dus we componeren `${straat} ${huisnr}`.
    // De lookup vuurt alléén op echte toetsaanslagen in de postcode/huisnr-rij
    // (DOM-input bubbelt naar de rij-wrapper) — nooit op programmatische writes
    // zoals een adresboek-profiel of paste-parse, die al een compleet adres zetten.
    $: isNL = currentCountry === "NL";

    let houseNumber = "";
    let lookupState: "idle" | "loading" | "found" | "notfound" = "idle";
    let lookupTimer: ReturnType<typeof setTimeout> | undefined;
    let lookupSeq = 0;
    // Wat wij zelf naar street[0] schreven — extern gezette straten (profiel,
    // paste, prefill) herkennen we doordat ze hiervan afwijken; dan leiden we
    // het huisnummer opnieuw af zodat de lookup-rij klopt met wat er staat.
    let lastComposedStreet: string | null = null;

    $: street0Now = $shipment.recipientAddress?.street?.[0] ?? "";
    $: if (street0Now !== lastComposedStreet) {
        const mH = /^(.*?)[\s,]+(\d+[a-zA-Z0-9\-\/]*)\s*$/.exec(street0Now);
        if (mH) houseNumber = mH[2];
        lastComposedStreet = null;
    }

    function onNlRowInput() {
        if (lookupTimer) clearTimeout(lookupTimer);
        // Waarden pas op fire-moment lezen — bind-propagatie kan een toetsaanslag
        // achterlopen op het bubbelende input-event.
        lookupTimer = setTimeout(() => {
            const pc = get(shipment).recipientAddress?.postalCode ?? "";
            const hnr = houseNumber;
            if (!isNlPostcode(pc) || !hnr.trim()) {
                lookupState = "idle";
                return;
            }
            void runNlLookup(pc, hnr);
        }, 400);
    }

    async function runNlLookup(pc: string, hnr: string) {
        const seq = ++lookupSeq;
        lookupState = "loading";
        try {
            const hit = await lookupNlAddress(pc, hnr);
            if (seq !== lookupSeq) return;
            if (!hit) {
                lookupState = "notfound";
                return;
            }
            const composed = `${hit.street} ${hnr.trim()}`;
            lastComposedStreet = composed;
            shipment.update((s) => ({
                ...s,
                recipientAddress: {
                    ...s.recipientAddress!,
                    street: [composed, s.recipientAddress!.street?.[1] ?? ""],
                    city: hit.city,
                },
            }));
            lookupState = "found";
        } catch {
            // Netwerk-/API-fout → stil terugvallen op handmatig invullen.
            if (seq === lookupSeq) lookupState = "notfound";
        }
    }
</script>

<div class="w-full max-w-[920px] mx-auto text-sm text-gray-800">
    <!-- Quick fill: paste-to-fill + address book on one line -->
    <div class="mb-5 flex flex-col gap-2.5 md:flex-row md:items-center">
        <div class="flex-1">
            <PasteAddressBox {shipment} {provider} {userId} />
        </div>
        <SearchableSelect
            {m}
            options={$profilesOptions}
            selected={$selectedProfileIndex !== null
                ? String($selectedProfileIndex)
                : null}
            placeholder={m.shipmentWizard.receiverStep.addressBook}
            widthClass="w-full md:w-[250px]"
            showDelete={true}
            on:change={(e) => onProfileChosen(e.detail)}
            on:delete={(e) => deleteProfileAt(Number(e.detail))}
        />
    </div>

    <StepSection label={m.shipmentWizard.receiverStep.receiverStepLabel}>
        <svelte:fragment slot="actions">
            <button
                type="button"
                class="text-xs text-gray-500 hover:text-gray-800 underline decoration-dotted"
                on:click={saveCurrentAsNew}
            >
                {m.shipmentWizard.receiverStep.saveAsNew}
            </button>
            <button
                type="button"
                class="text-xs text-gray-500 hover:text-gray-800 underline decoration-dotted disabled:opacity-40"
                disabled={$selectedProfileIndex === null}
                on:click={overwriteSelected}
            >
                {m.shipmentWizard.receiverStep.writeOver}
            </button>
        </svelte:fragment>

        <!-- Toggle en bedrijfsnaam op één rij. items-START + spooklabel houdt de
             toggle top-verankerd; de vaste rijhoogte (= hoogte mét veld, gemeten)
             zorgt dat óók alles ónder de rij stilstaat bij het wisselen — de
             veldcel is door line-box-afronding ~2px hoger dan de toggle-cel. -->
        <div class="grid gap-x-5 gap-y-5 md:grid-cols-2 items-start md:h-[60px]">
            <div>
                <span class="mb-1 block text-xs select-none" aria-hidden="true"
                    >&nbsp;</span
                >
                <div
                    class="seg"
                    role="group"
                    aria-label={m.shipmentWizard.receiverStep.recipientTypeLabel}
                >
                    <button
                        type="button"
                        class:on={!recipientIsPrivate}
                        on:click={() => setRecipientType(false)}
                    >
                        {m.shipmentWizard.receiverStep.recipientTypeCompany}
                    </button>
                    <button
                        type="button"
                        class:on={recipientIsPrivate}
                        on:click={() => setRecipientType(true)}
                    >
                        {m.shipmentWizard.receiverStep.recipientTypePrivate}
                    </button>
                </div>
            </div>
            {#if !recipientIsPrivate}
                <div>
                    <label class="mb-1 block text-xs text-gray-500"
                        >{m.shipmentWizard.receiverStep.companyNameRequiredLabel ??
                            "Bedrijfsnaam"}</label
                    >
                    <ValidatedInput
                        name="recipientAddress_company"
                        bind:value={$shipment.recipientAddress!.company}
                        shipmentTemplate={$shipment}
                        validator={mergedFieldValidators[
                            "recipientAddress_company"
                        ]}
                    />
                </div>
            {/if}
        </div>

        <div class="grid gap-x-5 gap-y-5 md:grid-cols-2">
            <div>
                <label class="mb-1 block text-xs text-gray-500"
                    >{m.shipmentWizard.receiverStep.firstNameLabel}</label
                >
                <ValidatedInput
                    name="recipientAddress_firstName"
                    bind:value={$shipment.recipientAddress!.firstName}
                    shipmentTemplate={$shipment}
                    validator={mergedFieldValidators[
                        "recipientAddress_firstName"
                    ]}
                />
            </div>
            <div class="fld">
                <label class="mb-1 block text-xs text-gray-500"
                    >{m.shipmentWizard.receiverStep.lastNameLabel}</label
                >
                <ValidatedInput
                    name="recipientAddress_lastName"
                    bind:value={$shipment.recipientAddress!.lastName}
                    shipmentTemplate={$shipment}
                    validator={mergedFieldValidators[
                        "recipientAddress_lastName"
                    ]}
                />
                <p class="fld-hint">
                    {m.shipmentWizard.receiverStep.nameLimitHint ??
                        "Voor- en achternaam samen max. 30 tekens (limiet vervoerder)"}
                </p>
            </div>
        </div>
    </StepSection>

    <StepSection
        label={m.shipmentWizard.receiverStep.addressGroupLabel ?? "Adres"}
    >
        <svelte:fragment slot="actions">
            {#if isNL && lookupState !== "idle"}
                <span
                    class="text-xs whitespace-nowrap {lookupState === 'found'
                        ? 'text-emerald-600'
                        : 'text-gray-400'}"
                >
                    {#if lookupState === "loading"}
                        {m.shipmentWizard.receiverStep.lookupSearching ?? "Adres zoeken…"}
                    {:else if lookupState === "found"}
                        {m.shipmentWizard.receiverStep.lookupFound ?? "✓ Adres automatisch opgehaald"}
                    {:else}
                        {m.shipmentWizard.receiverStep.lookupNotFound ?? "Niet gevonden — vul straat en plaats zelf in"}
                    {/if}
                </span>
            {/if}
        </svelte:fragment>

        {#if isNL}
            <!-- NL: postcode + huisnummer zijn leidend; straat en plaats worden
                 via PDOK opgehaald (en blijven gewoon corrigeerbaar). De
                 on:input op de rij vangt alleen echte toetsaanslagen. -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
                class="grid gap-x-5 gap-y-5 md:grid-cols-[1.3fr_1fr_0.8fr_0.8fr]"
                on:input={onNlRowInput}
            >
                <div>
                    <label class="mb-1 block text-xs text-gray-500"
                        >{m.shipmentWizard.receiverStep.countryLabel}</label
                    >
                    <ValidatedSelect
                        name="recipientAddress_country"
                        bind:value={$shipment.recipientAddress!.country}
                        shipmentTemplate={$shipment}
                        validator={mergedFieldValidators[
                            "recipientAddress_country"
                        ]}
                        options={countryOptions}
                    />
                </div>
                <div>
                    <label class="mb-1 block text-xs text-gray-500"
                        >{m.shipmentWizard.receiverStep.postalCodeLabel}</label
                    >
                    <ValidatedInput
                        name="recipientAddress_postalCode"
                        bind:value={$shipment.recipientAddress!.postalCode}
                        shipmentTemplate={$shipment}
                        validator={mergedFieldValidators[
                            "recipientAddress_postalCode"
                        ]}
                    />
                </div>
                <div>
                    <label class="mb-1 block text-xs text-gray-500"
                        >{m.shipmentWizard.receiverStep.houseNumberLabel ?? "Huisnummer"}</label
                    >
                    <input
                        bind:value={houseNumber}
                        name="recipientAddress_houseNumber"
                        type="text"
                        class="block w-full px-3 py-2 text-sm rounded-md border bg-white transition-colors placeholder-gray-400 focus:outline-none border-gray-300 focus:border-blue-500"
                    />
                </div>
                <div>
                    <label class="mb-1 block text-xs text-gray-500"
                        >{m.shipmentWizard.receiverStep.additionAndExtraLabel}</label
                    >
                    <ValidatedInput
                        name="recipientAddress_street_1_"
                        bind:value={$shipment.recipientAddress!.street[1]}
                        shipmentTemplate={$shipment}
                        validator={mergedFieldValidators[
                            "recipientAddress_street_1_"
                        ]}
                    />
                </div>
            </div>

            <div class="grid gap-x-5 gap-y-5 md:grid-cols-2">
                <div>
                    <label class="mb-1 block text-xs text-gray-500"
                        >{m.shipmentWizard.receiverStep.streetAndNumberLabel}</label
                    >
                    <ValidatedInput
                        name="recipientAddress_street_0_"
                        bind:value={$shipment.recipientAddress!.street[0]}
                        shipmentTemplate={$shipment}
                        validator={mergedFieldValidators[
                            "recipientAddress_street_0_"
                        ]}
                    />
                </div>
                <div>
                    <label class="mb-1 block text-xs text-gray-500"
                        >{m.shipmentWizard.receiverStep.placeLabel}</label
                    >
                    <ValidatedInput
                        name="recipientAddress_city"
                        bind:value={$shipment.recipientAddress!.city}
                        shipmentTemplate={$shipment}
                        validator={mergedFieldValidators["recipientAddress_city"]}
                    />
                </div>
            </div>
        {:else}
            <div class="grid gap-x-5 gap-y-5 md:grid-cols-2">
                <div>
                    <label class="mb-1 block text-xs text-gray-500"
                        >{m.shipmentWizard.receiverStep.countryLabel}</label
                    >
                    <ValidatedSelect
                        name="recipientAddress_country"
                        bind:value={$shipment.recipientAddress!.country}
                        shipmentTemplate={$shipment}
                        validator={mergedFieldValidators[
                            "recipientAddress_country"
                        ]}
                        options={countryOptions}
                    />
                </div>
                {#if showRegion}
                    <div>
                        <label class="mb-1 block text-xs text-gray-500"
                            >{m.shipmentWizard.receiverStep.regionLabel}</label
                        >
                        <ValidatedSelect
                            name="recipientAddress_region"
                            bind:value={$shipment.recipientAddress!.region}
                            shipmentTemplate={$shipment}
                            validator={mergedFieldValidators[
                                "recipientAddress_region"
                            ]}
                            options={$regionOptions}
                        />
                    </div>
                {/if}
            </div>

            <div class="grid gap-x-5 gap-y-5 md:grid-cols-2">
                <div>
                    <label class="mb-1 block text-xs text-gray-500"
                        >{m.shipmentWizard.receiverStep.streetAndNumberLabel}</label
                    >
                    <ValidatedInput
                        name="recipientAddress_street_0_"
                        bind:value={$shipment.recipientAddress!.street[0]}
                        shipmentTemplate={$shipment}
                        validator={mergedFieldValidators[
                            "recipientAddress_street_0_"
                        ]}
                    />
                </div>
                <div>
                    <label class="mb-1 block text-xs text-gray-500"
                        >{m.shipmentWizard.receiverStep.additionAndExtraLabel}</label
                    >
                    <ValidatedInput
                        name="recipientAddress_street_1_"
                        bind:value={$shipment.recipientAddress!.street[1]}
                        shipmentTemplate={$shipment}
                        validator={mergedFieldValidators[
                            "recipientAddress_street_1_"
                        ]}
                    />
                </div>
            </div>

            <div class="grid gap-x-5 gap-y-5 md:grid-cols-2">
                <div>
                    <label class="mb-1 block text-xs text-gray-500"
                        >{m.shipmentWizard.receiverStep.postalCodeLabel}</label
                    >
                    <ValidatedInput
                        name="recipientAddress_postalCode"
                        bind:value={$shipment.recipientAddress!.postalCode}
                        shipmentTemplate={$shipment}
                        validator={mergedFieldValidators[
                            "recipientAddress_postalCode"
                        ]}
                    />
                </div>
                <div>
                    <label class="mb-1 block text-xs text-gray-500"
                        >{m.shipmentWizard.receiverStep.placeLabel}</label
                    >
                    <ValidatedInput
                        name="recipientAddress_city"
                        bind:value={$shipment.recipientAddress!.city}
                        shipmentTemplate={$shipment}
                        validator={mergedFieldValidators["recipientAddress_city"]}
                    />
                </div>
            </div>
        {/if}
    </StepSection>

    <StepSection
        label={m.shipmentWizard.receiverStep.contactGroupLabel ?? "Contact"}
    >
        <div class="grid gap-x-5 gap-y-5 md:grid-cols-2">
            <div class="fld">
                <label class="mb-1 block text-xs text-gray-500"
                    >{m.shipmentWizard.receiverStep.phoneNumberLabel}</label
                >
                <ValidatedInput
                    name="recipientAddress_phoneNumber"
                    bind:value={$shipment.recipientAddress!.phoneNumber}
                    shipmentTemplate={$shipment}
                    validator={mergedFieldValidators[
                        "recipientAddress_phoneNumber"
                    ]}
                />
                <p class="fld-hint">
                    {m.shipmentWizard.receiverStep.phoneHint ??
                        "Gebruikt de vervoerder bij bezorging"}
                </p>
            </div>
            <div>
                <label class="mb-1 block text-xs text-gray-500"
                    >{m.shipmentWizard.receiverStep.emailOptionalLabel ??
                        m.shipmentWizard.receiverStep.emailLabel}</label
                >
                <ValidatedInput
                    name="recipientAddress_email"
                    bind:value={$shipment.recipientAddress!.email}
                    shipmentTemplate={$shipment}
                    validator={mergedFieldValidators["recipientAddress_email"]}
                />
            </div>
        </div>
    </StepSection>
</div>

<style>
    /* Segmented Bedrijf/Particulier control — scoped so host CSS can't touch it.
       Vaste hoogte = exact de ValidatedInput-hoogte (38px), zodat de rij met de
       bedrijfsnaam ernaast in beide toggle-standen even hoog is (geen verspringen). */
    .seg {
        display: inline-flex;
        align-items: center;
        height: 38px;
        background: #f3f4f6;
        border-radius: 9px;
        padding: 3px;
    }

    .seg button {
        border: 0;
        background: transparent;
        padding: 6px 18px;
        border-radius: 7px;
        font-family: inherit;
        font-size: 13px;
        font-weight: 500;
        color: #6b7280;
        cursor: pointer;
        transition:
            background 0.15s ease,
            color 0.15s ease;
    }

    .seg button.on {
        background: #ffffff;
        color: #1f2937;
        box-shadow: 0 1px 2px rgba(16, 24, 40, 0.1);
    }

    /* Field hints only show while the field has focus — useful the first week,
       noise for a daily operator afterwards. Absoluut gepositioneerd zodat het
       tonen/verbergen de layout (en dus de Verder-knop) niet verschuift. */
    .fld {
        position: relative;
    }

    .fld-hint {
        display: none;
        position: absolute;
        top: 100%;
        left: 0;
        margin: 2px 0 0;
        font-size: 11.5px;
        color: #9ca3af;
        white-space: nowrap;
    }

    .fld:focus-within .fld-hint {
        display: block;
    }

    @media (prefers-reduced-motion: reduce) {
        .seg button {
            transition: none;
        }
    }
</style>
