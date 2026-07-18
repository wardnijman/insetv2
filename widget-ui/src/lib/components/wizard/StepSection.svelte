<script lang="ts">
  // Shared section wrapper for wizard steps: small-caps label + hairline rule,
  // optional actions on the right, rows stacked in the body. Styling is
  // Svelte-scoped so nothing can collide with TFF host-page CSS.
  export let label: string;
</script>

<section class="step-section">
  <div class="head">
    <span class="lbl">{label}</span>
    <span class="rule"></span>
    <slot name="actions" />
  </div>
  <div class="body">
    <slot />
  </div>
</section>

<style>
  .step-section {
    margin-bottom: 20px;
  }

  .step-section:last-child {
    margin-bottom: 0;
  }

  .head {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 10px;
  }

  .lbl {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.11em;
    text-transform: uppercase;
    color: #9ca3af;
    white-space: nowrap;
  }

  .rule {
    flex: 1;
    height: 1px;
    background: #f0f1f4;
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
</style>
