<script lang="ts">
    // INTERIM verzendstap — bewust NIET de v1 ShipStepBlock-port (1270 regels; die
    // hangt aan fingerprint/veld-matrices en dynamische extra velden die pas met de
    // fabriek-uitbreiding meekomen, blueprint stap 5). Dit paneel bewijst de
    // proxy-first datapad in de UI: rates ophalen via de tenant-base, tonen, kiezen.
    import { onMount } from "svelte";
    import type { Writable } from "svelte/store";
    import type { ShipmentTemplate } from "../types/config";
    import { fetchRates, type RateOption } from "../api/ratesClient";
    import StepSection from "./wizard/StepSection.svelte";
    import { m } from "../state/messageStore";

    export let shipment: Writable<ShipmentTemplate>;

    let state: "loading" | "ok" | "error" = "loading";
    let error = "";
    let rates: RateOption[] = [];
    let chosen: RateOption | null = null;

    const fmtPrice = (p: number) =>
        new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(p);

    function choose(r: RateOption) {
        chosen = r;
        // Interim-markering op het canonieke model; de echte chooseOption/submit-
        // bedrading komt met de volledige ship-stap-port.
        shipment.update((s) => ({ ...s, chosenRateInterim: r }) as ShipmentTemplate);
    }

    onMount(async () => {
        try {
            rates = await fetchRates($shipment);
            state = "ok";
        } catch (e) {
            error = (e as Error).message;
            state = "error";
        }
    });
</script>

<div class="w-full max-w-[920px] mx-auto text-sm text-gray-800">
    <StepSection label={m.shipmentWizard.shipStep.shipStepLabel ?? "Verzending"}>
        {#if state === "loading"}
            <div class="pane muted">Tarieven ophalen…</div>
        {:else if state === "error"}
            <div class="pane muted">
                Tarieven ophalen mislukt: {error}. Draait de proxy (npm run server)?
            </div>
        {:else if rates.length === 0}
            <div class="pane muted">Geen tarieven beschikbaar voor deze zending.</div>
        {:else}
            <div class="rates">
                {#each rates as r (r.carrier + r.service)}
                    <button
                        type="button"
                        class="rate"
                        class:chosen={chosen === r}
                        on:click={() => choose(r)}
                    >
                        <span class="carrier">{r.carrier}</span>
                        <span class="service">{r.service}</span>
                        <span class="price">{fmtPrice(r.price)}</span>
                    </button>
                {/each}
            </div>
        {/if}
    </StepSection>
</div>

<style>
    .pane {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 140px;
        border: 1px dashed #e5e7eb;
        border-radius: 8px;
    }

    .muted {
        color: #6b7280;
        font-size: 13px;
    }

    .rates {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .rate {
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 12px 16px;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        background: #fff;
        font-family: inherit;
        font-size: 13.5px;
        cursor: pointer;
        text-align: left;
        transition: border-color 0.15s ease, background 0.15s ease;
    }

    .rate:hover {
        border-color: #93b4f5;
    }

    .rate.chosen {
        border-color: #2563eb;
        background: #eff6ff;
    }

    .carrier {
        font-weight: 600;
        min-width: 90px;
        color: #111827;
    }

    .service {
        flex: 1;
        color: #6b7280;
    }

    .price {
        font-weight: 600;
        color: #111827;
    }
</style>
