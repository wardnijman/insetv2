<script lang="ts">
    // Wizard-shell: v1-getrouwe CHROME (port van plugship-client-widget
    // ShipWizardModal.svelte — sinds 2026-07-17 het inline paneel, geen overlay)
    // op de v2-BEDRADING (engine uit src/widget/engine, proxy-first transport,
    // provider-laag i.p.v. generated steps/-imports).
    //
    // Overgenomen uit v1 (markup/styles/NL-teksten verbatim waar mogelijk):
    // - Eén headerbalk (Wise-patroon): ordercontext links, stepper midden,
    //   Hulp + Annuleren rechts; body met min-h; footer Vorige/Overslaan/Verder-Verzend.
    // - Enter-navigatie (defaultPrevented-events overslaan — PasteAddressBox rekent daarop).
    // - Verder-gating: sectie-gescoopte fieldValidity (isCurrentStepValid), knop altijd
    //   klikbaar, invalid → revealStepErrors (showAllErrors + scroll/focus eerste fout).
    // - Error-reset + focus-comfort bij ECHTE stapwissel (lastErrResetStepId-guard).
    // - "Overslaan" op de douanestap (rates bekijken vóór de factuur; submit blijft
    //   gegate in ShipStepBlock via invoiceReadyFor/productsHaveLineItems).
    // - Escape → sluiten; sluiten is hier een "close"-EVENT (de host-adapter regelt
    //   tonen/verbergen — geen host-DOM-manipulatie in de shell).
    //
    // Bewust NIET geport (v1-lagen die op de order-queue/app leunen):
    // - TODO(order-flow): queueInBackground/attemptBackgroundShip/headlessShip,
    //   shouldOfferAutoShip, redoAllSteps/forceManual/forceInlineRates/batchLabel,
    //   startStep/initialShipment — komen met de OrderOverview-slice.
    // - TODO(order-flow): draft-persistentie (state/shipDraft + state/shipEdits) —
    //   die modules zijn nog niet geport.
    // - reveal-per-field: v1's revealField/resetRevealedFields (gerichte foutonthulling
    //   op het veld waar we naartoe focussen) is geport — revealedFields-store in
    //   formValidation, gebruikt door ValidatedInput/ValidatedSelect.
    // - v1's <head>-Google-font-link (Material Symbols): niets in v2 gebruikt die font.
    import { onMount, onDestroy, tick, createEventDispatcher } from "svelte";
    import { writable, get } from "svelte/store";
    import type { TenantConfig } from "../../../src/widget/tenant.ts";
    import type { WizardStep } from "../../../src/widget/engine/types.ts";
    import { buildSteps } from "../../../src/widget/engine/build-steps.ts";
    import { buildVisibleSteps, advance } from "../../../src/widget/engine/engine.ts";
    import type { WidgetProviderLayer } from "./providers/types";
    import type { ShipmentTemplate } from "./types/config";
    import {
        fieldValidity,
        resetFieldValidity,
        showAllErrors,
        revealField,
        resetRevealedFields,
    } from "./state/formValidation";
    import { m } from "./state/messageStore";
    import { userPreferences } from "./state/userPreferences";
    import { canonicalShippingCountry } from "./utils/countries";
    import { WIZARD_STEP_TOPICS } from "./help/helpTopics";
    import { openHelp } from "./help/helpDrawer";
    import ShipWizardProgress from "./components/ShipWizardProgress.svelte";
    import SenderStepBlock from "./components/SenderStepBlock.svelte";
    import ReceiverStepBlock from "./components/ReceiverStepBlock.svelte";
    import PackageTableStepBlock from "./components/PackageTableStepBlock.svelte";
    import ProductStepBlock from "./components/ProductStepBlock.svelte";
    import ShipStepBlock from "./components/ShipStepBlock.svelte";
    import HelpDrawer from "./components/HelpDrawer.svelte";
    import { autoFetchRates } from "./api/rateFetcher";
    import { submitShipmentByType } from "./api/submitShipment";
    import { toast } from "./components/toast/toast";
    import ToastDisplay from "./components/toast/ToastDisplay.svelte";

    export let tenant: TenantConfig;
    export let provider: WidgetProviderLayer;
    /** Interim: v2-tenancy koppelt dit aan het boekaccount; dev-harness geeft tenant.id door. */
    export let userId: string = "";
    /** Webshop-order-context — bij ons optioneel/null (standalone). De OrderOverview-laag
     *  komt in een volgende slice; alle order-gebruik is geguard. TODO(order-flow) */
    export let order: any = null;
    /** Auth-token voor deep links (ShipStepBlock's "Lang wachten?"-hint). Optioneel. */
    export let token: string = "";

    const dispatch = createEventDispatcher<{
        /** Annuleren-knop of Escape — de host-adapter regelt tonen/verbergen. */
        close: void;
        /** Geslaagde boeking; detail-vorm als v1's onSuccess. */
        success: { order: any; detail: any };
        /** Mislukte boeking; vorm als v1's onShipmentError(reason, shipment, order). */
        shipmenterror: { reason: string; shipment: ShipmentTemplate; order: any };
    }>();

    const emptyAddress = () => ({
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
    });

    // Shipment-seed als v1's modal (volledige shipmentOptions-defaults zodat de hidden
    // ValidatedInputs/persistentFieldValidators een doel hebben), maar tenant-gedreven:
    // v1 hardcodeerde "NL"-origin, hier tenant.defaults. Order-prefill geguard op order.
    export const shipment = writable<ShipmentTemplate>({
        carrier: "",
        source: order?.orderPlatform?.toLowerCase?.() ?? "manual",
        packages: [],
        products: [],
        shipperAddress: {
            ...emptyAddress(),
            country: tenant.defaults?.originCountry ?? "",
        },
        recipientAddress: order?.shippingAddress
            ? {
                  company: order.shippingAddress?.company ?? "",
                  firstName: order.shippingAddress?.firstName ?? "",
                  lastName: order.shippingAddress?.lastName ?? "",
                  email: order.shippingAddress?.email ?? "",
                  street: Array.isArray(order.shippingAddress?.street)
                      ? [...order.shippingAddress.street, "", ""].slice(0, 2)
                      : ["", ""],
                  city: order.shippingAddress?.city ?? "",
                  region: order.shippingAddress?.region ?? "",
                  postalCode: order.shippingAddress?.postalCode ?? "",
                  // FR overseas (97x/98x postcode) verzendt onder eigen ISO-code bij TFF
                  country: canonicalShippingCountry(
                      order.shippingAddress?.country,
                      order.shippingAddress?.postalCode,
                  ),
                  phoneNumber: order.shippingAddress?.phoneNumber ?? "",
              }
            : emptyAddress(),
        shipmentOptions: {
            invoiceRef: order?.orderId ?? "",
            chosenRate: {
                carrier: "",
                service: "",
                price: "",
                reusableData: undefined,
            },
            sessionKey: "",
            incotermsGroupD: "DAP",
            description: "",
            exportReason: "sale",
            shipmentOriginCountry: tenant.defaults?.originCountry ?? "NL",
            totalShipmentValue: 0,
            registrationNumberTypeShipper: "EOR",
            registrationNumberShipper: "",
            registrationNumberTypeRecipient: "EIN",
            registrationNumberRecipient: "",
            deliveryInstructions: "",
            truckShipmentInfo: {
                shipperForklift: false,
                shipperTaillift: false,
                recipientForklift: false,
                recipientTaillift: false,
            },
            insuranceValue: 0,
            signatureRequired: "none",
            carrierAccountNumber: {
                specifyCarrierAccountNumber: false,
                carrierAccountNumber: "",
                carrierAccountNumberCountry: "",
                carrierAccountNumberPostalCode: "",
            },
        },
        invoice: { filename: "", base64: "" },
        orderId: "",
    } as unknown as ShipmentTemplate);

    // ── Step state (engine-gedreven; v1's wizardSteps-import is hier de engine) ──

    const stepsAll = buildSteps(tenant);
    const meta = { tenantId: tenant.id };

    $: visible = buildVisibleSteps(stepsAll, { shipment: $shipment as any, tenantId: tenant.id });

    const stepLabelKeys: Record<string, () => string> = {
        sender: () => m.shipmentWizard.senderStep.senderStepLabel,
        receiver: () => m.shipmentWizard.receiverStep.receiverStepLabel,
        packages: () => m.shipmentWizard.packageStep.packageStepLabel,
        products: () => m.shipmentWizard.productStep.productStepLabel,
        ship: () => m.shipmentWizard.shipStep.shipStepLabel,
    };
    const labelOf = (s: WizardStep) => stepLabelKeys[s.id]?.() ?? s.id;

    const stepIdx = writable(0);
    const stepLabels = writable<string[]>([]);
    $: stepLabels.set(visible.map(labelOf));
    $: currentStep = visible[$stepIdx] as WizardStep | undefined;

    // Clamp als de lijst krimpt (bv. EU-land vervangt non-EU) — v1's visibleSteps-clamp.
    $: if (visible.length && $stepIdx >= visible.length) stepIdx.set(visible.length - 1);

    $: isLastStep = $stepIdx === visible.length - 1;

    // Verder-guard: sectie-gescoopte veldvaliditeit (v1's isCurrentStepValid).
    $: currentSection = currentStep?.sectionKey ?? "";
    $: isCurrentStepValid =
        !currentSection ||
        Object.entries($fieldValidity)
            .filter(([k]) => k.startsWith(currentSection + "_"))
            .every(([, valid]) => valid === true);

    // ── Headercontext ──────────────────────────────────────────────────────────
    // De operator moet mid-flow blijven zien wélke zending hij aan het maken is.
    // Naam live vanuit het shipment (wijzigt mee als de ontvangerstap wordt bewerkt).
    $: headerName = (() => {
        const a: any = $shipment.recipientAddress ?? {};
        const person = [a.firstName, a.lastName].filter(Boolean).join(" ");
        return a.company || person || "Nieuwe zending";
    })();
    // v1 toonde hier batchLabel + ordercontext; batchLabel is TODO(order-flow).
    // Branding neemt de eerste plek in zodat de tenant-naam zichtbaar blijft (smoke).
    const headerOrderLine = [
        tenant.branding?.name,
        order?.orderId
            ? order.manuallyCreated
                ? "Handmatige order"
                : `Order #${order.orderId}`
            : "",
    ]
        .filter(Boolean)
        .join(" · ");

    let done = false;
    let panelEl: HTMLDivElement | undefined = undefined;

    function onWindowKey(e: KeyboardEvent) {
        if (e.key === "Escape" && !e.defaultPrevented) dispatch("close");
    }

    onMount(() => {
        resetFieldValidity();

        // Als de gebruiker in de host-pagina naar beneden gescrold was, kan de
        // scrollpositie voorbij de wizardtop liggen. Start bovenaan het paneel.
        panelEl?.scrollIntoView({ block: "start" });

        // Zelfde entree als v1: de engine bepaalt de eerste te renderen stap
        // (skip-toggles en auto-patches passeren zonder scherm).
        void (async () => {
            const res = await advance(stepsAll, $shipment as any, meta, 0);
            if (res.type === "done") { done = true; return; }
            shipment.set(res.shipment as unknown as ShipmentTemplate);
            const vis = buildVisibleSteps(stepsAll, { shipment: res.shipment, tenantId: tenant.id });
            stepIdx.set(Math.max(0, vis.findIndex((s) => s.id === res.step.id)));
        })();

        // v1-gedrag: rates worden reactief op de achtergrond opgehaald zodra
        // adressen+pakketten compleet zijn (readiness-suite uit de fabriek-emit).
        // TODO(order-flow): v1 onderdrukte dit in queueInBackground-modus.
        const stop = autoFetchRates(shipment as any, fieldValidity, 800, provider.readiness) as unknown;

        // Bij een stapwissel begint de nieuwe stap bovenaan in beeld — alleen
        // scrollen als de paneeltop uit beeld is, anders blijft de pagina rustig
        // staan. (Op stepIdx, niet currentStep: die her-emit bij elke shipment-edit.)
        const unsubScrollTop = stepIdx.subscribe(() => {
            if (!panelEl) return;
            if (panelEl.getBoundingClientRect().top < 0) {
                panelEl.scrollIntoView({ behavior: "smooth", block: "start" });
            }
        });

        return () => {
            unsubScrollTop();
            resetFieldValidity();
            if (typeof stop === "function") (stop as () => void)();
        };
    });

    // Bij het openen van een stap gaat de cursor alvast naar het eerste veld dat
    // nog gevuld moet worden — géén rood (dat komt pas bij blur of Verder), alleen
    // focus. Zo is een gedimde Verder-knop nooit onverklaard. Validators vullen
    // fieldValidity async ná mount, dus even laten settelen; heeft de gebruiker
    // (of een component) intussen zelf al focus gepakt, dan blijven we eraf.
    // Meerdere pogingen: de eerste kan te vroeg vallen.
    let focusInvalidTimer: ReturnType<typeof setTimeout> | undefined;
    function focusFirstInvalidField(attempt = 0) {
        if (typeof document === "undefined") return; // SSR-veilig
        if (focusInvalidTimer) clearTimeout(focusInvalidTimer);
        focusInvalidTimer = setTimeout(() => {
            try {
                const retry = () => {
                    if (attempt < 5) focusFirstInvalidField(attempt + 1);
                };
                if (!panelEl) return retry();
                const active = document.activeElement as HTMLElement | null;
                if (
                    active &&
                    panelEl.contains(active) &&
                    active.matches("input, select, textarea")
                ) {
                    return;
                }
                const validity = get(fieldValidity);
                const bad = Array.from(
                    panelEl.querySelectorAll<HTMLInputElement>(
                        "input[name], select[name]",
                    ),
                ).find(
                    (el) =>
                        el.offsetParent !== null &&
                        !el.disabled &&
                        validity[el.name] === false,
                );
                if (!bad) return retry();
                // Nooit scrollen: de stappen passen in de viewport.
                bad.focus({ preventScroll: true });
                // v1-gedrag: onthul gericht de foutmelding van dit ene (gevuld-maar-
                // invalide) veld waar we naartoe focussen — zonder de hele stap rood
                // te maken. De revealedFields-store stuurt showInvalid in de inputs.
                if (bad.name) revealField(bad.name);
            } catch {
                // Best-effort: focus-comfort mag nooit de wizard breken.
            }
        }, 80);
    }

    // Elke stap opent schoon: veldfouten tonen per veld bij blur, of allemaal
    // tegelijk wanneer de gebruiker op een invalide stap Verder klikt
    // (revealStepErrors). Alleen resetten bij een ECHTE stapwissel — currentStep
    // her-emit ook bij elke shipment-edit (visible is afgeleid van shipment), en
    // dat mag een eenmaal onthulde foutweergave niet weer wissen.
    let lastErrResetStepId: string | undefined;
    $: if (currentStep?.id !== lastErrResetStepId) {
        lastErrResetStepId = currentStep?.id;
        showAllErrors.set(false);
        resetRevealedFields();
        focusFirstInvalidField();
    }

    // ── Primary action with validation reveal ─────────────────────────────────
    // De Verder/Verzend-knop is altijd klikbaar; op een invalide stap onthult de
    // klik alle veldfouten en scrolt naar de eerste (Wise/PostNL-patroon) in
    // plaats van stil disabled te zijn.
    async function revealStepErrors() {
        showAllErrors.set(true);
        await tick();
        const bad = document.querySelector<HTMLElement>(
            "input.border-red-500, select.border-red-500",
        );
        if (bad) {
            // Alleen scrollen als het veld écht buiten beeld staat — de stappen
            // passen in principe in de viewport en dan is scrollen alleen onrustig.
            const r = bad.getBoundingClientRect();
            const viewH = window.innerHeight || document.documentElement.clientHeight;
            if (r.top < 0 || r.bottom > viewH) {
                bad.scrollIntoView({ block: "center", behavior: "smooth" });
            }
            bad.focus?.({ preventScroll: true });
        }
    }

    // Keyboard-first: Enter in een formulierveld springt naar het volgende
    // zichtbare veld (B2B-operators leven op het toetsenbord). Slaat events over
    // die een component al afhandelde (defaultPrevented — bv. de paste-to-fill-
    // regel) en laat textareas/buttons met rust.
    function onFieldEnterNav(e: KeyboardEvent) {
        if (e.key !== "Enter" || e.defaultPrevented) return;
        const t = e.target as HTMLElement;
        if (!t?.matches?.("input, select")) return;
        e.preventDefault();
        const container = e.currentTarget as HTMLElement;
        const els = Array.from(
            container.querySelectorAll<HTMLElement>("input, select"),
        ).filter(
            (el) => el.offsetParent !== null && !(el as HTMLInputElement).disabled,
        );
        const i = els.indexOf(t);
        if (i > -1 && i < els.length - 1) els[i + 1].focus();
    }

    // ── Navigation ─────────────────────────────────────────────────────────────

    // Ga verder vanaf de stap NA globalIdx; advance fast-forwardt door auto/skip-
    // stappen en stopt bij de eerste die gerenderd moet worden.
    async function advanceFromGlobal(globalIdx: number) {
        const res = await advance(stepsAll, $shipment as any, meta, globalIdx + 1);
        if (res.type === "done") {
            // v1 submitte hier; in v2 is de ship-stap altijd de laatste render,
            // dus mid-flow "done" is onbereikbaar — netjes afronden volstaat.
            done = true;
            return;
        }
        shipment.set(res.shipment as unknown as ShipmentTemplate);
        const vis = buildVisibleSteps(stepsAll, { shipment: res.shipment, tenantId: tenant.id });
        const newIdx = vis.findIndex((s) => s.id === res.step.id);
        stepIdx.set(newIdx >= 0 ? newIdx : Math.min($stepIdx + 1, Math.max(0, vis.length - 1)));
    }

    async function next() {
        // Valideer de stap die we verlaten — een net-niet-gecommitte edit (of één
        // die de veld-check haalt maar de hele-stap-validator niet) houdt ons op
        // die stap. Nooit stil weigeren: zonder feedback lijkt Verder kapot.
        const step = visible[$stepIdx];
        if (!step) return;
        const v = step.validate({ shipment: $shipment as any, tenantId: tenant.id });
        if (!v.valid) {
            void revealStepErrors();
            const msg = (v as any).message ?? v.reason;
            if (msg) toast.error(msg);
            return;
        }
        await advanceFromGlobal(stepsAll.indexOf(step));
    }

    function previous() {
        stepIdx.update((i) => Math.max(0, i - 1));
    }

    // "Overslaan" op de douanestap — bewust GEEN validatie van de verlaten stap:
    // het hele punt is dat de gebruiker rates kan zien vóór het genereren/uploaden
    // van de handelsfactuur. Boeken blijft veilig: ShipStepBlock blokkeert
    // factuur-/line-item-lanes (met een badge die hierheen terugnavigeert) tot de
    // douanestap echt is afgerond.
    async function skipCurrentStep() {
        const step = visible[$stepIdx];
        if (!step) return;
        await advanceFromGlobal(stepsAll.indexOf(step));
    }

    // De "Vereist productdetails"/"Vereist handelsfactuur"-badge van een
    // geblokkeerde rate is geklikt — spring terug naar de douanestap.
    function gotoProducts() {
        const i = visible.findIndex((s) => s.id === "products");
        if (i >= 0) stepIdx.set(i);
    }

    function handleAutoComplete() {
        void verzend();
    }

    function onPrimaryAction() {
        if (!isCurrentStepValid) {
            void revealStepErrors();
            return;
        }
        // TODO(order-flow): v1 routeerde hier ook naar attemptBackgroundShip
        // (queueInBackground / shouldOfferAutoShip) — komt met de queue-slice.
        if (isLastStep) {
            void verzend();
        } else {
            void next();
        }
    }

    // Verzenden: de volledige boek-keten via de proxy (choose deed de stap al bij
    // rate-selectie; dit is chooseOption+submit serverside, capability-guarded).
    let booking = false;
    async function verzend() {
        if (booking) return;
        const currentShipment = $shipment;
        const sessionkey = String(
            currentShipment?.shipmentOptions?.sessionKey ?? "",
        ).trim();
        if (!sessionkey) {
            toast.error("❌ No session key found. Please reselect a shipping option.");
            return;
        }
        booking = true;
        const capturedOrder = order;
        try {
            const value: any = await submitShipmentByType(shipment as any, {
                extCustomerId: userId,
                sessionkey,
                fingerprintMatrix: provider.submit?.fingerprintMatrix ?? {},
                onSuccess: () => {},
                onHide: () => {},
            });
            dispatch("success", {
                order: capturedOrder,
                detail: {
                    trackingNumber: value?.trackingNumber || "",
                    pdfUrl: value?.pdfUrl || "",
                    carrier: value?.carrier,
                    country: value?.destination,
                    service: value?.service,
                    forwarderRef: value?.forwarderRef,
                    shipmentTemplate: $shipment,
                },
            });
            toast.success(
                `Zending aangemaakt${value?.zendingnummer ? ` — nr. ${value.zendingnummer}` : ""}.`,
            );
            done = true;
        } catch (e) {
            const reason = (e as Error)?.message ?? String(e);
            // Geef de gecapturede order mee zodat de host de fout aan de JUISTE
            // order toeschrijft (v1's onShipmentError-contract).
            dispatch("shipmenterror", { reason, shipment: $shipment, order: capturedOrder });
            toast.error("❌" + reason);
        } finally {
            booking = false;
        }
    }

    onDestroy(() => {
        // Geen document-toegang hier (SSR-veilig); DOM-listeners ruimen op via de
        // onMount-return. Stores schoon achterlaten zoals v1.
        showAllErrors.set(false);
        if (focusInvalidTimer) clearTimeout(focusInvalidTimer);
    });
