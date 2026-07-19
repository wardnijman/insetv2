<!-- Geport uit v1 src/lib/components/HelpDrawer.svelte. Wijzigingen: manualUrl
     gebruikt WIDGET_MANUAL_PATH uit ../help/helpDrawer (TODO(tenant-config)
     daar) i.p.v. hardcoded "/docs/widget"; verder geen. -->
<!-- In-widget help: floating right slide-over rendering the manual content
     fetched from the client app (see helpDrawer.ts). Sits above the wizard
     (z-100) and the rate picker (z-110). Esc closes the drawer FIRST — the
     keydown runs in the capture phase and calls preventDefault, which
     ShipWizardModal's own Escape handler respects (it checks
     e.defaultPrevented). The section title lives in the scroll body (not the
     header) so it can wrap instead of truncating. -->
<script lang="ts">
  import { onMount } from "svelte";
  import { fade, fly } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import { apiBaseUrl } from "../api/global";
  import {
    helpDrawer,
    closeHelp,
    loadHelpSections,
    WIDGET_MANUAL_PATH,
    type HelpSection,
  } from "../help/helpDrawer";
  import { m } from "../state/messageStore";

  let sections: HelpSection[] = [];
  let loading = false;
  let loadError = false;
  let bodyEl: HTMLDivElement | null = null;

  $: open = $helpDrawer.open;
  $: topic = $helpDrawer.topic;
  $: current = sections.find((s) => s.topic === topic) ?? null;
  $: others = sections.filter((s) => s.topic !== topic);
  $: manualUrl = `${apiBaseUrl}${WIDGET_MANUAL_PATH}#${topic}`;

  $: if (open && !sections.length && !loading) {
    loading = true;
    loadError = false;
    loadHelpSections()
      .then((s) => (sections = s))
      .catch(() => (loadError = true))
      .finally(() => (loading = false));
  }

  // Scroll back to top whenever the topic changes while open.
  $: if (open && topic && bodyEl) bodyEl.scrollTo(0, 0);

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && open) {
      e.preventDefault();
      e.stopPropagation();
      closeHelp();
    }
  }

  onMount(() => {
    window.addEventListener("keydown", onKeydown, true);
    return () => window.removeEventListener("keydown", onKeydown, true);
  });

  function absolutize(src: string) {
    return src.startsWith("http") ? src : `${apiBaseUrl}${src}`;
  }

  function go(t: string) {
    helpDrawer.set({ open: true, topic: t as any });
  }

  // Authored content cross-links sections with <a href="#topic"> — route those
  // inside the drawer. Root-relative links (e.g. /faq) point at the client app,
  // not the TFF host page we're injected into — absolutize and open a new tab.
  function onBodyClick(e: MouseEvent) {
    const a = (e.target as HTMLElement)?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!a) return;
    const href = a.getAttribute("href") ?? "";
    if (href.startsWith("#")) {
      e.preventDefault();
      const t = href.slice(1);
      if (sections.some((s) => s.topic === t)) go(t);
    } else if (href.startsWith("/")) {
      e.preventDefault();
      window.open(`${apiBaseUrl}${href}`, "_blank", "noreferrer");
    }
  }
</script>

