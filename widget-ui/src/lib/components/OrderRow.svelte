<!-- Geport uit v1 src/lib/components/OrderRow.svelte. Wijzigingen:
     1) TODO(order-flow): v1's onMount-poll via steps/getShipmentDetails (rechtstreeks
        tffxpress.com) is uitgeschakeld — portaalverkeer loopt in v2 via de proxy en
        die heeft nog geen shipment-details-route. Het patchShipment-event blijft in
        het contract staan zodat de poll er later 1-op-1 in terug kan.
     2) hasAutomation leest de userPreferences-singleton zoals v1; automation-runner
        zelf is TODO(order-flow), de knop-splitsing (pencil + ⚡truck) rendert al
        v1-getrouw op basis van de server-side shipReadiness.
     Verder verbatim (labels, pill-kleuren, grid-layout, iconografie). -->
<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import type { Writable } from "svelte/store";
  import type { EnrichedOrder, WebshopOrderShipmentInfo } from "../types/webshop";
  import { formatDate } from "../utils/utils";
  import { m } from "../state/messageStore";
  import { img } from "../utils/img";
  import { carrierLogoUrl, formatServiceName, serviceLogoUrl } from "../utils/carrierLogo";
  import type { Columns } from "../state/orderViewColumns";
  import { printPDFBinary } from "../print/printPDFBinary";
  import OrderRowErrorPopover from "./OrderRowErrorPopover.svelte";
  import { userPreferences } from "../state/userPreferences";
  import { apiBaseUrl } from "../api/global";

  // True when the user has configured at least one enabled automation rule, or any "skip step"
  // toggle in widgetBehavior. That's the signal that "auto" can meaningfully do something
  // different from a manual walk-through, so the ship action splits into two buttons. With
  // nothing configured both buttons would behave identically — keep the single icon button.
  const hasAutomation = (() => {
    const rules: any[] = userPreferences?.automationRules ?? [];
    if (rules.some((r) => r?.enabled)) return true;
    const wb = (userPreferences?.widgetBehavior ?? {}) as Record<string, unknown>;
    return !!(wb.skipSenderIfComplete || wb.skipReceiverIfFilled || wb.skipPackagesIfAutomated);
  })();

  let {
    order,
    columns,
    needsExtraInfo = false,
    attentionReason = "",
    jobState = null,
    canFullyAutoShip = false,
    autoExceptRate = false,
    selected = false,
  }: {
    order: EnrichedOrder;
    columns: Writable<Columns>;
    needsExtraInfo?: boolean;
    attentionReason?: string;
    /** Live state of this order's headless-shipment-queue job, if any. */
    jobState?: { status: string; reason?: string | null; lastError?: string | null; missingFields?: string[] | null } | null;
    /** True when the readiness check returned "ready" — preflight passes AND a rate-selection
     *  rule resolves. The order will ship without ever bouncing for input → render a small
     *  ⚡ badge on the auto button so the user knows clicking it is a one-shot. */
    canFullyAutoShip?: boolean;
    /** True when the readiness check returned "no_rule" — everything is automated EXCEPT rate
     *  selection (no rate-selection rule). */
    autoExceptRate?: boolean;
    /** This order's row is part of the user's current multi-select. Drives the leading checkbox. */
    selected?: boolean;
  } = $props();

  // Map a (technical) headlessShip reason onto a short label shown in the order row.
  // The full reason stays available as the badge's title attribute.
  function attentionLabel(reason: string): string {
    // Preflight can bundle several steps that need input ("a • b • c") — show the first step's
    // short label plus a "+N" so the user sees there's more than one thing to do.
    const parts = (reason || "").split(" • ").map((p) => p.trim()).filter(Boolean);
    if (parts.length > 1) return `${attentionLabel(parts[0])} +${parts.length - 1}`;
    const r = (reason || "").toLowerCase();
    if (r.includes("controleer in tff") || r.includes("controleer bij de vervoerder") || r.includes("mogelijk wel aangemaakt")) return "Controleer bij de vervoerder";
    // Upstream / carrier-side rejections MUST be caught before any field-level matchers below.
    if (
      r.startsWith("verzenden mislukt") ||
      r.includes("wees de zending af") || r.includes("wees de servicekeuze af") ||
      r.includes("cvc-complex-type") || r.includes("process failure") || r.includes("process id associated") || /\b99[89]\b/.test(r) ||
      r.includes("chooseoption failed") || r.includes("submission failed") || r.includes("headless ship error") ||
      r.includes("tff wees de zending af") || r.includes("tff wees de servicekeuze af") || r.includes("delivery address")
    ) return "Verzenden mislukt";
    // Field-level fixes the user can make in the wizard.
    if (r.includes("longer than") || r.includes("te lang") || r.includes("max_length") || (r.includes("contact person") && r.includes("characters"))) return "Naam/veld te lang";
    if (r.includes("totalshipmentvalue") || r.includes("douanewaarde")) return "Douanewaarde nodig";
    if (
      /^product\s.+:/.test(r) ||
      r.includes("hs-code") || r.includes("hs code") || r.includes("goederencode") ||
      r.includes("waarde moet groter") || r.includes("gewicht moet groter") || r.includes("aantal moet") ||
      r.includes("herkomstland") || r.includes("valuta ontbreekt") || r.includes("beschrijving ontbreekt") ||
      r.includes("productgegevens") || r.includes("export") ||
      (r.includes("product") && (r.includes("ongeldig") || r.includes("invalid")))
    ) return "Exportinfo";
    if (r.includes("recipientaddress_region") || r.includes("region")) return "Regio/staat nodig";
    if (r.includes("requires manual input")) return "Extra invoer nodig";
    if (r.includes("step requires user input: receiver")) return "Ontvanger controleren";
    if (r.includes("step requires user input")) return "Invoer nodig";
    if (r.includes("no rate matched") || r.includes("no rate_selection") || r.includes("geen automatische servicekeuze") || r.includes("kies een verzendservice") || r.includes("geen tarief matchte") || r.includes("gekozen service is niet meer beschikbaar")) return "Kies een service";
    if (r.includes("geen tarieven terug") || r.includes("tff gaf geen tarieven")) return "Tarieven tijdelijk weg";
    if (r.includes("bekend verzendformulier") || r.includes("bekend tff-formulier") || r.includes("verzendformulier bekend")) return "Geen tarief beschikbaar";
    if (r.includes("no rates")) return "Geen tarieven";
    if (r.includes("getrates failed") || r.includes("rate fetch")) return "Tarieven mislukt";
    if (r.includes("not ready") || r.includes("packages/addresses")) return "Adres/verpakking incompleet";
    // Pre-rate preflight reasons (already Dutch) — show a short form of them.
    if (r.includes("ontvanger")) return "Ontvanger";
    if (r.includes("afzender")) return "Afzender controleren";
    if (r.includes("verpakking")) return "Verpakking";
    if (r.includes("adres of verpakking")) return "Adres/verpakking incompleet";
    return "Actie nodig";
  }

  // How many things still need filling before this order can ship — the preflight bundles its
  // per-step reasons with " • ", and queue jobs carry a missingFields list. Shown as a neutral
  // "N ontbrekend" badge; the actual details live in the badge's title/tooltip.
  function missingCount(reason?: string | null, fields?: string[] | null): number {
    if (Array.isArray(fields) && fields.length) return fields.length;
    const n = (reason || "").split(" • ").map((p) => p.trim()).filter(Boolean).length;
    return n > 0 ? n : 1;
  }

  // Colour for a queue-job pill, keyed on the short attentionLabel. Hard failures (the carrier
  // rejected it, getRates broke) → red; anything the user can fix in the wizard → amber.
  const PILL_RED = "bg-red-50 text-red-700 ring-1 ring-red-200";
  const PILL_AMBER = "bg-amber-50 text-amber-800 ring-1 ring-amber-200";
  const RED_LABELS = new Set(["Verzenden mislukt", "Controleer bij de vervoerder", "Tarieven mislukt"]);
  function attentionColorClass(label: string): string {
    return RED_LABELS.has(label) ? PILL_RED : PILL_AMBER;
  }

  const dispatch = createEventDispatcher<{
    /** Default ship action — uses the configured automation flow. The single icon-truck
     *  button (no automation configured) also dispatches this. */
    manualShip: void;
    /** "Handmatig" — force the wizard open step-by-step, every step rendered (sender excepted
     *  when already valid). */
    forceManualShip: void;
    /** User toggled the leading-checkbox on/off. Parent owns the Set. */
    toggleSelect: void;
    voidOrder: void;
    /** User clicked the "ArchiveRestore" icon on a Gearchiveerd row. */
    restoreOrder: void;
    deleteShipment: void;
    resolveJob: void;
    /** User printed this row's label via the row-level print button. */
    printed: void;
    patchShipment: {
      orderId: EnrichedOrder["orderId"];
      patch: Partial<WebshopOrderShipmentInfo>;
    };
  }>();

  const STATUS_COL_PX = 116;

  let expanded = $state(false);
  let printing = $state(false);
  let errorOpen = $state(false);
  let errorAnchor = $state<HTMLElement | null>(null);

  type Status =
    | "NEW"
    | "CREATED"
    | "AFGEROND"
    | "SHIPPED"
    | "CANCELED"
    | "UNPLANNED"
    | "FAILED"
    | "CREATING";

  const statusToLabelKey: Record<
    Status,
    keyof typeof m.orderOverview.orderState
  > = {
    NEW: "new",
    CREATED: "labelCreated",
    AFGEROND: "afgerond",
    SHIPPED: "shipped",
    CANCELED: "canceled",
    UNPLANNED: "archived",
    FAILED: "failed",
    CREATING: "new",
  };

  const statusToColor: Record<Status, string> = {
    NEW: "bg-gray-100 text-gray-700 ring-1 ring-gray-200",
    CREATED: "bg-blue-50 text-blue-700 ring-1 ring-blue-200",
    AFGEROND: "bg-green-50 text-green-700 ring-1 ring-green-200",
    SHIPPED: "bg-green-50 text-green-700 ring-1 ring-green-200",
    CANCELED: "bg-red-50 text-red-700 ring-1 ring-red-200",
    UNPLANNED: "bg-amber-50 text-amber-800 ring-1 ring-amber-200",
    FAILED: "bg-red-50 text-red-700 ring-1 ring-red-200",
    CREATING: "bg-gray-100 text-gray-700 ring-1 ring-gray-200",
  };

  function normalizeStatus(s?: string): Status {
    const c: Status[] = [
      "NEW",
      "CREATED",
      "AFGEROND",
      "SHIPPED",
      "CANCELED",
      "UNPLANNED",
      "FAILED",
      "CREATING",
    ];
    return c.includes(s as Status) ? (s as Status) : "NEW";
  }

  const status = $derived(() => {
    const base = normalizeStatus(order.shipment?.status);
    // CREATED + printedAt = label is geprint → "Afgerond". Mirrors the server filter
    // logic so the row badge matches the filter bucket the order lives in.
    if (base === "CREATED" && order.shipment?.printedAt) return "AFGEROND" as Status;
    return base;
  });
  const stateLabel = $derived(
    () => m.orderOverview.orderState[statusToLabelKey[status()]]
  );
  const stateColor = $derived(() => statusToColor[status()]);
  const isNieuw = $derived(() => status() === "NEW");
  const isLabelOk = $derived(() => status() === "CREATED" || status() === "AFGEROND");
  const isCanceled = $derived(() => status() === "CANCELED");
  const isUnplanned = $derived(() => status() === "UNPLANNED");
  const isCreating = $derived(() => status() === "CREATING");
  const isFailed = $derived(() => status() === "FAILED");
  // When an order has been re-queued after failing, the order doc may still say "FAILED" while the
  // job is already pending/leased/done. The active job is the truth — show its pill, not the stale
  // "Mislukt" badge. (NEW = never shipped; FAILED = shipped, bounced, and just resubmitted.)
  const isNieuwOrFailed = $derived(() => isNieuw() || isFailed());
  // A queue job stuck in needs_input because the carrier rejected the submit (or it threw) — show
  // it with the same "failed" badge + error popover (full error + retry + Mail) as a real failure.
  const jobIsCarrierFailure = $derived(
    () => jobState?.status === "needs_input" && isNieuwOrFailed() && !!jobState?.reason && attentionLabel(jobState.reason) === "Verzenden mislukt"
  );

  // Order is parked on the "Kies een service" picker — either no rate_selection rule
  // resolved, or the user's earlier pick is no longer available. We deliberately suppress
  // the truck (auto-ship) buttons in the action column for this state.
  const jobIsPickService = $derived(
    () => jobState?.status === "needs_input" && !!jobState?.reason && attentionLabel(jobState.reason) === "Kies een service"
  );
  const errorBodyHtml = $derived(() => order.shipment?.errorMessage || (jobIsCarrierFailure() ? String(jobState?.reason ?? "") : ""));

  // Order is being processed by the queue worker right now. While that's true the action
  // buttons are hidden — another click would either be a no-op toast or risk a double-submit.
  const isQueueInFlight = $derived(
    () => jobState?.status === "pending" || jobState?.status === "leased"
  );

  const customerName = $derived(
    () =>
      [order.shippingAddress?.firstName, order.shippingAddress?.lastName]
        .filter(Boolean)
        .join(" ") ||
      order.shippingAddress?.company ||
      m.orderOverview.orderRow.unknownAddress
  );

  // Width per icon button — must match the `w-N` Tailwind class on `iconBtn` (w-10 = 40px).
  const BTN = 40,
    GAP = 4;
  // Worst-case row layout = 3 icon buttons (⚡ truck + plain truck + archive on a fully-ready
  // row). With `justify-end` on the parent cell, narrower layouts flush right inside the same
  // reserved column width so the rightmost button never jumps horizontally.
  const ACTIONS_COL_PX = BTN + GAP + BTN + GAP + BTN + 16;

  // Fixed-width slot for the leading multi-select checkbox. Lives at the very start of every
  // row so it lines up with the master checkbox in the bulk-action bar above the list.
  const SELECT_COL_PX = 28;

  const gridTemplate = $derived(() => {
    const cols = [
      `${SELECT_COL_PX}px`,
      $columns.platform ? "max-content" : null,
      $columns.company ? "minmax(10rem,1fr)" : null,
      $columns.customer ? "minmax(12rem,1.2fr)" : null,
      $columns.orderNumber ? "minmax(8.5rem,0.8fr)" : null,
      $columns.status ? `${STATUS_COL_PX}px` : null,
      $columns.date ? "minmax(6.5rem,0.7fr)" : null,
      $columns.country ? "minmax(5.5rem,0.6fr)" : null,
      $columns.total ? "minmax(6.5rem,0.7fr)" : null,
      // Carrier is logo-only (h-6 w-10 mark, text is just the no-logo fallback and truncates),
      // so its floor only needs to fit the logo.
      $columns.carrier ? "minmax(3.5rem,0.5fr)" : null,
    ].filter(Boolean) as string[];

    cols.push(`${ACTIONS_COL_PX}px`);
    return cols.join(" ");
  });

  function manualShip() {
    dispatch("manualShip");
  }

  function forceManualShip() {
    dispatch("forceManualShip");
  }

  function voidOrder() {
    dispatch("voidOrder");
  }

  function restoreOrder() {
    dispatch("restoreOrder");
  }

  function deleteShipmentEvt() {
    dispatch("deleteShipment");
  }

  async function printThisLabel() {
    const pdfUrl = order.shipment?.pdfUrl;
    if (!pdfUrl) return;

    // Honor the persisted A4/A6 preference (LabelBasket toggle): in A6 mode the
    // label is cropped+refit server-side before printing. Public endpoint —
    // this fetch carries no app session headers.
    // TODO(order-flow): /integrations/v1/documents/label bestaat nog niet op de proxy;
    // A6 degradeert dan naar een console-fout, A4 print de pdfUrl direct.
    const url =
      (userPreferences?.widgetBehavior as any)?.labelFormat === "a6"
        ? `${apiBaseUrl}/integrations/v1/documents/label?url=${encodeURIComponent(pdfUrl)}&format=a6`
        : pdfUrl;

    try {
      printing = true;
      const res = await fetch(url);
      if (!res.ok) {
        console.error("Kon PDF niet ophalen:", await res.text());
        return;
      }
      const buf = await res.arrayBuffer();
      printPDFBinary(buf);
      dispatch("printed");
    } catch (e) {
      console.error("Fout bij printen:", e);
    } finally {
      printing = false;
    }
  }

  function fmtMoney(n?: number) {
    if (typeof n !== "number") return "";
    try {
      return new Intl.NumberFormat("nl-NL", {
        style: "currency",
        currency: "EUR",
      }).format(n);
    } catch {
      return n.toFixed(2);
    }
  }

  function confirmDeleteShipment() {
    if (confirm("Weet je zeker dat je het label wilt annuleren?")) {
      deleteShipmentEvt();
    }
  }

  $effect(() => {
    if (!isFailed() && !jobIsCarrierFailure() && errorOpen) errorOpen = false;
  });

  // TODO(order-flow): v1 pollde hier in onMount de shipment-details (tracking/status)
  // van CREATED-orders via steps/getShipmentDetails (rechtstreeks portaal) en
  // dispatchte patchShipment. Terugbrengen zodra de proxy een details-route heeft.

  // Carrier column shows only a logo (same TFF-relative image the ship step's rate
  // list uses). TFF-brokered rows name the real carrier in the service ("Ups standard")
  // — prefer that mark over the TFF logo. Falls back to text for carriers we have no
  // logo for, or when the image fails to load.
  const carrierLogo = $derived(
    serviceLogoUrl(order.shipment?.service) ?? carrierLogoUrl(order.shipment?.carrier)
  );
  let carrierLogoBroken = $state(false);

  const iconBase = `platforms/${(order.orderPlatform || "generic").toLowerCase()}.png`;
  const w = 28,
    h = 28,
    fit = "contain" as const;
  const icon1x = img(iconBase, { w, h, fit, format: "png" });
  const icon2x = img(iconBase, { w: w * 2, h: h * 2, fit, format: "png" });

  const iconBtn =
    // `shrink-0` is critical: without it, when the row also renders the "handmatig" text pill
    // the flex container squeezes the icon buttons below their declared w-10.
    "inline-flex shrink-0 items-center justify-center h-7 w-10 rounded-lg border border-gray-200 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/35";
  // The auto / ship button needs `relative` + `overflow-visible` so the small status badge
  // (count circle or ⚡) can sit on the bottom-right corner with a slight outside overhang.
  const autoBtn = `${iconBtn} relative overflow-visible`;

  function onRowClick() {
    expanded = !expanded;
    dispatch("toggleSelect");
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      onRowClick();
      e.preventDefault();
    }
  }

  function stripHtml(raw: string) {
    if (!raw) return "";
    if (typeof document === "undefined") {
      return raw.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    }
    const d = document.createElement("div");
    d.innerHTML = raw;
    return d.textContent || raw;
  }

  const plainError = $derived(() => stripHtml(order.shipment?.errorMessage ?? ""));
