<script lang="ts">
    export let colsClass: string = "md:grid-cols-[1fr_1fr_auto]";
    export let minHeight: string = "auto";
  </script>
  
  <div
    class={`grid gap-x-6 gap-y-4 items-start ${colsClass}`}
    style="min-height: {minHeight};"
  >
    <slot />
  </div>
  