<script lang="ts">
    export let columns: number = 2; // of 3
  </script>
  
  <div class={`grid gap-x-6 gap-y-4 max-w-screen-lg mx-auto text-sm text-gray-800 ${columns === 3 ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
    <slot name="col1" />
    <slot name="col2" />
    {#if columns === 3}
      <slot name="col3" />
    {/if}
  </div>
