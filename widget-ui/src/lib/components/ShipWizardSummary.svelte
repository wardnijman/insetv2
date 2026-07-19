<script lang="ts">
	// Geport uit v1 src/lib/components/ShipWizardSummary.svelte. Wijzigingen: geen —
	// verbatim port; ../types/config en ../state/messageStore bestaan 1-op-1 in v2.
	import type { Writable } from "svelte/store";
	import type { ShipmentTemplate } from "../types/config";
    import { m } from "../state/messageStore";
	export let shipment: Writable<ShipmentTemplate>;

	function formatAddressLines(address?: any): string[] {
		if (!address) return ["–"];
		return [
			(address.company ? address.company + "/ " : "") +
				address.firstName +
				" " +
				address.lastName,
			address.street?.join(" ") || "",
			`${address.postalCode} ${address.city}`,
			address.country,
		].filter(Boolean);
	}

	function formatAddressLinesCompany(address?: any): string[] {
		if (!address) return ["–"];
		return [
			address.company,
			address.street?.join(" ") || "",
			`${address.postalCode} ${address.city}`,
			address.country,
		].filter(Boolean);
	}
</script>

<div class="flex-1 h-full space-y-4 text-sm">
	<!-- Verzendinformatie -->
	<div
		class="border border-gray-200 rounded-xl bg-white p-4 text-gray-800 leading-relaxed"
	>
		<h3 class="font-semibold mb-3 -ml-6">{m.shipmentWizard.shipStep.summaryTitle}</h3>
		<div class="grid grid-cols-2 gap-8">
			<!-- Afzender -->
			<div class="space-y-1">
				<div class="text-gray-500 font-medium">{m.shipmentWizard.shipStep.summarySender}</div>
				{#each formatAddressLinesCompany($shipment.shipperAddress) as line}
					<div>{line}</div>
				{/each}
			</div>

			<!-- Ontvanger -->
			<div class="space-y-1">
				<div class="text-gray-500 font-medium">{m.shipmentWizard.shipStep.summaryReceiver}</div>
				{#each formatAddressLines($shipment.recipientAddress) as line}
					<div>{line}</div>
				{/each}
			</div>
		</div>
	</div>

	<!-- Pakketinfo -->
	{#if $shipment.packages?.length}
		<div
			class="border border-gray-200 rounded-xl bg-white p-4 text-gray-800"
		>
			<h4 class="font-semibold mb-2">{m.shipmentWizard.shipStep.summaryPackageDetails}</h4>
			<ul class="space-y-3 list-none p-0 m-0 pt-2">
				{#each $shipment.packages as p, i}
					<li
						class="border border-gray-100 rounded-md px-3 py-2 bg-gray-50"
					>
						<div
							class="flex justify-between items-center font-medium"
						>
							<div>{p.name || `${m.shipmentWizard.packageStep.packageLabel} ${i + 1}`}</div>
							<div class="text-xs text-gray-500">
								{p.type === "pallet" ? m.shipmentWizard.packageStep.palletLabel : m.shipmentWizard.packageStep.packageLabel}
							</div>
						</div>
						<div class="text-xs text-gray-600 mt-1">
							{p.length}×{p.width}×{p.height} cm, {p.weight} kg
							{#if p.stackable}
								· {m.shipmentWizard.shipStep.summaryStackable}{/if}
							{#if p.dangerousGoods}
								· {m.shipmentWizard.shipStep.summaryDangerous}{/if}
							{#if p.bioGoods}
								· {m.shipmentWizard.shipStep.summaryBio}{/if}
							{#if p.vehicle}
								· {m.shipmentWizard.shipStep.summaryVehicle}: {p.vehicle}{/if}
						</div>
					</li>
				{/each}
			</ul>
		</div>
	{/if}

	<!-- Extra content directly below the package details (e.g. the ship step's
	     "Lang wachten?" hint). Inside this container so the root's h-full doesn't
	     push slotted content to the bottom of the column. -->
	<slot />
</div>