</script>

<svelte:window on:keydown={onWindowKey} />

<!-- Inline paneel — geen overlay/backdrop. Het rendert in het host-oppervlak dat de
     host-adapter aanwijst. Vlak wit, zonder rand of schaduw: de wizard IS de pagina,
     geen popup erover. -->
<div bind:this={panelEl} class="relative flex w-full flex-col bg-white">
    <!-- Eén headerbalk (Wise-patroon): ordercontext links, stepper in het midden,
         acties rechts. Geen losse zwevende regels boven het formulier meer. -->
    <div class="flex items-center gap-8 px-8 min-h-[64px] py-2.5 border-b border-gray-100">
        <div class="flex-1 min-w-0">
            <div class="text-sm font-semibold text-gray-900 truncate">{headerName}</div>
            {#if headerOrderLine}
                <div class="text-xs text-gray-400 truncate mt-0.5">{headerOrderLine}</div>
            {/if}
        </div>
        <div class="w-[46%] max-w-[560px] shrink-0">
            <ShipWizardProgress steps={stepLabels} step={stepIdx} />
        </div>
        <div class="flex-1 min-w-0 flex justify-end items-center gap-5 text-sm text-gray-500 font-medium">
            <button
                type="button"
                on:click={() => openHelp(WIZARD_STEP_TOPICS[currentStep?.id ?? ""] ?? "introduction")}
                class="flex items-center gap-1.5 text-gray-400 hover:text-gray-600 transition font-normal"
            >
                <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                    <path d="M12 17h.01" />
                </svg>
                {m.help?.helpLabel ?? "Hulp"}
            </button>
            <button
                type="button"
                on:click={() => dispatch("close")}
                class="flex items-center gap-1 hover:text-gray-800 transition"
            >
                {m.shipmentWizard.cancel}
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                >
                    <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M6 18L18 6M6 6l12 12"
                    />
                </svg>
            </button>
        </div>
    </div>

    <!-- min-h = gemeten hoogte van de NL-ontvangerstap (de langste formulierstap),
         inclusief de Bedrijf-stand van de type-toggle: de footer met Verder staat
         zo op verzender/ontvanger/verpakking op exact dezelfde plek (muscle
         memory). Langere stappen (douane/tarieven/intl-adres) groeien er gewoon
         overheen. -->
    <div class="flex-1 min-h-[570px]">
        <div class="w-full px-8 pt-5 pb-8">
            {#if done}
                <div class="flex items-center justify-center min-h-[220px] text-sm text-gray-500 border border-dashed border-gray-200 rounded-lg">
                    Klaar — alle stappen doorlopen.
                </div>
            {:else}
                <!-- svelte-ignore a11y-no-static-element-interactions -->
                <div on:keydown={onFieldEnterNav}>
                    {#key currentStep?.id}
                        {#if currentStep?.id === "sender"}
                            <SenderStepBlock {provider} {shipment} {userId} />
                        {:else if currentStep?.id === "receiver"}
                            <ReceiverStepBlock {provider} {shipment} {userId} />
                        {:else if currentStep?.id === "packages"}
                            <PackageTableStepBlock {order} {provider} {shipment} {userId} />
                        {:else if currentStep?.id === "products"}
                            <ProductStepBlock {order} {provider} {shipment} {userId} />
                        {:else if currentStep?.id === "ship"}
                            <ShipStepBlock
                                {provider}
                                {shipment}
                                {userId}
                                {token}
                                {order}
                                automationRules={userPreferences?.automationRules ?? []}
                                on:autocomplete={handleAutoComplete}
                                on:gotoproducts={gotoProducts}
                            />
                        {/if}
                    {/key}
                </div>
            {/if}
        </div>
    </div>

    <!-- Niet sticky: het paneel scrollt als gewone pagina mee. -->
    {#if !done}
        <div class="border-t border-gray-100 bg-white h-[68px]">
            <div class="h-full px-8 flex items-center justify-between">
                <!-- v1 verving Vorige op stap 0 door een lege div; hier invisible
                     (zelfde beeld) zodat de knoptekst in de DOM blijft (SSR-smoke). -->
                <button
                    type="button"
                    class="px-7 py-2.5 rounded-full border bg-white border-gray-300 text-gray-800 font-semibold hover:bg-gray-50 transition"
                    class:invisible={$stepIdx === 0}
                    disabled={$stepIdx === 0}
                    on:click={previous}
                >
                    {m.shipmentWizard.previousButton}
                </button>

                <div class="flex items-center gap-3">
                    {#if currentStep?.id === "products"}
                        <button
                            type="button"
                            class="px-7 py-2.5 rounded-full border border-gray-200 bg-white text-gray-500 font-semibold hover:bg-gray-50 transition"
                            on:click={skipCurrentStep}
                            title="Sla de douanestap over om alvast tarieven te bekijken — de handelsfactuur blijft nodig vóór het aanmaken van het label"
                        >
                            Overslaan
                        </button>
                    {/if}
                    <button
                        type="button"
                        class={`px-8 py-2.5 rounded-full font-semibold transition ${
                            isCurrentStepValid
                                ? "bg-blue-600 text-white hover:bg-blue-700"
                                : "bg-blue-600/50 text-white hover:bg-blue-600/60"
                        }`}
                        disabled={booking}
                        on:click={onPrimaryAction}
                    >
                        {isLastStep
                            ? m.shipmentWizard.shipButton
                            : m.shipmentWizard.continueButton}
                    </button>
                </div>
            </div>
        </div>
    {/if}
</div>

<HelpDrawer />
<ToastDisplay />
