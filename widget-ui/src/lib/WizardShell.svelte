<script lang="ts">
    // Wizard-shell: bedraadt de GEPORTE v2-engine (src/widget/engine, slice 20) aan de
    // geporte UI-componenten. Dit is bewust nog niet de volledige ShipWizardModal-port
    // (die volgt met rates/submit-bedrading); wél dezelfde machine: buildSteps uit
    // tenant-config, advance() slaat skips/auto's over, footer-gating via formIsValid.
    import { writable } from "svelte/store";
    import type { TenantConfig } from "../../../src/widget/tenant.ts";
    import type { WizardStep } from "../../../src/widget/engine/types.ts";
    import { buildSteps } from "../../../src/widget/engine/build-steps.ts";
    import { buildVisibleSteps, advance } from "../../../src/widget/engine/engine.ts";
    import type { WidgetProviderLayer } from "./providers/types";
    import type { ShipmentTemplate } from "./types/config";
    import { formIsValid, showAllErrors } from "./state/formValidation";
    import { m } from "./state/messageStore";
    import ShipWizardProgress from "./components/ShipWizardProgress.svelte";
    import SenderStepBlock from "./components/SenderStepBlock.svelte";
    import ReceiverStepBlock from "./components/ReceiverStepBlock.svelte";
    import PackageTableStepBlock from "./components/PackageTableStepBlock.svelte";
    import ProductStepBlock from "./components/ProductStepBlock.svelte";
    import ShipStepBlock from "./components/ShipStepBlock.svelte";
    import { fieldValidity } from "./state/formValidation";
    import { autoFetchRates } from "./api/rateFetcher";
    import ToastDisplay from "./components/toast/ToastDisplay.svelte";
    import { onMount } from "svelte";

    export let tenant: TenantConfig;
    export let provider: WidgetProviderLayer;
    /** Interim: v2-tenancy koppelt dit aan het boekaccount; dev-harness geeft tenant.id door. */
    export let userId: string = "";

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

    // Tenant-default (v1 hardcodeerde "NL"-origin; hier uit tenant-config).
    export const shipment = writable<ShipmentTemplate>({
        shipperAddress: {
            ...emptyAddress(),
            country: tenant.defaults?.originCountry ?? "",
        },
        recipientAddress: emptyAddress(),
        packages: [],
        products: [],
    } as unknown as ShipmentTemplate);

    const stepsAll = buildSteps(tenant);
    const meta = { tenantId: tenant.id };

    $: ctx = { shipment: $shipment as any, tenantId: tenant.id };
    $: visible = buildVisibleSteps(stepsAll, ctx);

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

    let done = false;

    onMount(() => {
        // Zelfde entree als v1: de engine bepaalt de eerste te renderen stap
        // (skip-toggles en auto-patches passeren zonder scherm).
        void (async () => {
            const res = await advance(stepsAll, $shipment as any, meta, 0);
            if (res.type === "done") { done = true; return; }
            shipment.set(res.shipment as unknown as ShipmentTemplate);
            stepIdx.set(Math.max(0, visible.indexOf(res.step)));
        })();
        // v1-gedrag: rates worden reactief op de achtergrond opgehaald zodra
        // adressen+pakketten compleet zijn (readiness-suite uit de fabriek-emit).
        const stop = autoFetchRates(shipment as any, fieldValidity, 800, provider.readiness) as unknown;
        return () => {
            if (typeof stop === "function") (stop as () => void)();
        };
    });

    function gotoProducts() {
        const i = visible.findIndex((s) => s.id === "products");
        if (i >= 0) { showAllErrors.set(false); stepIdx.set(i); }
    }

    async function next() {
        const step = visible[$stepIdx];
        if (!step) return;
        const v = step.validate({ shipment: $shipment as any, tenantId: tenant.id });
        if (!v.valid || !$formIsValid) {
            showAllErrors.set(true);
            return;
        }
        showAllErrors.set(false);
        const globalIdx = stepsAll.indexOf(step);
        const res = await advance(stepsAll, $shipment as any, meta, globalIdx + 1);
        if (res.type === "done") { done = true; return; }
        shipment.set(res.shipment as unknown as ShipmentTemplate);
        stepIdx.set(Math.max(0, visible.indexOf(res.step)));
    }

    function previous() {
        showAllErrors.set(false);
        stepIdx.update((i) => Math.max(0, i - 1));
    }
</script>

<div class="shell">
    <div class="head">
        {#if tenant.branding?.name}
            <span class="brand">{tenant.branding.name}</span>
        {/if}
        <ShipWizardProgress step={stepIdx} steps={stepLabels} />
    </div>

    <div class="body">
        {#if done}
            <div class="placeholder">Klaar — alle stappen doorlopen.</div>
        {:else if currentStep?.id === "sender"}
            <SenderStepBlock {provider} {shipment} />
        {:else if currentStep?.id === "receiver"}
            <ReceiverStepBlock {provider} {shipment} {userId} />
        {:else if currentStep?.id === "packages"}
            <PackageTableStepBlock order={null} {provider} {shipment} {userId} />
        {:else if currentStep?.id === "products"}
            <ProductStepBlock order={null} {provider} {shipment} {userId} />
        {:else if currentStep?.id === "ship"}
            <ShipStepBlock
                {provider}
                {shipment}
                {userId}
                on:gotoproducts={gotoProducts}
            />
        {:else if currentStep}
            <!-- Volgende slices: Receiver/PackageTable/Product/Ship step-blocks porten. -->
            <div class="placeholder">
                <strong>{labelOf(currentStep)}</strong> — deze stap wordt in een
                volgende slice geport.
            </div>
        {/if}
    </div>

    {#if !done}
        <div class="footer">
            <button
                type="button"
                class="btn secondary"
                on:click={previous}
                disabled={$stepIdx === 0}>{m.shipmentWizard.previousButton}</button
            >
            <button type="button" class="btn primary" on:click={next}
                >{m.shipmentWizard.continueButton}</button
            >
        </div>
    {/if}
</div>

<ToastDisplay />

<style>
    /* Svelte-scoped, net als v1: de widget draait in host-pagina's waar generieke
       classnamen kunnen botsen met host-CSS. */
    .shell {
        max-width: 980px;
        margin: 0 auto;
        background: #fff;
        border: 1px solid #e5e7eb;
        border-radius: 10px;
        padding: 24px 28px;
        font-family: ui-sans-serif, system-ui, sans-serif;
    }

    .head {
        display: flex;
        flex-direction: column;
        gap: 14px;
        margin-bottom: 24px;
    }

    .brand {
        font-size: 13px;
        font-weight: 700;
        color: #111827;
    }

    .body {
        min-height: 260px;
    }

    .placeholder {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 220px;
        color: #6b7280;
        font-size: 14px;
        border: 1px dashed #e5e7eb;
        border-radius: 8px;
    }

    .footer {
        display: flex;
        justify-content: space-between;
        margin-top: 24px;
        padding-top: 16px;
        border-top: 1px solid #f0f1f4;
    }

    .btn {
        font-size: 14px;
        padding: 8px 18px;
        border-radius: 6px;
        border: 1px solid transparent;
        cursor: pointer;
    }

    .btn.primary {
        background: #2563eb;
        color: #fff;
    }

    .btn.primary:hover {
        background: #1d4ed8;
    }

    .btn.secondary {
        background: #fff;
        border-color: #d1d5db;
        color: #374151;
    }

    .btn.secondary:disabled {
        opacity: 0.4;
        cursor: default;
    }
</style>
