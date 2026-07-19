<!-- Geport uit v1 src/lib/components/announcements/AnnouncementBalloon.svelte.
     Wijzigingen: geen. (Momenteel zonder consument — v1 had 'm ook standalone klaarstaan;
     de dismiss-keten loopt via stores/announcements → proxy-config.) -->
<script lang="ts">
  /**
   * Announcement balloon — restrained, typographic companion hint anchored to a single
   * trigger element. Visual model is Linear / Stripe / Vercel onboarding tooltips:
   * heading, body, one ghost CTA. No badge, no close ×. The CTA itself dismisses.
   *
   * Multi-step variant: pass `step={{ current: 1, total: 3 }}` and the action row shows
   * a "1 / 3" indicator on the left next to the CTA. Single-shot balloons omit it.
   *
   * Wraps the slot so the balloon positions absolutely off this anchor wrapper — the
   * consumer just nests their trigger inside:
   *
   *   <AnnouncementBalloon {userId} id="..." title="..." body="..." order={1}>
   *     <SomeButton />
   *   </AnnouncementBalloon>
   */

  import { onDestroy, onMount } from "svelte";
  import {
    activeAnnouncementId,
    dismiss,
    isDismissed,
    register,
    unregister,
  } from "../../stores/announcements";

  export let userId: string;
  export let id: string;
  export let order = 100;
  export let title: string;
  export let body: string = "";
  /** Optional category badge rendered above the title (e.g. NIEUW, BÈTA, TIP). Title
   *  should describe the feature itself — don't repeat the badge word in the title. */
  export let badge: string | null = null;
  /** Where the balloon hangs off the trigger. The arrow flips accordingly. */
  export let placement: "bottom-start" | "bottom-end" | "top-start" | "top-end" = "bottom-end";
  /** Delay before first appearance — lets the host page settle on initial load so the
   *  balloon doesn't fight a layout shift. */
  export let delayMs: number = 350;
  /** CTA label. The CTA also dismisses — there is no separate close button. */
  export let cta: string = "Begrepen";
  /** Optional progress for a guided tour, e.g. `{ current: 1, total: 3 }`. */
  export let step: { current: number; total: number } | null = null;

  let ready = false;
  let registered = false;

  onMount(() => {
    if (isDismissed(id)) return; // never register: nothing will ever show this
    register({ id, order });
    registered = true;
    const t = setTimeout(() => (ready = true), Math.max(0, delayMs));
    return () => clearTimeout(t);
  });

  onDestroy(() => {
    if (registered) unregister(id);
  });

  $: visible = ready && registered && $activeAnnouncementId === id;

  function onDismiss() {
    dismiss(userId, id);
  }

  // Positioning class for the balloon container.
  $: posClass = (
    {
      "bottom-start": "left-0 top-full mt-2",
      "bottom-end":   "right-0 top-full mt-2",
      "top-start":    "left-0 bottom-full mb-2",
      "top-end":      "right-0 bottom-full mb-2",
    } as const
  )[placement];

  // Arrow nub — sits on the side of the balloon facing the anchor.
  $: arrowClass = (
    {
      "bottom-start": "top-[-4px] left-4",
      "bottom-end":   "top-[-4px] right-4",
      "top-start":    "bottom-[-4px] left-4",
      "top-end":      "bottom-[-4px] right-4",
    } as const
  )[placement];
</script>

<!-- Wrapper is a relative-positioned inline-flex so the balloon can anchor off it without
     disturbing the slot's natural layout. Uses <div> (not <span>) so block-level children
     stay valid HTML. -->
<div class="anno-anchor">
  <slot />

  {#if visible}
    <div
      class="anno-balloon {posClass} bg-white border border-neutral-200 rounded-lg shadow-sm"
      role="dialog"
      aria-labelledby="anno-title-{id}"
    >
      <span class="anno-arrow {arrowClass}" aria-hidden="true"></span>

      {#if badge}
        <!-- 10px / 600 / uppercase / tracking 0.04em / blue-100 on blue-700 / 2×6px / r-4 -->
        <div class="mb-1.5">
          <span class="inline-block rounded-[4px] bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.04em] leading-none text-blue-700">
            {badge}
          </span>
        </div>
      {/if}

      <div
        id="anno-title-{id}"
        class="text-sm font-semibold leading-tight text-neutral-900"
      >
        {title}
      </div>

      {#if $$slots.body || body}
        <p class="mt-1.5 text-[13px] leading-[1.5] text-neutral-600">
          {#if $$slots.body}
            <slot name="body" />
          {:else}
            {body}
          {/if}
        </p>
      {/if}

      <!-- Action row: optional step indicator on the left, ghost CTA on the right. When
           there's no step, we still render an empty span so the CTA pins to the right
           via justify-between without needing a separate layout case. -->
      <div class="mt-2 flex items-center justify-between">
        {#if step}
          <span class="text-[12px] text-neutral-400 tabular-nums">
            {step.current} / {step.total}
          </span>
        {:else}
          <span></span>
        {/if}

        <button
          type="button"
          class="text-[13px] font-medium text-neutral-700 hover:text-neutral-900 transition-colors"
          on:click={onDismiss}
        >{cta}{#if step && step.current < step.total} →{/if}</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .anno-anchor {
    position: relative;
    display: inline-flex;
  }

  .anno-balloon {
    position: absolute;
    z-index: 60;
    width: 280px;
    max-width: calc(100vw - 32px);
    padding: 12px 14px;
    /* shadow-sm via Tailwind handles the outer shadow; this keeps it intentionally
       restrained so the border carries most of the visual weight. */
    animation: anno-pop 200ms ease-out;
  }

  /* Arrow is a rotated square; we colour two adjacent borders to match the balloon's
     edge that the arrow visually extends. */
  .anno-arrow {
    position: absolute;
    width: 8px;
    height: 8px;
    background: #ffffff;
    transform: rotate(45deg);
    /* Default = bottom placement (arrow at top of balloon): show top-left borders. */
    border-left: 1px solid rgb(229 229 229);
    border-top: 1px solid rgb(229 229 229);
  }
  :global(.anno-balloon[class*="bottom-full"]) .anno-arrow {
    /* Top placement (arrow at bottom of balloon): show bottom-right borders instead. */
    border-left: none;
    border-top: none;
    border-right: 1px solid rgb(229 229 229);
    border-bottom: 1px solid rgb(229 229 229);
  }

  @keyframes anno-pop {
    from {
      opacity: 0;
      transform: translateY(-2px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
</style>
