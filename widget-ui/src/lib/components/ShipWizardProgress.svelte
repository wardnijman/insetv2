<script lang="ts">
  // Minimal Wise-style stepper: one thin bar segment per visible step, filled up
  // to and including the current step, with the step name underneath. Same props
  // as the old truck/icon progress bar, so the modal wiring is unchanged.
  //
  // All styling is Svelte-scoped (hashed selectors): the widget runs inside the
  // TFF host page, where generic utility class names can collide with host CSS.
  import type { Readable, Writable } from "svelte/store";

  export let step: Writable<number>;
  export let steps: Readable<string[]>;

  const goToStep = (i: number) => step.set(i);
</script>

<!-- Bewust een div met role="navigation" en GEEN <nav>: TFF's host-CSS styled
     het element-type nav (hun zijbalk: position:fixed, 100vh, wit) en dat zou
     onze stepper overnemen. Een div ontsnapt aan alle element-selectors. -->
<div class="stepper" role="navigation" aria-label="Stappen">
  {#each $steps as label, i}
    <button
      type="button"
      class="seg"
      class:done={i < $step}
      class:current={i === $step}
      aria-current={i === $step ? "step" : undefined}
      on:click={() => goToStep(i)}
    >
      <span class="bar"></span>
      <span class="label">{label}</span>
    </button>
  {/each}
</div>

<style>
  .stepper {
    /* Alle layout-kritieke props expliciet: host-CSS van de TFF-pagina styled
       generieke selectors en mag hier nooit vat op krijgen. */
    display: flex;
    position: static;
    inset: auto;
    gap: 8px;
    width: 100%;
    max-width: 680px;
    height: auto;
    margin: 0 auto;
    padding: 0;
    background: transparent;
    border: 0;
    overflow: visible;
    text-align: initial;
    z-index: auto;
  }

  .seg {
    flex: 1;
    min-width: 0;
    border: 0;
    background: none;
    padding: 0 0 2px;
    cursor: pointer;
    font-family: inherit;
    text-align: center;
  }

  .bar {
    display: block;
    height: 3px;
    border-radius: 2px;
    background: #e5e7eb;
    transition: background 0.15s ease;
  }

  .seg.done .bar,
  .seg.current .bar {
    background: #2563eb;
  }

  .label {
    display: block;
    margin-top: 8px;
    font-size: 12.5px;
    color: #9ca3af;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    transition: color 0.15s ease;
  }

  .seg.done .label {
    color: #6b7280;
  }

  .seg.current .label {
    color: #111827;
    font-weight: 600;
  }

  .seg:hover .label {
    color: #374151;
  }

  .seg:focus-visible .bar {
    outline: 2px solid #2563eb;
    outline-offset: 3px;
  }

  @media (prefers-reduced-motion: reduce) {
    .bar,
    .label {
      transition: none;
    }
  }
</style>

