<!-- Geport uit v1 src/lib/components/ConfigButton.svelte. Wijzigingen: geen mechaniek —
     de knop linkt naar de instellingen-/syncpagina op apiBaseUrl. TODO(order-flow): de
     v2-proxy heeft (nog) geen /sync-pagina; de link landt dan op unknown_route. -->
<script lang="ts">
  import { apiBaseUrl } from "../api/global";
  export let userId: string;
  export let token: string;
  export let variant: 'default'|'subtle' = 'default';

  const btn =
    variant === 'subtle'
      ? "px-2.5 py-[5px] text-xs border border-gray-300 bg-gray-200 text-gray-600 hover:bg-gray-300"
      : "px-2.5 py-[5px] text-sm font-bold border border-gray-300 bg-white text-gray-700 hover:bg-blue-50";

  const icon = variant === 'subtle' ? { w: 16, h: 16 } : { w: 16, h: 16 };

  function goToSyncPage() {
    const url = `${apiBaseUrl}/sync?userId=${userId}&token=${token}`;
    window.location.href = url;
  }
</script>

<div class="relative">
  <button on:click={goToSyncPage} class={`flex items-center ${btn}`} title="Open sync page">
    <svg xmlns="http://www.w3.org/2000/svg" width={icon.w} height={icon.h} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.22" stroke-linecap="round" stroke-linejoin="round">
      <path d="M14 17H5"/><path d="M19 7h-9"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>
    </svg>
  </button>
</div>
