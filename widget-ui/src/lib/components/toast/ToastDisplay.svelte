<script lang="ts">
  import { toast } from './toast';
  import { fly } from 'svelte/transition';

  const messages = toast.messages;

  function runAction(id: number, onClick: () => void) {
    try { onClick(); } finally { toast.remove(id); }
  }
</script>

<div class="fixed bottom-4 right-4 z-[200] space-y-3 max-w-sm w-full px-4">
  {#each $messages as t (t.id)}
    <div
      transition:fly={{ y: 20, opacity: 0, duration: 300 }}
      class="relative bg-white/90 backdrop-blur-md border border-gray-200 rounded-xl shadow-xl px-4 py-3 text-gray-800 font-semibold text-sm overflow-hidden flex items-center gap-3"
    >
      <!-- Click-to-dismiss only on the message body, not the whole toast — otherwise
           the action button's click would bubble up and also dismiss the toast before
           the action runs (the runAction call below removes the toast explicitly). -->
      <button
        type="button"
        class="flex-1 text-left bg-transparent border-0 p-0 m-0 font-semibold text-sm text-gray-800 cursor-pointer"
        on:click={() => toast.remove(t.id)}
      >{t.message}</button>

      {#if t.action}
        <button
          type="button"
          class="shrink-0 text-blue-600 hover:text-blue-700 text-xs font-medium uppercase tracking-wide"
          on:click|stopPropagation={() => runAction(t.id, t.action!.onClick)}
        >{t.action.label}</button>
      {/if}

      <!-- Bar duration must match the toast's TTL — actionable toasts live 6s, plain
           toasts 3s. Pass the duration through a CSS variable so the animation lines up. -->
      <div
        class="absolute bottom-0 left-0 h-1 bg-gradient-to-r from-primary to-secondary animate-toast-timer"
        style="--toast-duration: {t.action ? '6s' : '3s'};"
      ></div>
    </div>
  {/each}
</div>

<style>
  .animate-toast-timer {
    animation: toastTimer var(--toast-duration, 3s) linear forwards;
  }

  @keyframes toastTimer {
    from { width: 100%; }
    to { width: 0%; }
  }
</style>
