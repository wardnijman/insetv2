<!-- Geport uit v1 src/lib/components/LangSelector.svelte. Wijzigingen: v1's setLocale
     (client-app: persist + reinjectWidget) bestaat niet in v2 — de catalogus is
     GEBUNDELD (messageStore.setLang). switchLang zet de taal direct, persist
     "preferences.language" fail-soft via de proxy, en herlaadt de pagina omdat `m`
     een module-singleton is (geen store): zonder reload blijft gerenderde tekst in de
     oude taal staan. Widget-boot leest preferences.language terug — de keuze plakt. -->
<script lang="ts">
  import { currentLang, setLang, type Lang } from "../state/messageStore";
  import { updateUserConfig } from "../api/updateUserConfig";
  export let userId: string;
  export let availableLanguages: Lang[] = ["NL","EN","FR","DE","ES","IT"];
  export let variant: 'default'|'subtle' = 'default';

  let open = false;

  const btn =
    variant === 'subtle'
      ? "relative inline-flex items-center justify-center w-8 h-8 rounded-full border border-gray-300 bg-gray-200 text-gray-700 hover:bg-gray-300"
      : "relative inline-flex items-center justify-center w-8 h-8 rounded-full border border-gray-300 bg-white text-gray-700 hover:bg-blue-50";

  async function switchLang(lang: Lang) {
    open = false;
    try {
      setLang(lang);
      await updateUserConfig("preferences.language", lang, userId);
    } catch {}
    // `m` is geen store: herladen is de v2-interim voor v1's reinjectWidget.
    if (typeof window !== "undefined") window.location.reload();
  }
  const toggle = () => (open = !open);
</script>

<svelte:window on:click={() => (open = false)} />

<div class="relative">
  <button
    on:click|stopPropagation={toggle}
    aria-haspopup="menu"
    aria-expanded={open}
    aria-label="Change language"
    title={`Language: ${currentLang}`}
    class={btn}
  >
    <!-- Globe -->
    <svg class="w-[14px] h-[14px] opacity-80" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M2.5 12h19" />
      <path d="M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" />
    </svg>
    <!-- Tiny chevron indicator (keeps button same size as Settings) -->
    <span class="pointer-events-none absolute -right-0.5 -bottom-0.5 w-3 h-3 rounded-full bg-white/90 border border-gray-300 flex items-center justify-center">
      <svg class="w-2.5 h-2.5 opacity-70" viewBox="0 0 20 20" fill="currentColor">
        <path d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 10.94l3.71-3.71a.75.75 0 1 1 1.06 1.06l-4.24 4.24a.75.75 0 0 1-1.06 0L5.21 8.29a.75.75 0 0 1 .02-1.08z"/>
      </svg>
    </span>
  </button>

  {#if open}
    <div
      on:click|stopPropagation
      class="absolute right-0 mt-2 z-50 bg-white border border-gray-200 rounded-lg shadow text-sm text-gray-700 min-w-[8rem] py-1"
      role="menu"
      tabindex="-1"
    >
      {#each availableLanguages as lang}
        <button
          on:click={() => switchLang(lang)}
          class={`w-full flex items-center justify-between gap-3 px-3 py-1 text-left hover:bg-gray-100 ${currentLang === lang ? "bg-blue-50 font-semibold text-blue-800" : ""}`}
          role="menuitemradio" aria-checked={currentLang === lang}
        >
          <span>{lang}</span>
          {#if currentLang === lang}
            <svg class="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M16.704 5.29a1 1 0 0 1 .006 1.414l-7.07 7.071a1 1 0 0 1-1.42 0L3.29 9.846a1 1 0 1 1 1.414-1.414l3.09 3.09 6.364-6.364a1 1 0 0 1 1.546.132Z" clip-rule="evenodd"/>
            </svg>
          {/if}
        </button>
      {/each}
    </div>
  {/if}
</div>
