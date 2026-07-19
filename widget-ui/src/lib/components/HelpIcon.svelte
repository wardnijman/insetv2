<!-- Geport uit v1 src/lib/components/HelpIcon.svelte. Wijzigingen: geen. -->
<!-- Circled "?" that opens the in-widget help drawer at the given topic (the
     drawer itself offers the "open full manual" escape hatch). Visual style
     matches the inline hint bubbles in SkeletonContainer. stopPropagation:
     these icons sit inside clickable headers/rows and must never trigger the
     parent. -->
<script lang="ts">
  import type { HelpTopic } from "../help/helpTopics";
  import { openHelp } from "../help/helpDrawer";
  import { m } from "../state/messageStore";

  export let topic: HelpTopic;
  /** Optional one-line hover hint shown above the generic "open help" line. */
  export let hint: string = "";

  let open = false;

  $: openLabel = m?.help?.openManual ?? "Uitleg";
</script>

<span
  class="relative inline-flex align-middle"
  on:mouseenter={() => (open = true)}
  on:mouseleave={() => (open = false)}
>
  <button
    type="button"
    aria-label={hint || openLabel}
    class="inline-flex h-4 w-4 items-center justify-center rounded-full border border-gray-300 text-[10px] leading-none text-gray-400 bg-transparent p-0 cursor-pointer hover:border-gray-400 hover:text-gray-600 transition-colors"
    on:click|stopPropagation={() => openHelp(topic)}
  >?</button>
  {#if open}
    <span
      class="pointer-events-none absolute left-1/2 top-[160%] z-[120] w-56 -translate-x-1/2 rounded bg-gray-800 px-2 py-1.5 text-xs font-normal leading-snug text-white shadow-lg"
    >
      {#if hint}{hint}<br />{/if}
      <span class="text-gray-300">{openLabel}</span>
    </span>
  {/if}
</span>
