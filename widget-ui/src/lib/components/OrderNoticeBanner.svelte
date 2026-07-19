<!-- Geport uit v1 src/lib/components/OrderNoticeBanner.svelte. Wijzigingen: geen —
     localStorage-toegang zit al achter typeof window-guards (SSR-veilig). -->
<script lang="ts">
  export let text = "";
  export let title = "Geplande onderbreking";
  export let variant: "warning" | "danger" | "info" | "success" = "warning";
  export let persistKey = "";

  let dismissed = false;

  function hashString(value: string) {
    let h = 2166136261;
    for (let i = 0; i < value.length; i++) {
      h ^= value.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }

  $: storageKey =
    persistKey || `plugtech:notice:${hashString(`${variant}:${text}`)}`;

  $: if (typeof window !== "undefined" && text) {
    dismissed = localStorage.getItem(storageKey) === "1";
  }

  function dismiss() {
    dismissed = true;
    if (typeof window !== "undefined") {
      localStorage.setItem(storageKey, "1");
    }
  }
</script>

{#if text && !dismissed}
  <div class={`notice notice--${variant}`} role="alert" aria-live="polite">
    <div class="notice__accent"></div>

    <div class="notice__icon-wrap" aria-hidden="true">
      <svg class="notice__icon" viewBox="0 0 24 24" fill="none">
        <path
          d="M12 8v5"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
        />
        <circle cx="12" cy="16.5" r="1.1" fill="currentColor" />
        <path
          d="M10.29 3.86L1.82 18a2 2 0 0 0 1.72 3h16.92a2 2 0 0 0 1.72-3L13.71 3.86a2 2 0 0 0-3.42 0Z"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linejoin="round"
        />
      </svg>
    </div>

    <div class="notice__body">
      <div class="notice__title">{title}</div>
      <div class="notice__text">{text}</div>
    </div>

    <button
      type="button"
      class="notice__close"
      on:click={dismiss}
      aria-label="Sluiten"
      title="Sluiten"
    >
      <svg viewBox="0 0 24 24" fill="none" class="notice__close-icon">
        <path
          d="M6 6l12 12M18 6L6 18"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
        />
      </svg>
    </button>
  </div>
{/if}

<style>
  .notice {
    --bg: #fffaf0;
    --border: #f4d7a1;
    --accent: #d97706;
    --title: #9a3412;
    --text: #7c2d12;
    --icon-bg: #ffedd5;
    --icon: #c2410c;

    position: relative;
    display: flex;
    align-items: flex-start;
    gap: 12px;
    width: 100%;
    min-height: 56px;
    padding: 12px 14px 12px 0;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--bg);
    box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
    overflow: hidden;
  }

  .notice--danger {
    --bg: #fef2f2;
    --border: #fecaca;
    --accent: #dc2626;
    --title: #991b1b;
    --text: #7f1d1d;
    --icon-bg: #fee2e2;
    --icon: #dc2626;
  }

  .notice--info {
    --bg: #eff6ff;
    --border: #bfdbfe;
    --accent: #2563eb;
    --title: #1d4ed8;
    --text: #1e3a8a;
    --icon-bg: #dbeafe;
    --icon: #2563eb;
  }

  .notice--success {
    --bg: #ecfdf5;
    --border: #bbf7d0;
    --accent: #16a34a;
    --title: #166534;
    --text: #14532d;
    --icon-bg: #dcfce7;
    --icon: #16a34a;
  }

  .notice__accent {
    width: 4px;
    align-self: stretch;
    background: var(--accent);
    flex: 0 0 4px;
  }

  .notice__icon-wrap {
    margin-top: 1px;
    width: 32px;
    height: 32px;
    border-radius: 9999px;
    background: var(--icon-bg);
    color: var(--icon);
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
  }

  .notice__icon {
    width: 18px;
    height: 18px;
  }

  .notice__body {
    flex: 1 1 auto;
    min-width: 0;
    padding-top: 1px;
  }

  .notice__title {
    font-size: 12px;
    line-height: 1.2;
    font-weight: 700;
    color: var(--title);
    margin-bottom: 4px;
  }

  .notice__text {
    font-size: 12.5px;
    line-height: 1.45;
    color: var(--text);
  }

  .notice__close {
    width: 28px;
    height: 28px;
    margin: -2px 0 0 0;
    border: 0;
    background: transparent;
    color: rgba(120, 53, 15, 0.72);
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex: 0 0 auto;
  }

  .notice__close:hover {
    background: rgba(255, 255, 255, 0.55);
  }

  .notice__close-icon {
    width: 14px;
    height: 14px;
  }
</style>