</script>

<div
  class="orders-row grid items-center gap-x-3 px-3 py-2.5 border-b border-gray-100 hover:bg-gray-50 focus-within:bg-gray-50 cursor-pointer focus:outline-none min-h-[44px]"
  style={`grid-template-columns:${gridTemplate()}`}
  role="row"
  tabindex="0"
  aria-expanded={expanded}
  aria-selected={selected}
  on:click={onRowClick}
  on:keydown={onKey}
>
  <!-- Leading multi-select checkbox. Native <input type="checkbox"> so screen readers + keyboard
       navigation Just Work; styled subtly so it doesn't shout. -->
  <div role="cell" class="flex items-center justify-center">
    <input
      type="checkbox"
      class="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:outline-none focus:ring-0 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-0 cursor-pointer"
      checked={selected}
      aria-label={selected ? "Selectie uitschakelen" : "Selecteer rij"}
      on:click|stopPropagation
      on:change={() => dispatch("toggleSelect")}
    />
  </div>

  {#if $columns.platform}
    <div
      role="cell"
      class="flex items-center justify-center h-7 w-7 rounded-full bg-gray-100 overflow-hidden"
    >
      <img
        src={icon1x}
        srcset={`${icon1x} 1x, ${icon2x} 2x`}
        sizes="28px"
        alt={(order.orderPlatform || "platform") + " logo"}
        class="block w-5 h-5 object-contain"
        loading="lazy"
        decoding="async"
      />
    </div>
  {/if}

  {#if $columns.company}
    <div role="cell" class="min-w-0 truncate">
      <div
        class="truncate !text-[13px] !leading-[1.2] !text-gray-800"
        title={order.shippingAddress?.company}
      >
        {order.shippingAddress?.company || "—"}
      </div>
    </div>
  {/if}

  {#if $columns.customer}
    <div role="cell" class="truncate">
      <div
        class="font-medium truncate !text-[13px] !leading-[1.2] !text-gray-900"
        title={customerName()}
      >
        {customerName()}
      </div>
      <div
        class="sm:hidden !text-[11px] !leading-[1.2] !text-gray-500 truncate"
      >
        {formatDate(order.createdAt)}{#if order.shippingAddress?.country}
          · {order.shippingAddress.country}{/if}
      </div>
    </div>
  {/if}

  {#if $columns.orderNumber}
    <div role="cell" class="flex items-center min-w-0">
      <span class="tabular-nums !text-[13px] !leading-[1.2] !text-gray-800">
        #{order.orderId}
      </span>
    </div>
  {/if}

  {#if $columns.status}
    <div role="cell" class="status-slot w-[168px] shrink-0">
      {#if jobState?.status === "pending" && isNieuwOrFailed()}
        <span class="inline-flex items-center gap-1 rounded-full px-2 py-[3px] text-[11px] leading-4 bg-gray-50 text-gray-600 ring-1 ring-gray-200 truncate" title="In wachtrij voor verzending">
          In wachtrij
        </span>
      {:else if jobState?.status === "leased" && isNieuwOrFailed()}
        <span class="creating-badge inline-flex items-center gap-1 rounded-full px-2 py-[3px] text-[11px] leading-4 bg-gray-50 text-gray-600 ring-1 ring-gray-200 truncate" title="Zending wordt aangemaakt">
          <span class="dot-spinner" aria-hidden="true"></span>
          Wordt verwerkt
        </span>
      {:else if false && jobState?.status === "done" && isNieuwOrFailed()}
        <!-- "Klaar" / "Label aangemaakt" pill — hidden on request. Branch kept
             (gated with `false &&`) so it's easy to flip back on if we change our mind. -->
        <span class="inline-flex items-center gap-1 rounded-full px-2 py-[3px] text-[11px] leading-4 bg-green-50 text-green-700 ring-1 ring-green-200 truncate" title="Label aangemaakt">
          Klaar
        </span>
      {:else if jobState?.status === "needs_input" && isNieuwOrFailed() && !jobIsCarrierFailure() && attentionLabel(jobState.reason || "") !== "Verpakking"}
        {@const attLabel = attentionLabel(jobState.reason || "")}
        <!-- A non-carrier-failure needs_input job is what the user can actually act on RIGHT
             NOW. It wins over an older FAILED status on the order doc. -->
        <button
          type="button"
          class={`inline-flex items-center gap-1 rounded-full! px-2 py-[3px] text-[11px]! leading-4 hover:brightness-95 truncate ${attentionColorClass(attLabel)}`}
          title={`${jobState.reason || "Actie nodig"} — klik om aan te vullen`}
          on:click|stopPropagation={() => dispatch("resolveJob")}
        >
          {attLabel}
          {#if attLabel === "Kies een service"}
            <span aria-hidden="true" class="opacity-60 text-[12px] leading-none">›</span>
          {/if}
        </button>
      {:else if isFailed() || jobIsCarrierFailure()}
        <button
          bind:this={errorAnchor}
          class="inline-flex items-center gap-1 rounded-full! px-2 py-[3px] text-[11px]! leading-4 bg-red-50 text-red-700 ring-1 ring-red-200"
          aria-haspopup="dialog"
          aria-expanded={errorOpen}
          on:click|stopPropagation={() => (errorOpen = !errorOpen)}
          title={stripHtml(errorBodyHtml()).slice(0, 140)}
        >
          {m.orderOverview.orderState.failed}
          <svg
            class="w-3.5 h-3.5"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              d="M10 2a8 8 0 100 16 8 8 0 000-16zm1 11H9v-2h2v2zm0-4H9V5h2v4z"
            />
          </svg>
        </button>
      {:else if jobState?.status === "abandoned" && isNieuw()}
        <button
          type="button"
          class="inline-flex items-center gap-1 rounded-full! px-2 py-[3px] text-[11px]! leading-4 bg-red-50 text-red-700 ring-1 ring-red-200 truncate"
          title={jobState.lastError ? `Mislukt: ${jobState.lastError}` : "Verzending mislukt"}
          on:click|stopPropagation={() => dispatch("resolveJob")}
        >
          {m.orderOverview.orderState.failed}
        </button>
      {:else if false && needsExtraInfo && isNieuw()}
        <!-- "N ontbrekend" pill — temporarily uitgezet op verzoek. Branch laten staan zodat de
             logica (needsExtraInfo, attentionReason, missingCount) niet doodbloedt. -->
        <span
          class="inline-flex items-center gap-1 rounded-full px-2 py-[3px] text-[11px] leading-4 bg-gray-50 text-gray-600 ring-1 ring-gray-200 truncate"
          title={`${attentionReason || "Nog niet klaar om te verzenden"} — klik op verzenden om in te vullen`}
        >
          {missingCount(attentionReason)} ontbrekend
        </span>
      {:else if !isNieuw() && !isCreating() && order.shipment?.status !== "CREATED"}
        <!-- Generic status badge — used for SHIPPED / CANCELED / UNPLANNED / FAILED. CREATED
             is intentionally excluded so we don't show "Label aangemaakt" next to the print +
             trash icons. UNPLANNED ("Gearchiveerd") drops the pill chrome entirely. -->
        {#if status() === "UNPLANNED"}
          <span class="inline-flex items-center text-[11px] leading-4 text-gray-400 truncate">
            {stateLabel()}
          </span>
        {:else}
          <span
            class={`status-badge inline-flex items-center rounded-full px-2 py-[3px] truncate ${stateColor()}`}
          >
            {stateLabel()}
          </span>
        {/if}
      {:else if isCreating()}
        <span
          class="creating-badge inline-flex items-center gap-1 rounded-full px-2 py-[3px] text-[11px] leading-4 bg-gray-50 text-gray-600 ring-1 ring-gray-200 truncate"
          title="Zending wordt aangemaakt"
        >
          <span class="dot-spinner" aria-hidden="true"></span>
          Wordt verwerkt
        </span>
      {:else}
        <span class="invis-pill">placeholder</span>
      {/if}
    </div>
  {/if}

  {#if $columns.date}
    <div role="cell" class="!text-gray-600 !text-[13px] !leading-[1.2]">
      {formatDate(order.createdAt)}
    </div>
  {/if}

  {#if $columns.country}
    <div
      role="cell"
      class="truncate !text-gray-600 !text-[13px] !leading-[1.2]"
    >
      {order.shippingAddress?.country ||
        m.orderOverview.orderRow.unknownAddress}
    </div>
  {/if}

  {#if $columns.total}
    <div
      role="cell"
      class="tabular-nums !text-gray-700 !text-[13px] !leading-[1.2]"
    >
      {fmtMoney(order.grandTotal)}
    </div>
  {/if}

  {#if $columns.carrier}
    <div
      role="cell"
      class="min-w-0 !text-gray-700 !text-[13px] !leading-[1.2]"
    >
      {#if order.shipment?.carrier || order.shipment?.service}
        {@const hasLogo = !!carrierLogo && !carrierLogoBroken}
        {@const detail = [order.shipment?.carrier, order.shipment?.service]
          .filter(Boolean)
          .join(" · ")}
        <!-- Logo-only: every mark sits bare (no chip, no text) so the column reads as a
             calm strip of brand images; hover the logo for carrier · service detail. -->
        {#if hasLogo}
          <img
            src={carrierLogo}
            alt={detail}
            title={detail}
            class="h-6 w-10 shrink-0 object-contain object-left"
            on:error={() => (carrierLogoBroken = true)}
          />
        {:else}
          <span class="min-w-0 truncate text-[12px] leading-4 text-gray-600" title={detail}>
            {[formatServiceName(order.shipment?.carrier), formatServiceName(order.shipment?.service)]
              .filter(Boolean)
              .join(" · ")}
          </span>
        {/if}
      {:else}
        <span class="text-gray-400">—</span>
      {/if}
    </div>
  {/if}

  <!-- "Remaining steps" amber circle that sits on the bottom-right corner of the truck.
       Only emitted in case B (row not yet fully ready). -->
  {#snippet remainingStepsBadge()}
    {#if needsExtraInfo}
      <span
        class="absolute -bottom-1 -right-1 inline-flex items-center justify-center min-w-[12px] h-[12px] px-[3px] rounded-full bg-amber-50 text-amber-800 ring-1 ring-amber-200 text-[8px] font-semibold leading-none"
        title={`${missingCount(attentionReason)} ontbrekend — klik om in te vullen`}
        aria-label={`${missingCount(attentionReason)} ontbrekend`}
      >{missingCount(attentionReason)}</span>
    {/if}
  {/snippet}

  <div
    role="cell"
    class="flex items-center gap-1 justify-end shrink-0"
    style={`width:${ACTIONS_COL_PX}px`}
  >
    {#if isQueueInFlight()}
      <!-- Queue is mid-flight (pending/leased): suppress the action buttons. -->
    {:else if isNieuw()}
      <!-- Two-truck pattern: when the row is fully ready (canFullyAutoShip) we offer BOTH a
           one-click automated send and a step-by-step wizard walk-through. When it's not yet
           ready, only the single truck shows. Exception: orders parked on "Kies een service"
           get NO truck at all — the action must come from the picker pill. -->
      {#if jobIsPickService()}
        <button
          class={iconBtn}
          title="Wijzig zending · open de wizard met de huidige gegevens"
          on:click|stopPropagation={forceManualShip}
          aria-label="Wijzig zending"
        >
          <!-- Lucide-style pencil-line -->
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="w-4 h-4 text-gray-700"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
          </svg>
        </button>
      {:else if canFullyAutoShip}
        <!-- Edit-icon first, ⚡ truck second — the safer stop-and-confirm option keeps the
             default eye-tracking position. -->
        <button
          class={iconBtn}
          title="Wijzig zending · doorloop de wizard stap voor stap"
          on:click|stopPropagation={forceManualShip}
          aria-label="Wijzig zending · doorloop de wizard stap voor stap"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="w-4 h-4 text-gray-700"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
          </svg>
        </button>
        <button
          class={autoBtn}
          title="Verstuur in één klik · alles is automatisch ingevuld"
          on:click|stopPropagation={manualShip}
          aria-label="Verstuur in één klik"
        >
          <svg class="w-4 h-4 text-gray-700"><use href="#icon-truck" /></svg>
          <svg
            class="absolute -bottom-0.5 -right-0.5 w-3 h-3 text-blue-500 pointer-events-none"
            aria-hidden="true"
          ><use href="#icon-lightning" /></svg>
        </button>
      {:else if autoExceptRate}
        <!-- Everything is automated except the service choice (no rate-selection rule). -->
        <button
          class={iconBtn}
          title="Wijzig zending · doorloop de wizard stap voor stap"
          on:click|stopPropagation={forceManualShip}
          aria-label="Wijzig zending · doorloop de wizard stap voor stap"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="w-4 h-4 text-gray-700"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
          </svg>
        </button>
        <button
          class={autoBtn}
          title="Versturen · kies daarna een service"
          on:click|stopPropagation={manualShip}
          aria-label="Versturen · kies daarna een service"
        >
          <svg class="w-4 h-4 text-gray-700"><use href="#icon-truck" /></svg>
        </button>
      {:else}
        <button
          class={autoBtn}
          title={needsExtraInfo
            ? `${missingCount(attentionReason)} stappen nog nodig · open wizard`
            : "Versturen"}
          on:click|stopPropagation={manualShip}
          aria-label="Versturen"
        >
          <svg class="w-4 h-4 text-gray-700"><use href="#icon-truck" /></svg>
          {@render remainingStepsBadge()}
        </button>
      {/if}
      <button
        class={iconBtn}
        title="Markeer als gearchiveerd"
        on:click|stopPropagation={voidOrder}
        aria-label="Markeer als gearchiveerd"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="w-4 h-4 text-gray-500"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <rect x="3" y="4" width="18" height="4" rx="1" />
          <path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8" />
          <path d="M10 12h4" />
        </svg>
      </button>
    {:else if isCanceled() || isFailed()}
      <!-- Retry path. Same flush-right layout as the success path. -->
      <button
        class={iconBtn}
        title="Probeer opnieuw"
        on:click|stopPropagation={manualShip}
        aria-label="Probeer opnieuw"
      >
        <svg class="w-4 h-4 text-gray-700"><use href="#icon-retry" /></svg>
      </button>
    {:else if isUnplanned()}
      <!-- Archived rows: only an "archive restore" icon. -->
      <button
        class={iconBtn}
        title="Order terugzetten naar actieve lijst"
        on:click|stopPropagation={restoreOrder}
        aria-label="Order terugzetten naar actieve lijst"
      >
        <svg class="w-4 h-4 text-gray-500"><use href="#icon-archive-restore" /></svg>
      </button>
    {/if}

    {#if isLabelOk()}
      <button
        class={`${iconBtn} ${printing ? "opacity-60 pointer-events-none" : ""}`}
        on:click|stopPropagation={printThisLabel}
        title="Label afdrukken"
        aria-label="Label afdrukken"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="w-4 h-4 text-gray-700"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.22"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M6 9V2h12v7" />
          <path
            d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"
          />
          <path d="M6 14h12v8H6z" />
        </svg>
      </button>
      <button
        class={iconBtn}
        on:click|stopPropagation={confirmDeleteShipment}
        title="Label annuleren"
        aria-label="Label annuleren"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="w-4 h-4 text-gray-700"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.22"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M10 11v6" />
          <path d="M14 11v6" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
          <path d="M3 6h18" />
          <path
            d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
          />
        </svg>
      </button>
    {/if}
  </div>
</div>

<OrderRowErrorPopover
  anchorEl={errorAnchor}
  bind:open={errorOpen}
  errorHtml={errorBodyHtml()}
  orderId={order.orderId}
  customer={customerName()}
  createdAt={formatDate(order.createdAt)}
  forwarderRef={order.shipment?.forwarderRef}
  on:retry={manualShip}
  on:close={() => (errorOpen = false)}
/>

{#if expanded}
  <div class="px-3 py-3 border-b border-gray-100 bg-white/60">
    <!-- keep your existing expanded details block here -->
  </div>
{/if}

<style>
  .orders-row {
    font-size: 13px !important;
    line-height: 1.2 !important;
    color: #374151 !important;
  }

  .orders-row [role="cell"] {
    line-height: 1.2 !important;
  }

  .orders-row img,
  .orders-row svg {
    display: block;
  }

  .status-slot {
    display: flex;
    align-items: center;
  }

  .status-badge {
    font-size: 11px !important;
    line-height: 16px !important;
    height: 20px;
    max-width: 168px;
  }

  .creating-badge {
    height: 20px;
    max-width: 168px;
  }

  .invis-pill {
    visibility: hidden;
    display: inline-block;
    height: 20px;
    padding: 3px 8px;
  }

  .dot-spinner {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    border: 2px solid currentColor;
    border-top-color: transparent;
    animation: spin 0.8s linear infinite;
    opacity: 0.9;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
