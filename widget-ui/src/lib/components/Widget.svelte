<!-- Geport uit v1 src/lib/components/Widget.svelte (500r) op de v2-bedrading — de ROOT:
     prefs/taal-boot, orderlijst + wizard-wissel (wizard rendert INLINE in de orders-root,
     overview via display:none — zie OrderOverview), sessionStatus/hostNotice, verberg-
     launcher. v1-props (cachedOrders, messages, userPreferences, globalPreferences,
     hostNotice, tffOriginalEls) worden v2: {tenant, provider, hostNotice?, cachedOrders?}
     — messages komen uit de gebundelde catalogus (setLang), prefs uit de proxy
     (POST /api/config/get → cfg.preferences → userPreferences-singleton, fail-soft).

     Bewust NIET geport (TFF-host-injectiemechaniek — de host-adapter is in v2 de seam):
     - installAuthFetch + per-origin fetch-policy: proxy-first, creds leven serverside.
     - script-URL-parsing (userId/token uit de <script src>): komt uit tenant/props.
     - capture/restore van hostpaginastijlen + INSET_PAGE_ZOOM + neutralizeAncestorZoom
       + tffOriginalEls-toggling: hoort bij de embedded host-adapter-slice.
     - de <style>-injectie in document.head (focus-outline-kill): app.css regeert hier.
     Het Verbergen/launcher-patroon (widgetVisibility) blijft — dat is chrome, geen
     host-mechaniek; bij "embedded" toont de launcher straks weer het hostformulier. -->
<script lang="ts">
  import { onMount } from "svelte";
  import type { EnrichedOrder } from "../types/webshop";
  import type { TenantConfig } from "../../../../src/widget/tenant.ts";
  import type { WidgetProviderLayer } from "../providers/types";
  import SvgIcons from "./SvgIcons.svelte";
  import OrderOverview from "./OrderOverview.svelte";
  import OrderNoticeBanner from "./OrderNoticeBanner.svelte";
  import HelpDrawer from "./HelpDrawer.svelte";
  import ToastDisplay from "./toast/ToastDisplay.svelte";
  import { initializePresets } from "../state/presetManager";
  import { orders } from "../state/orders";
  import { apiBaseUrl } from "../api/global";
  import { setLang, type Lang } from "../state/messageStore";
  import { setGlobalPreferences } from "../state/globalPreferences";
  import { setUserPreferences, userPreferences } from "../state/userPreferences";
  import { initAnnouncements } from "../stores/announcements";
  import { sessionStatus } from "../state/sessionStatus";
  import {
    widgetHidden,
    initWidgetVisibility,
    hideWidget,
    showWidget,
  } from "../state/widgetVisibility";
  import { shipWizardOpen } from "../state/wizardOpen";

  type HostNoticeVariant = "warning" | "danger" | "info" | "success";
  type HostNotice = {
    text: string;
    variant: HostNoticeVariant;
  } | null;

  export let tenant: TenantConfig;
  export let provider: WidgetProviderLayer;
  export let hostNotice: HostNotice = null;
  /** Host-geïnjecteerde orders (embedded modus) — hebben voorrang op de fetch (v1-gedrag). */
  export let cachedOrders: EnrichedOrder[] | null = null;
  /** Interim: v2-tenancy koppelt dit aan het boekaccount; default het tenant-id. */
  export let userId: string = "";
  /** Auth-token voor deep links (ConfigButton, ShipStepBlock-hint). Optioneel. */
  export let token: string = "";

  const uid = userId || tenant.id;

  if (cachedOrders && cachedOrders.length > 0) {
    orders.set(cachedOrders);
  }

  // Prefs/taal-boot — v1 kreeg messages/userPreferences/globalPreferences als props van
  // de scriptlader; v2 haalt ze uit de proxy en is daar fail-soft op: zonder config
  // draait de widget op de NL-catalogus + lege prefs (zelfde patroon als
  // PackageTableStepBlock's per-component config-load, maar dan één keer aan de root).
  onMount(() => {
    initWidgetVisibility(uid);
    void (async () => {
      try {
        const res = await fetch(`${apiBaseUrl}/api/config/get`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: uid }),
        });
        if (res.ok) {
          const cfg = await res.json();
          const prefs = cfg?.preferences ?? {};
          setUserPreferences({ ...(userPreferences ?? {}), ...prefs });
          setGlobalPreferences(cfg?.globalPreferences ?? {});
          if (prefs.language) setLang(prefs.language as Lang);
        }
      } catch {
        // fail-soft: boot-defaults (NL, lege prefs) blijven staan
      }
      // Seed the dismissed-announcements set from the just-installed userPreferences so
      // every balloon that mounts later sees an accurate "already dismissed" map.
      initAnnouncements();
    })();
    void initializePresets(uid);
  });

  // Count of orders still to process (no shipment yet / status NEW) — shown on the launcher so
  // the re-entry point reflects the open work, not a brand name.
  $: newOrderCount = ($orders ?? []).filter((o) => {
    const s = (o as any)?.shipment?.status;
    return !s || s === "NEW";
  }).length;
</script>