{#if open}
  <div class="fixed inset-0 z-[130]" role="dialog" aria-modal="true" aria-label={m.help?.title ?? "Hulp"}>
    <!-- svelte-ignore a11y-no-static-element-interactions a11y-click-events-have-key-events -->
    <div
      class="absolute inset-0 bg-gray-900/20 backdrop-blur-[1px]"
      on:click={closeHelp}
      transition:fade={{ duration: 180 }}
    ></div>

    <aside
      class="absolute right-3 inset-y-3 w-full max-w-[560px] bg-white rounded-xl shadow-2xl ring-1 ring-black/[0.06] flex flex-col overflow-hidden"
      transition:fly={{ x: 560, duration: 280, easing: cubicOut, opacity: 1 }}
    >
      <header class="flex items-center justify-between gap-3 pl-6 pr-3 h-12 border-b border-gray-100 shrink-0">
        <span class="text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-400 select-none">
          {m.help?.title ?? "Hulp"}
        </span>
        <div class="flex items-center gap-1 shrink-0">
          <a
            href={manualUrl}
            target="_blank"
            rel="noreferrer"
            class="inline-flex items-center gap-1 px-2.5 h-8 rounded-md text-[12.5px] text-gray-500 hover:text-gray-800 hover:bg-gray-50 transition-colors whitespace-nowrap"
          >
            {m.help?.fullManual ?? "Volledige handleiding"}
            <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M7 17 17 7" /><path d="M7 7h10v10" />
            </svg>
          </a>
          <button
            type="button"
            class="inline-flex items-center justify-center h-8 w-8 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-50 transition-colors"
            on:click={closeHelp}
            aria-label={m.help?.close ?? "Sluiten"}
          >
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M18 6 6 18" /><path d="m6 6 12 12" />
            </svg>
          </button>
        </div>
      </header>

      <!-- svelte-ignore a11y-no-static-element-interactions a11y-click-events-have-key-events -->
      <div
        class="flex-1 overflow-y-auto px-6 py-6 text-[13.5px] leading-relaxed text-gray-700"
        bind:this={bodyEl}
        on:click={onBodyClick}
      >
        {#if loading}
          <div class="space-y-3 animate-pulse pt-1">
            <div class="h-5 w-2/3 rounded bg-gray-100"></div>
            <div class="h-3.5 rounded bg-gray-100"></div>
            <div class="h-3.5 w-5/6 rounded bg-gray-100"></div>
            <div class="h-40 rounded-lg bg-gray-50"></div>
            <div class="h-3.5 rounded bg-gray-100"></div>
            <div class="h-3.5 w-4/6 rounded bg-gray-100"></div>
          </div>
        {:else if loadError}
          <p class="text-gray-500">
            {m.help?.loadError ?? "De hulpinhoud kon niet worden geladen."}
            <a class="text-gray-700 underline underline-offset-2 hover:text-gray-900" href={manualUrl} target="_blank" rel="noreferrer">
              {m.help?.fullManual ?? "Volledige handleiding"}
            </a>
          </p>
        {:else if current}
          <h1 class="text-[19px] font-semibold tracking-[-0.01em] text-gray-900 leading-snug">
            {current.title}
          </h1>
          <p class="mt-1.5 mb-5 text-[13.5px] text-gray-500">{current.lead}</p>

          {#each current.blocks as block}
            {#if block.kind === "p"}
              <p class="my-3 help-html">{@html block.html}</p>
            {:else if block.kind === "h2"}
              <h2 class="mt-7 mb-2 text-[14px] font-semibold text-gray-900">{block.text}</h2>
            {:else if block.kind === "steps"}
              <ol class="my-4 space-y-3 list-none p-0">
                {#each block.items as item, i}
                  <li class="flex gap-3">
                    <span class="shrink-0 mt-[1px] inline-flex h-5 w-5 items-center justify-center rounded-full bg-gray-100 text-gray-600 text-[11px] font-semibold tabular-nums">{i + 1}</span>
                    <span class="help-html min-w-0">{@html item}</span>
                  </li>
                {/each}
              </ol>
            {:else if block.kind === "image"}
              <figure class="my-4">
                <img
                  src={absolutize(block.src)}
                  alt={block.alt}
                  loading="lazy"
                  class="w-full rounded-lg ring-1 ring-gray-200 shadow-sm"
                  on:error={(e) => {
                    const fig = (e.currentTarget as HTMLElement)?.closest?.("figure") as HTMLElement | null;
                    if (fig) fig.style.display = "none";
                  }}
                />
                {#if block.caption}<figcaption class="mt-1.5 text-[12px] text-gray-400">{block.caption}</figcaption>{/if}
              </figure>
            {:else if block.kind === "callout"}
              <div
                class={`my-4 rounded-lg px-3.5 py-2.5 text-[12.5px] leading-relaxed help-html ${
                  block.tone === "warn"
                    ? "bg-amber-50 text-amber-900"
                    : "bg-gray-50 text-gray-600"
                }`}
              >{@html block.html}</div>
            {:else if block.kind === "table"}
              <div class="my-4 -mx-1 overflow-x-auto">
                <table class="w-full text-[12.5px] border-collapse">
                  <thead>
                    <tr>
                      {#each block.headers as h}
                        <th class="text-left font-medium text-gray-400 text-[11.5px] px-2.5 pb-2 border-b border-gray-200">{h}</th>
                      {/each}
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-gray-100">
                    {#each block.rows as row}
                      <tr>
                        {#each row as cell}
                          <td class="px-2.5 py-2.5 align-top help-html">{@html cell}</td>
                        {/each}
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            {/if}
          {/each}

          {#if others.length}
            <div class="mt-10 pt-5 border-t border-gray-100">
              <div class="text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-400 mb-2.5">
                {m.help?.otherTopics ?? "Andere onderwerpen"}
              </div>
              <div class="grid grid-cols-2 gap-x-6 gap-y-1.5">
                {#each others as s}
                  <button
                    type="button"
                    class="text-left text-[13px] text-gray-500 hover:text-gray-900 transition-colors truncate"
                    on:click={() => go(s.topic)}
                  >{s.title}</button>
                {/each}
              </div>
            </div>
          {/if}
        {/if}
      </div>
    </aside>
  </div>
{/if}

<style>
  .help-html :global(a) {
    color: inherit;
    text-decoration: underline;
    text-underline-offset: 2px;
    text-decoration-color: #d1d5db;
  }
  .help-html :global(a:hover) {
    text-decoration-color: currentColor;
  }
  .help-html :global(strong) {
    color: #111827;
    font-weight: 600;
  }
  .help-html :global(code) {
    background: #f3f4f6;
    border-radius: 4px;
    padding: 1px 4px;
    font-size: 0.9em;
  }
</style>
