<!-- Geport uit v1 src/lib/components/OrderSummary.svelte. Wijzigingen: geen.
     (m.serviceSettingComponents.* zit in de v2-catalogus.) -->
<script lang="ts">
    import { m } from "../state/messageStore";
    import type { EnrichedOrder } from "../types/webshop";

    export let order: EnrichedOrder | null = null;

    function formatDate(dateStr: string): string {
        return new Date(dateStr).toLocaleDateString("nl-NL", {
            day: "2-digit",
            month: "short",
            year: "numeric",
        });
    }

    function getCountryFlag(country: string) {
        return country === "Germany" || country === "DE" ? "🇩🇪" : "";
    }
</script>

{#if order && !order.shipment}
    <div class="text-sm text-gray-600 space-y-6">
        <!-- Header -->
        <div class="border-b pb-3">
            <div class="flex justify-between text-gray-600 font-semibold">
                <span>{order.orderPlatform}</span>
                <span>Order #{order.orderId}</span>
            </div>
            <div class="flex justify-between text-xs text-gray-400 mt-1">
                <span>Placed on: {formatDate(order.createdAt)}</span>
                <span>€{order.grandTotal.toFixed(2)}</span>
            </div>
        </div>

        <!-- Shipping -->
        <div class="border-b pb-4">
            <div class="text-xs font-normal mb-1 text-gray-500">
                Shipping Address
            </div>
            <div class="leading-5 text-xs">
                {order.shippingAddress.firstName}
                {order.shippingAddress.lastName}<br />
                {#if order.shippingAddress.company}
                    {order.shippingAddress.company}<br />
                {/if}
                {#each order.shippingAddress.street as line}
                    {line}<br />
                {/each}
                {order.shippingAddress.city}, {order.shippingAddress
                    .postalCode}<br />
                {getCountryFlag(order.shippingAddress.country)}
                {order.shippingAddress.country}<br />
                <span class="text-gray-500"
                    >Tel: {order.shippingAddress.phoneNumber}</span
                >
            </div>
        </div>

        <!-- Items -->
        <div>
            <div class="text-xs font-normal mb-1 text-gray-500">Items</div>
            <ul class="text-xs space-y-1">
                {#each order.orderedItems.slice(0, 2) as item}
                    <li>
                        {item.name} ×{item.quantity}
                        <span class="text-gray-400">({item.sku})</span>
                    </li>
                {/each}
                {#if order.orderedItems.length > 2}
                    <li class="text-gray-400 italic">
                        +{order.orderedItems.length - 2} more item{order
                            .orderedItems.length -
                            2 >
                        1
                            ? "s"
                            : ""}…
                    </li>
                {/if}
            </ul>
        </div>
    </div>

{:else if order && order.shipment}
<div class="space-y-4 text-sm text-gray-700">
    <!-- Tracking info -->
    <div class="border-b pb-2">
        <div class="font-semibold">{m.serviceSettingComponents.trackingnumber}</div>
        <div>{order.shipment.trackingNumber}</div>
    </div>

    <!-- PDF viewer -->
    <div class="border rounded shadow overflow-hidden">
        <iframe
            title="Label PDF"
            src={order.shipment.pdfUrl}
            class="w-full h-[80vh]"
            style="border: none;"
        ></iframe>
    </div>
</div>

{:else}
    <div class="h-full flex items-center justify-center">
        <p class="text-sm text-gray-400 italic text-center">
            {m.serviceSettingComponents.selectAnOrderToViewDetails}
        </p>
    </div>
{/if}