<SvgIcons />
<!-- Eén ToastDisplay/HelpDrawer tegelijk: de WizardShell rendert z'n eigen exemplaar,
     dus de root-instantie wijkt zolang de wizard open staat (anders dubbele toasts). -->
{#if !$shipWizardOpen}
  <ToastDisplay />
  <HelpDrawer />
{/if}

{#if !$widgetHidden}
<div class="widget-page">
  <div class="widget-card">
    <!-- Topbar verdwijnt zolang de wizard open is: die heeft zijn eigen headerbalk,
         en twee gestapelde chrome-regels boven het formulier oogt rommelig. -->
    {#if !$shipWizardOpen}
      <div class="widget-topbar">
        <button
          type="button"
          class="widget-topbar__hide"
          on:click={hideWidget}
          title="Verbergen — terug naar het eigen scherm van de host"
        >
          Verbergen
        </button>
      </div>
    {/if}

    {#if $sessionStatus === "logged_out"}
      <!-- TODO(order-flow): in v2 leeft de portaalsessie serverside (pool + auto-relogin);
           dit banner-pad wacht op een logged-out-signaal van de proxy. Chrome is v1. -->
      <div class="session-banner" role="alert">
        <span class="session-banner__text">
          <strong>Je bent uitgelogd bij het portaal.</strong> Log opnieuw in om verder te gaan —
          acties zoals tarieven ophalen werken nu niet.
        </span>
      </div>
    {/if}

    {#if hostNotice?.text}
      <div class="widget-banner-slot">
        <OrderNoticeBanner
          text={hostNotice.text}
          variant={hostNotice.variant}
          title="Planned interruption"
          persistKey={`plugtech:host-notice:${uid}:${hostNotice.text}`}
        />
      </div>
    {/if}

    <div class="widget-shell">
      <OrderOverview {tenant} {provider} userId={uid} {token} />
    </div>
  </div>
</div>
{:else}
  <button
    type="button"
    class="inset-launcher"
    on:click={showWidget}
    aria-label={`Overzicht orders openen${newOrderCount > 0 ? ` — ${newOrderCount} nieuw` : ""}`}
  >
    <span class="inset-launcher__label">Overzicht orders</span>
    {#if newOrderCount > 0}
      <span class="inset-launcher__badge">{newOrderCount > 99 ? "99+" : newOrderCount}</span>
    {/if}
    <span class="inset-launcher__chevron" aria-hidden="true">›</span>
  </button>
{/if}

<style>
  /* v1 zette hier ook html.inset-active { background: white } — dat hoort bij de
     hostpagina-styling die met de embedded host-adapter-slice meekomt. */
  .widget-page {
    width: 100%;
    max-width: 100%;
  }

  .widget-card {
    width: 100%;
    background: white;
    border-radius: 12px;
    overflow: hidden;
  }

  .widget-banner-slot {
    margin: 0;
  }

  .widget-topbar {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding: 8px 16px;
    border-bottom: 1px solid #f1f5f9;
  }

  .widget-topbar__hide {
    appearance: none;
    border: 0;
    background: transparent;
    color: #94a3b8;
    font-size: 12px;
    padding: 4px 8px;
    border-radius: 6px;
    cursor: pointer;
  }

  .widget-topbar__hide:hover {
    color: #475569;
    background: #f1f5f9;
  }

  /* Calm, user-initiated re-entry launcher. Only rendered while the user has hidden Inset;
     never animates or pops up on its own. Quiet white pill — professional, not a chat bubble. */
  .inset-launcher {
    position: fixed;
    right: 20px;
    bottom: 20px;
    z-index: 2147483000;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 10px 18px;
    border: 1px solid #e2e8f0;
    border-radius: 9999px;
    background: #ffffff;
    color: #1e293b;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    box-shadow: 0 6px 20px rgba(15, 23, 42, 0.12);
    transition:
      box-shadow 0.15s ease,
      border-color 0.15s ease;
  }

  .inset-launcher:hover {
    border-color: #cbd5e1;
    box-shadow: 0 8px 24px rgba(15, 23, 42, 0.16);
  }

  .inset-launcher__badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 20px;
    height: 20px;
    padding: 0 6px;
    border-radius: 9999px;
    background: #2563eb;
    color: #fff;
    font-size: 11px;
    font-weight: 700;
    line-height: 1;
  }

  .inset-launcher__chevron {
    font-size: 16px;
    line-height: 1;
    color: #94a3b8;
  }

  .session-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    background: #fef3c7;
    border-bottom: 1px solid #fcd34d;
    color: #92400e;
    padding: 10px 16px;
    font-size: 13px;
    line-height: 1.4;
  }

  .session-banner__text {
    flex: 1 1 auto;
    min-width: 0;
  }

  .widget-shell {
    width: 100%;
    overflow-x: auto;
    background: white;
    padding: 0 16px 16px 16px;
    box-sizing: border-box;
  }

  .widget-banner-slot :global(.notice) {
    border-radius: 0;
    border-left: 0;
    border-right: 0;
    border-top: 0;
    margin: 0;
  }
</style>
