<!-- Geport uit v1 src/lib/components/OrderOverview.svelte (2363r) op de v2-bedrading.
     Chrome (zoekbalk, kolommen, bulk-balk, paginering, footer, ship-together-picker)
     en de status-/selectielogica zijn v1-verbatim. Bewuste afwijkingen:

     1) Wizard = WizardShell (v2) i.p.v. ShipWizardModal. De shell kent (nog) geen
        initialShipment/startStep/redoAllSteps/forceManual/forceInlineRates/batchLabel
        en geen onHide/onAttemptBackground/onExtraInfoRequired/onQueueCorrected —
        TODO(order-flow). De prefill-variabelen worden hier al wél berekend (edits/
        bounce-partials) zodat de hand-off er later 1-op-1 in kan.
     2) TODO(order-flow): headless queue (/api/shipments/*), clientPreflight en de
        RateChoiceModal zijn niet geport. jobStates blijft leeg; readiness komt alleen
        uit de server-side order.shipReadiness. "Versturen" opent interim ALTIJD de
        wizard (v1 route: queue → bounce → pill).
     3) TODO(order-flow): Exact-uitgebreid-zoeken (extended-search) is Exact-specifiek
        en weggelaten; extTotal blijft 0, de footer toont dan gewoon de lijstlengte.
     4) Order-persistentie (/api/orders/shipment/set, /api/orders/set, /api/orders/
        sync-now, /api/error/set, /api/labels/*) bestaat nog niet op de proxy: alle
        schrijfacties zijn fail-soft (lokale store wordt wél bijgewerkt) — TODO(order-flow).
     5) Upstream label-annuleren (v1 steps/deleteShipment, rechtstreeks portaal) is
        proxy-first nog niet beschikbaar → alleen phantom-reset lokaal; anders de
        v1-toast "kan momenteel (nog) niet verwijderd worden". TODO(order-flow).
        NB v1-les: deleteShipment rapporteerde vals succes op elke 200 — de v2-route
        moet op de responsebody controleren. -->
<script lang="ts">
  import type {
    EnrichedOrder,
    WebshopAddress,
    WebshopOrderShipmentInfo,
    ShipReadiness,
  } from "../types/webshop";
  import type { TenantConfig } from "../../../../src/widget/tenant.ts";
  import type { WidgetProviderLayer } from "../providers/types";
  import WizardShell from "../WizardShell.svelte";
  import { toast } from "./toast/toast";
  import { apiBaseUrl } from "../api/global";
  import { learnProductProfiles } from "../api/productProfiles";
  import type { ShipmentTemplate } from "../types/config";
  import { sha1 } from "../utils/crypto";
  import { orders } from "../state/orders";
  import { m } from "../state/messageStore";
  import { onMount, tick } from "svelte";
  import ConfigButton from "./ConfigButton.svelte";
  import OrderViewMenu from "./OrderViewMenu.svelte";
  import { openHelp } from "../help/helpDrawer";
  import { createOrderViewColumns } from "../state/orderViewColumns";
  import { userPreferences } from "../state/userPreferences";
  import SearchFilterBar from "./SearchFilterBar.svelte";
  import {
    clearOrderFilters,
    loadOrderFilters,
    saveOrderFilters,
  } from "../state/orderFilters";
  import { clearShipDraft, loadShipDraft } from "../state/shipDraft";
  import { shipWizardOpen } from "../state/wizardOpen";
  import { clearShipEdits, loadShipEdits, pruneShipEdits, type ShipEdits } from "../state/shipEdits";
  import { get } from "svelte/store";
  import OrderRow from "./OrderRow.svelte";
  import type { StatusKey, StatusToken, Token } from "../types/search";
  import LabelBasket from "./LabelBasket.svelte";
  import { printPDFBinary } from "../print/printPDFBinary";

  // ---- runes props (v2: tenant + provider erbij — lopen door naar de WizardShell)
  type Props = { tenant: TenantConfig; provider: WidgetProviderLayer; userId: string; token: string };
  let { tenant, provider, userId, token }: Props = $props();

  // paging / modal / sync
  const pageSize = 10;
  const ROW_PX = 50; // visual height of one OrderRow (adjust to your design)

  let currentPage = $state(1);
  // Row-level multi-select. Keyed by orderId (string) so selection survives paging and search
  // result reshuffles. Lives here so the bulk-action bar above the list and every OrderRow
  // read/write the same source of truth.
  let selectedIds = $state<Set<string>>(new Set());
  function toggleSelect(orderId: string) {
    const next = new Set(selectedIds);
    if (next.has(orderId)) next.delete(orderId);
    else next.add(orderId);
    selectedIds = next;
  }
  let selectedOrder = $state<EnrichedOrder | null>(null);
  let orderLabelCreating = $state<EnrichedOrder | null>(null);
  let showShipmentModal = $state(false);
  // Widget.svelte verbergt zijn topbar zolang de wizard inline open staat — één
  // chokepoint hier, zodat elk van de vele open/close-paden hem correct bijwerkt.
  $effect(() => {
    shipWizardOpen.set(showShipmentModal && !!selectedOrder);
  });
  let isSyncing = $state(false);
  let lastUpdated = $state<Date | null>(null);
  // Prefill-context voor een wizard-open (saved edits / bounce-partial). Wordt al
  // berekend maar bereikt de WizardShell nog niet — TODO(order-flow): shell-props.
  let headlessInitialShipment = $state<ShipmentTemplate | undefined>(undefined);
  let resolveStartStep = $state<string | undefined>(undefined);
  let resolveRedoAllSteps = $state(false);
  let resolveForceManual = $state(false);
  // ── Sequential "bin" shipping ───────────────────────────────────────────────
  // "Allemaal verzenden" drops the selected orders into a bin and walks the wizard through them
  // one after another. shipBinQueue holds the orders still waiting; shipBinIndex/Total drive the
  // "Zending 2 van 5" progress (TODO(order-flow): batchLabel in de wizardheader).
  let shipBinQueue = $state<EnrichedOrder[]>([]);
  let shipBinTotal = $state(0);
  let shipBinIndex = $state(0);
  // Orders that couldn't be shipped headlessly — keyed by orderId. In v2 interim alleen
  // gevuld via shipmenterror-afhandeling; de headless queue is TODO(order-flow).
  let extraInfoOrders = $state<Record<string, { shipment?: ShipmentTemplate; reason?: string }>>({});

  // columns prefs
  const columnsSeed = userPreferences?.ui?.orderOverview?.columns as
    | Partial<Record<string, boolean>>
    | undefined;
  const columns = createOrderViewColumns(userId, columnsSeed);

  const STATUS_LABELS: Record<StatusKey, string> = {
    NEW: m.orderOverview.readableStatus.new,
    CREATED: m.orderOverview.readableStatus.created,
    AFGEROND: m.orderOverview.readableStatus.afgerond,
    // v1 las hier readableStatus.CANCELED (bestaat niet in de catalogus — undefined);
    // de kleine sleutel is de echte. Alleen labels voor unseen-tracking gebruiken 'm.
    CANCELED: m.orderOverview.readableStatus.canceled,
    UNPLANNED: m.orderOverview.readableStatus.unplanned,
    FAILED: m.orderOverview.readableStatus.failed,
  };

  // subscription
  let ordersList = $state<EnrichedOrder[]>([]);
  $effect(() => {
    const unsub = orders.subscribe((v) => (ordersList = v));
    return unsub;
  });

  // TODO(order-flow): v1 draaide hier clientPreflight (pure, no-network auto-ship-check)
  // over elke NEW order. Interim is de server-side shipReadiness (order-sync) de enige bron.
  function readinessFor(order: EnrichedOrder): ShipReadiness | undefined {
    return order.shipReadiness as ShipReadiness | undefined;
  }

  // ── Headless shipment queue (server-side) ────────────────────────────────
  // TODO(order-flow): /api/shipments/jobs|queue|pick-rate|clear bestaan nog niet op de
  // proxy. jobStates blijft leeg; alle job-afhankelijke pills/guards zijn daardoor inert
  // maar de leespaden staan er al zodat de queue-slice alleen deze sectie hoeft te vullen.
  let jobStates = $state<Record<string, any>>({});

  function isOrderNew(o: EnrichedOrder): boolean {
    const s = (o as any)?.shipment?.status;
    return !s || s === "NEW";
  }

  function reasonSaysVerifyWithCarrier(reason?: string | null): boolean {
    const r = (reason || "").toLowerCase();
    return r.includes("controleer in tff") || r.includes("controleer bij de vervoerder") || r.includes("mogelijk wel aangemaakt");
  }

  // A queued shipment that needs human input → open the *normal* ship wizard, pre-filled
  // with whatever was already resolved. (v2 interim: geen queue, dus job is altijd leeg;
  // saved edits / extraInfo bepalen de prefill.)
  function openResolveForOrder(orderId: string) {
    const id = String(orderId);
    const job = jobStates[id];
    const extra = extraInfoOrders[id];
    const order = ordersList.find((o) => String(o.orderId) === id);
    if (!order) return;
    // If the previous attempt's submit POST may have landed, make the user confirm before a
    // re-submit — that's how a single order ends up with two labels.
    if (reasonSaysVerifyWithCarrier(job?.reason ?? extra?.reason) &&
        !confirm("Deze zending is mogelijk al aangemaakt bij de vervoerder.\n\nWeet je zeker dat je 'm opnieuw wilt versturen? (Dan kun je twee labels krijgen.)")) {
      return;
    }
    const failedRetry = (order as any)?.shipment?.status === "FAILED";
    // Saved-but-canceled edits are the newest truth when present: every hand-off clears
    // them, so their existence means the user edited AFTER the last attempt.
    const edits = savedEditsFor(order);
    let init = edits
      ? sanitizeForModal(edits.shipment)
      : extra?.shipment ? sanitizeForModal(extra.shipment) : sanitizeForModal(job?.partialTemplate);
    if (failedRetry && init) {
      init = { ...init };
      delete (init as any).rates;
      delete (init as any).ratesHash;
    }
    headlessInitialShipment = init;
    resolveStartStep = failedRetry ? undefined : edits?.stepId;
    resolveRedoAllSteps = failedRetry;
    selectedOrder = order;
    showShipmentModal = true;
  }

  /** "Actie nodig" click → v1 koos hier tussen de no-wait rate-picker (RateChoiceModal)
   *  en de wizard. TODO(order-flow): picker niet geport — altijd de wizard. */
  function openAttentionForOrder(orderId: string) {
    openResolveForOrder(String(orderId));
  }

  onMount(() => {
    restoreShipDraft();
    pruneShipEdits(userId);
  });

  /** Resume an interrupted wizard session. A draft in storage means the page was
   *  refreshed or the tab closed while the ship wizard was open. (Interim inert: de
   *  v2-WizardShell schrijft nog geen drafts — TODO(order-flow) daar.) */
  function restoreShipDraft() {
    const draft = loadShipDraft(userId);
    if (!draft || showShipmentModal) return;
    // If the order got a label in the meantime (e.g. shipped from another tab), the
    // draft is stale — drop it instead of steering the user into a double label.
    const fresh = get(orders).find(
      (o) => String(o.orderId) === String(draft.order.orderId),
    );
    const ss = (fresh as any)?.shipment?.status;
    if (ss === "CREATING" || ss === "CREATED" || ss === "SHIPPED") {
      clearShipDraft(userId);
      return;
    }
    headlessInitialShipment = sanitizeForModal(draft.shipment);
    resolveStartStep = draft.stepId;
    resolveRedoAllSteps = !!draft.redoAllSteps;
    resolveForceManual = !!draft.forceManual;
    selectedOrder = draft.order;
    showShipmentModal = true;
  }

  // restore persisted search state
  const restored = loadOrderFilters(userId);
  let query = $state(restored?.query ?? "");
  let tokens = $state<Token[]>(
    restored?.tokens?.length
      ? restored.tokens
      : [{ id: "status", type: "status", values: ["NEW"] }]
  );

  // persist on change
  $effect(() => {
    saveOrderFilters(userId, { query, tokens });
  });

  // remote search
  let searchDebounce: ReturnType<typeof setTimeout> | null = null;

  // --- One search path ---
  // v1 verrijkte hier met Exact-historie (index → live → count). Dat is
  // Exact/webshop-specifiek en TODO(order-flow) in v2; extTotal blijft 0 zodat de
  // footer gewoon de lijstlengte toont. extLoading voedt alleen de spinner.
  let extLoading = $state(false);
  let extTotal = $state(0); // TRUE number of extended matches (0 = unknown/none)

  async function runSearch() {
    if (!userId) return;
    try {
      await orders.search(userId, query, tokens);
    } catch (e) {
      console.error("order search failed", e);
    }
  }

  // initial load (once on mount — not reactive to ordersList, so an empty
  // result set can't retrigger it into a loop)
  let didInitialLoad = false;
  $effect(() => {
    if (didInitialLoad) return;
    didInitialLoad = true;
    runSearch();
  });

  // re-run search on changes (debounced)
  $effect(() => {
    query;
    tokens;
    if (searchDebounce) clearTimeout(searchDebounce);
    searchDebounce = setTimeout(runSearch, 200);
    currentPage = 1;
  });

  function readableStatus(order: EnrichedOrder): string {
    const s = order.shipment?.status;
    if (!s) return m.orderOverview.orderState.new;
    if (s === "CREATING") return m.orderOverview.readableStatus.creating;
    if (s === "CREATED") {
      return order.shipment?.printedAt
        ? m.orderOverview.readableStatus.afgerond
        : m.orderOverview.readableStatus.created;
    }
    if (s === "SHIPPED") return m.orderOverview.readableStatus.shipped;
    if (s === "CANCELED") return m.orderOverview.readableStatus.canceled;
    if (s === "UNPLANNED") return m.orderOverview.readableStatus.unplanned;
    if (s === "FAILED") return m.orderOverview.readableStatus.failed;
    return m.orderOverview.readableStatus.new;
  }

  // server already ranks; only paginate here
  const totalPages = $derived(() => Math.ceil(ordersList.length / pageSize));
  const pagedOrders = $derived(() => {
    const start = (currentPage - 1) * pageSize;
    return ordersList.slice(start, start + pageSize);
  });

  const rangeStart = $derived(() =>
    ordersList.length ? (currentPage - 1) * pageSize + 1 : 0
  );
  const rangeEnd = $derived(() =>
    Math.min(currentPage * pageSize, ordersList.length)
  );

  // Whether everything in the currently-filtered ordersList is selected. Drives the master
  // checkbox in the bulk-action bar.
  const allSelected = $derived(
    () => ordersList.length > 0 && ordersList.every((o) => selectedIds.has(String(o.orderId))),
  );
  const someSelected = $derived(() => selectedIds.size > 0);

  function selectAllVisible() {
    // "All" here = every order currently in the filtered list, across all pages.
    const next = new Set(selectedIds);
    for (const o of ordersList) next.add(String(o.orderId));
    selectedIds = next;
  }
  function clearSelection() {
    selectedIds = new Set();
  }
  function toggleAll() {
    if (allSelected()) clearSelection();
    else selectAllVisible();
  }

  function resetFilters() {
    tokens = [{ id: "status", type: "status", values: ["NEW"] }];
    query = "";
    clearOrderFilters(userId);
  }

  /** Saved-but-canceled wizard edits for this order ("zending edits zijn stateful").
   *  Guarded against orders that got (or are getting) a label in the meantime. */
  function savedEditsFor(order: EnrichedOrder | undefined | null): ShipEdits | null {
    if (!order) return null;
    const id = String(order.orderId);
    const edits = loadShipEdits(userId, id);
    if (!edits) return null;
    const ss = (order as any)?.shipment?.status;
    if (ss === "CREATING" || ss === "CREATED" || ss === "SHIPPED") {
      clearShipEdits(userId, id);
      return null;
    }
    return edits;
  }

  // Strip rates/chosenRate/sessionKey so when the wizard re-opens for this shipment
  // it re-fetches fresh and the engine stops at the ship step instead of treating it
  // as done and auto-submitting again.
  function sanitizeForModal(shipment: ShipmentTemplate | undefined): ShipmentTemplate | undefined {
    if (!shipment) return shipment;
    const stored: any = { ...shipment };
    stored.shipmentOptions = {
      ...stored.shipmentOptions,
      chosenRate: { carrier: "", service: "", price: "", reusableData: undefined },
      sessionKey: "",
      __chooseOptionLoading: false,
      __chooseOptionError: "",
    };
    return stored as ShipmentTemplate;
  }

  // actions
  async function manualShip(order: EnrichedOrder) {
    const id = String(order.orderId);

    // Already being created (or it just finished) → do NOT start another attempt —
    // that's how you end up with two labels.
    const ss = (order as any)?.shipment?.status;
    if (ss === "CREATING") {
      toast.error("Deze zending wordt al aangemaakt — even geduld");
      return;
    }
    if (ss === "CREATED" || ss === "SHIPPED") {
      toast.error("Deze zending heeft al een label");
      return;
    }

    // Modal-originated "extra info" state → open the wizard pre-filled (it also handles the
    // "submit may have landed — confirm first" guard).
    if (extraInfoOrders[id]) {
      openResolveForOrder(id);
      return;
    }
    // Saved-but-canceled wizard edits → reopen the wizard with them.
    if (savedEditsFor(order)) {
      openResolveForOrder(id);
      return;
    }
    // Blank manually-created order with no address → go straight to the wizard.
    if (order.manuallyCreated && !order.shippingAddress?.country) {
      headlessInitialShipment = undefined;
      resolveStartStep = undefined;
      resolveRedoAllSteps = false;
      resolveForceManual = false;
      selectedOrder = order;
      showShipmentModal = true;
      return;
    }
    const cr = readinessFor(order);
    // Address/packages/products issue → open the wizard at the step that needs work.
    if (cr && cr.status !== "ready" && cr.status !== "no_rule") {
      openResolveForOrder(id);
      return;
    }
    // TODO(order-flow): v1 gaf 'm hier aan de server-queue (headless ship; bij `no_rule`
    // bounce → rate-picker). Interim opent óók dit pad de wizard.
    openResolveForOrder(id);
  }

  /** "Handmatig" button — the user wants to walk through every wizard step for this order,
   *  even though automation is configured. */
  async function forceManualShip(order: EnrichedOrder) {
    const id = String(order.orderId);
    const job = jobStates[id];

    // Same guards as manualShip: don't double-submit a label that's already being made or made.
    const ss = (order as any)?.shipment?.status;
    if (ss === "CREATING") { toast.error("Deze zending wordt al aangemaakt — even geduld"); return; }
    if (ss === "CREATED" || ss === "SHIPPED") { toast.error("Deze zending heeft al een label"); return; }

    // Confirm if the previous attempt's submit may have landed (avoid double-labels).
    if (reasonSaysVerifyWithCarrier(job?.reason) &&
        !confirm("Deze zending is mogelijk al aangemaakt bij de vervoerder.\n\nWeet je zeker dat je 'm opnieuw wilt versturen? (Dan kun je twee labels krijgen.)")) {
      return;
    }

    // Use whatever partial state we already have so the user sees fields pre-populated.
    // Saved-but-canceled edits win over bounce partials — they were made on top of them.
    const extra = extraInfoOrders[id];
    const edits = savedEditsFor(order);
    let init = edits
      ? sanitizeForModal(edits.shipment)
      : extra?.shipment ? sanitizeForModal(extra.shipment) : sanitizeForModal(job?.partialTemplate);
    // Drop any rates/ratesHash so a fresh list is fetched.
    if (init) {
      init = { ...init };
      delete (init as any).rates;
      delete (init as any).ratesHash;
    }
    headlessInitialShipment = init;
    resolveStartStep = edits?.stepId;
    resolveRedoAllSteps = false;
    resolveForceManual = true;
    selectedOrder = order;
    showShipmentModal = true;
  }
  function createManualShipment() {
    selectedOrder = {
      manuallyCreated: true,
      orderId: `manual-${Date.now()}`,
      orderPlatform: "manual",
      orderStatus: "DRAFT",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      grandTotal: 0,
      shippingAddress: {
        company: "",
        firstName: "",
        lastName: "",
        email: "",
        street: ["", ""],
        city: "",
        region: "",
        postalCode: "",
        country: "",
        phoneNumber: "",
      },
      billingAddress: {
        company: "",
        firstName: "",
        lastName: "",
        email: "",
        street: ["", ""],
        city: "",
        region: "",
        postalCode: "",
        country: "",
        phoneNumber: "",
      },
      orderedItems: [],
      shipment: undefined,
      source: "MANUAL",
      webshop: "manual",
    } as EnrichedOrder;
    headlessInitialShipment = undefined;
    resolveStartStep = undefined;
    resolveRedoAllSteps = false;
    resolveForceManual = false;
    showShipmentModal = true;
  }

  async function cancelShipment(order: EnrichedOrder) {
    const ref = order.shipment?.forwarderRef;
    // A "CREATED" order with no forwarderRef / pdf / tracking is a phantom — the carrier never
    // actually produced a label. There's nothing to cancel upstream; just reset it locally so
    // it can be re-shipped.
    const isPhantom = !ref && !order.shipment?.pdfUrl && !order.shipment?.trackingNumber;
    if (!ref) {
      if (!isPhantom) {
        toast.error(m.orderOverview.cancelShipment.refMissing);
        return;
      }
    } else {
      // TODO(order-flow): upstream annuleren loopt in v2 via de proxy/pool (v1 belde
      // archiveShipment.php rechtstreeks; die route bestaat hier nog niet). Let op de
      // v1-les: succes alléén op body-inspectie, niet op HTTP 200.
      toast.error(m.orderOverview.cancelShipment.notYetAllowed);
      return;
    }
    const shipment = {
      status: "CANCELED",
      trackingNumber: "",
      pdfUrl: "",
      carrier: "",
      service: "",
      country: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    try {
      await fetch(`${apiBaseUrl}/api/orders/shipment/set`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          orderId: order.orderId,
          orderPlatform: order.orderPlatform,
          shipment,
        }),
      });
    } catch {}
    orders.updateShipment(order.orderId, shipment);
  }

  async function markShipmentAsFailed(
    order: EnrichedOrder,
    errorMessage: string,
    shipment: ShipmentTemplate
  ) {
    const isManual = order.orderPlatform === "manual" && order.manuallyCreated;
    if (isManual && shipment) {
      const enrichedOrder: EnrichedOrder = {
        manuallyCreated: true,
        orderId: order.orderId,
        orderPlatform: "manual",
        orderStatus: "processing",
        createdAt: order.createdAt,
        updatedAt: new Date().toISOString(),
        grandTotal: shipment.shipmentOptions?.totalShipmentValue || 0,
        shippingAddress: { ...shipment.recipientAddress! },
        billingAddress: { ...shipment.recipientAddress! },
        orderedItems: [],
      };
      // Fail-soft: /api/orders/set bestaat nog niet op de proxy — TODO(order-flow).
      try {
        await fetch(`${apiBaseUrl}/api/orders/set`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, order: enrichedOrder }),
        });
        await orders.refresh(userId);
        lastUpdated = new Date();
      } catch (e) {
        console.warn("persist manual order failed (interim, fail-soft)", e);
      }
    }
    const shipmentStatus = {
      status: "FAILED",
      trackingNumber: "",
      pdfUrl: "",
      carrier: "",
      service: "",
      country: "",
      errorMessage,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    try {
      await fetch(`${apiBaseUrl}/api/orders/shipment/set`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          orderId: order.orderId,
          orderPlatform: order.orderPlatform,
          shipment: shipmentStatus,
        }),
      });
    } catch {}
    updateOrderLocally(order.orderId, shipmentStatus);
  }

  async function sendErrorToBackend(
    apiBase: string,
    uid: string,
    shipment: ShipmentTemplate,
    error: string,
    id: string
  ) {
    try {
      const res = await fetch(`${apiBase}/api/error/set`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: uid, shipment, error, token: id }),
      });
      if (!res.ok) console.error("❌ Failed to send error:", await res.text());
    } catch (err) {
      console.error("❌ Error sending error:", err);
    }
  }

  async function voidOrder(order: EnrichedOrder) {
    const shipment = {
      status: "UNPLANNED",
      carrier: "",
      trackingNumber: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    try {
      await fetch(`${apiBaseUrl}/api/orders/shipment/set`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          orderId: order.orderId,
          orderPlatform: order.orderPlatform,
          shipment,
        }),
      });
    } catch {}
    updateOrderLocally(order.orderId, shipment);
  }

  /**
   * Reverses an archive: flips the shipment back to NEW. The undo button on the toast
   * just re-archives by calling voidOrder again.
   */
  async function restoreOrder(order: EnrichedOrder) {
    const shipment = {
      status: "NEW",
      carrier: "",
      trackingNumber: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    try {
      await fetch(`${apiBaseUrl}/api/orders/shipment/set`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          orderId: order.orderId,
          orderPlatform: order.orderPlatform,
          shipment,
        }),
      });
    } catch {}
    updateOrderLocally(order.orderId, shipment);
    toast.success("Order teruggezet", {
      action: {
        label: "Ongedaan maken",
        onClick: () => { void voidOrder(order); },
      },
    });
  }

  function hasLabel(o: EnrichedOrder): boolean {
    const s = o.shipment;
    if (!s) return false;
    return s.status === "CREATED" || !!s.pdfUrl || !!s.trackingNumber || !!s.forwarderRef;
  }
  function isArchived(o: EnrichedOrder): boolean {
    return o.shipment?.status === "UNPLANNED";
  }
  // Eligibility per action — drives whether the bulk action buttons are clickable.
  function isArchivable(o: EnrichedOrder): boolean {
    return !hasLabel(o) && !isArchived(o);
  }
  function isShippable(o: EnrichedOrder): boolean {
    return !hasLabel(o);
  }
  function isPrintable(o: EnrichedOrder): boolean {
    return hasLabel(o);
  }
  const selectedOrders = $derived(() =>
    Array.from(selectedIds)
      .map((id) => ordersList.find((o) => String(o.orderId) === id))
      .filter((o): o is EnrichedOrder => !!o)
  );
  const canBulkArchive = $derived(() => selectedOrders().some(isArchivable));
  const canBulkShip = $derived(() => selectedOrders().some(isShippable));
  const canBulkPrint = $derived(() => selectedOrders().some(isPrintable));
  // Merging needs at least two shippable orders — a single order can't be "combined".
  const canMergeShip = $derived(() => selectedOrders().filter(isShippable).length >= 2);

  async function bulkArchive() {
    const targets = selectedOrders();
    const eligible = targets.filter(isArchivable);
    const skipped = targets.length - eligible.length;
    if (eligible.length === 0) {
      selectedIds = new Set();
      if (skipped > 0) toast.error("Geen archiveerbare orders in de selectie");
      return;
    }
    const results = await Promise.allSettled(eligible.map((o) => voidOrder(o)));
    const failed = results.filter((r) => r.status === "rejected").length;
    selectedIds = new Set();
    const archived = eligible.length - failed;
    const parts: string[] = [];
    if (archived > 0) parts.push(`${archived} gearchiveerd`);
    if (skipped > 0) parts.push(`${skipped} overgeslagen`);
    if (failed > 0) parts.push(`${failed} mislukt`);
    const msg = parts.join(", ");
    if (archived === 0) toast.error(msg);
    else toast.success(msg);
  }

  // ── Samen printen (bulk print) ──────────────────────────────────────────────
  // Mirrors LabelBasket.printAllVisible but driven from the row selection.
  // TODO(order-flow): /api/labels/merge|batch bestaan nog niet op de proxy — fail-soft.
  async function bulkPrint() {
    const targets = selectedOrders().filter(isPrintable);
    const skipped = selectedOrders().length - targets.length;
    if (targets.length === 0) {
      toast.error("Geen printbare labels in de selectie");
      return;
    }
    const urls = targets
      .map((o) => o.shipment?.pdfUrl)
      .filter((u): u is string => !!u);
    if (!urls.length) {
      toast.error("Geen PDF-URLs gevonden");
      return;
    }

    // Same persisted preference as LabelBasket's A4/A6 toggle — read at call time
    // so a toggle flip in the basket applies to the next bulk print immediately.
    const labelFormat =
      (userPreferences?.widgetBehavior as any)?.labelFormat === "a6" ? "a6" : "a4";

    try {
      const res = await fetch(`${apiBaseUrl}/api/labels/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls, format: labelFormat }),
      });
      if (!res.ok) {
        toast.error("Samenvoegen mislukt");
        return;
      }
      const buf = await res.arrayBuffer();
      printPDFBinary(buf);
    } catch {
      toast.error("Samenvoegen mislukt");
      return;
    }

    const orderIds = targets.map((o) => o.orderId);
    const printedAtIso = new Date().toISOString();
    try {
      await fetch(`${apiBaseUrl}/api/labels/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, orderIds }),
      });
      // Mirror the server batch write into the local orders store so the rows flip to
      // "Afgerond" immediately instead of waiting for the next search/refresh.
      for (const o of targets) {
        if (!o.shipment) continue;
        orders.updateShipment(String(o.orderId), {
          ...o.shipment,
          printedAt: printedAtIso,
        });
      }
      // Re-run the current search so the server filter drops printed rows out of the
      // "Label aangemaakt" view without a page reload.
      void runSearch();
    } catch {}

    selectedIds = new Set();
    const parts: string[] = [`${targets.length} geprint`];
    if (skipped > 0) parts.push(`${skipped} overgeslagen`);
    toast.success(parts.join(", "));
  }

  // Single-order variant — fired when the row-level print button runs successfully.
  async function markOrderPrinted(order: EnrichedOrder) {
    if (!order.shipment) return;
    const printedAtIso = new Date().toISOString();
    try {
      await fetch(`${apiBaseUrl}/api/labels/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, orderIds: [order.orderId] }),
      });
    } catch {}
    orders.updateShipment(String(order.orderId), {
      ...order.shipment,
      printedAt: printedAtIso,
    });
    void runSearch();
  }

  // ── Samenvoegen tot 1 zending (ship together / merge) ───────────────────────
  // Combine multiple shippable orders into one shipment. Items from every selected order are
  // merged onto a primary EnrichedOrder (first candidate anchors the orderId / orderPlatform).
  let shipTogetherCandidates = $state<EnrichedOrder[]>([]);
  let shipTogetherAddressGroups = $state<{ address: WebshopAddress; orders: EnrichedOrder[] }[]>([]);
  let showShipTogetherPicker = $state(false);

  function normalizeAddress(a?: { company?: string; firstName?: string; lastName?: string; email?: string; street?: string[]; city?: string; region?: string; postalCode?: string; country?: string; phoneNumber?: string }): string {
    if (!a) return "";
    const parts = [
      a.company, a.firstName, a.lastName, a.email,
      ...(a.street ?? []),
      a.city, a.region, a.postalCode, a.country, a.phoneNumber,
    ];
    return parts
      .map((s) => (s ?? "").toString().trim().toLowerCase().replace(/\s+/g, " "))
      .join("|");
  }

  const EMPTY_ADDRESS: WebshopAddress = {
    company: "",
    firstName: "",
    lastName: "",
    email: "",
    street: ["", ""],
    city: "",
    region: "",
    postalCode: "",
    country: "",
    phoneNumber: "",
  };

  // ── Allemaal verzenden (bin: één voor één, achter elkaar) ───────────────────
  // The selected orders go into a bin and the wizard walks them one after another. Each order
  // keeps its own label and row state. Cancelling the wizard stops the batch.
  function bulkShipSeparately() {
    const targets = selectedOrders().filter(isShippable);
    if (targets.length === 0) {
      toast.error("Geen verzendbare orders in de selectie");
      return;
    }
    selectedIds = new Set();
    shipBinQueue = targets.slice();
    shipBinTotal = targets.length;
    shipBinIndex = 0;
    void advanceShipBin();
  }

  /** Open the wizard for the next order in the bin, or finish the batch when it's empty. */
  async function advanceShipBin() {
    if (shipBinQueue.length === 0) {
      const total = shipBinTotal;
      shipBinTotal = 0;
      shipBinIndex = 0;
      if (total > 1) toast.success(`Klaar — ${total} orders verwerkt`);
      return;
    }
    const next = shipBinQueue[0];
    shipBinQueue = shipBinQueue.slice(1);
    shipBinIndex = shipBinTotal - shipBinQueue.length; // 1-based position of `next`
    // Fully unmount the wizard before reopening so it remounts fresh for the next order
    // (its shipment store, steps and autoFetchRates are all set up on mount from the props).
    showShipmentModal = false;
    selectedOrder = null;
    await tick();
    openBinOrder(next);
  }

  /** Cancel the running bin — the wizard was closed without shipping. */
  function stopShipBin() {
    shipBinQueue = [];
    shipBinTotal = 0;
    shipBinIndex = 0;
  }

  /** Open the wizard for one bin order (v1: step-by-step / forceManual — TODO(order-flow)
   *  zodra de shell die modus draagt; de bin filterde al op verzendbare orders). */
  function openBinOrder(order: EnrichedOrder) {
    const id = String(order.orderId);
    const job = jobStates[id];
    const extra = extraInfoOrders[id];
    const edits = savedEditsFor(order);
    let init = edits
      ? sanitizeForModal(edits.shipment)
      : extra?.shipment ? sanitizeForModal(extra.shipment) : sanitizeForModal(job?.partialTemplate);
    if (init) {
      init = { ...init };
      delete (init as any).rates;
      delete (init as any).ratesHash;
    }
    headlessInitialShipment = init;
    resolveStartStep = undefined;
    resolveRedoAllSteps = false;
    resolveForceManual = true;
    selectedOrder = order;
    showShipmentModal = true;
  }

  function bulkShipTogether() {
    const targets = selectedOrders().filter(isShippable);
    if (targets.length === 0) {
      toast.error("Geen verzendbare orders in de selectie");
      return;
    }
    if (targets.length === 1) {
      // Nothing to merge — just open the wizard for the single eligible order.
      manualShip(targets[0]);
      return;
    }
    // Group candidates by normalised receiver address so we know whether everyone matches and,
    // if not, which unique addresses to offer in the picker.
    const groups = new Map<string, { address: WebshopAddress; orders: EnrichedOrder[] }>();
    for (const o of targets) {
      const key = normalizeAddress(o.shippingAddress);
      const existing = groups.get(key);
      if (existing) existing.orders.push(o);
      else groups.set(key, { address: o.shippingAddress, orders: [o] });
    }
    const groupList = Array.from(groups.values());
    if (groupList.length === 1) {
      // All match — skip the picker, just ship.
      commitShipTogether(targets, groupList[0].address);
      return;
    }
    shipTogetherCandidates = targets;
    shipTogetherAddressGroups = groupList;
    showShipTogetherPicker = true;
  }

  function commitShipTogether(candidates: EnrichedOrder[], address: WebshopAddress) {
    // First candidate anchors the merged order — its orderId/orderPlatform identify the
    // resulting shipment. Every candidate's orderedItems are concatenated.
    const primary = candidates[0];
    const mergedItems = candidates.flatMap((o) => o.orderedItems ?? []);
    const mergedOrder: EnrichedOrder = {
      ...primary,
      shippingAddress: address,
      billingAddress: address,
      orderedItems: mergedItems,
      updatedAt: new Date().toISOString(),
    };
    // Marks this as a synthetic ship-together session: the wizard must NOT persist per-order
    // edits for it (they'd resurrect the merged items when the primary order is opened solo).
    (mergedOrder as any).shipTogetherCount = candidates.length;
    showShipTogetherPicker = false;
    shipTogetherCandidates = [];
    shipTogetherAddressGroups = [];
    selectedIds = new Set();
    headlessInitialShipment = undefined;
    resolveStartStep = undefined;
    resolveRedoAllSteps = false;
    resolveForceManual = true;
    selectedOrder = mergedOrder;
    showShipmentModal = true;
  }

  async function handleShipmentSuccess(
    order: EnrichedOrder,
    trackingNumber: string,
    forwarderRef: string,
    pdfUrl: string,
    carrier: string,
    service: string,
    country: string,
    shipmentTemplate?: ShipmentTemplate
  ) {
    const shipment: WebshopOrderShipmentInfo = {
      status: "CREATED",
      trackingNumber,
      pdfUrl,
      forwarderRef,
      carrier,
      service,
      country,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      printedAt: null,
      printBatchId: null,
    };
    // Label exists — saved wizard edits for this order are spent.
    clearShipEdits(userId, String(order.orderId));
    // Remember confirmed per-SKU product data (HS code, origin, weight, value)
    // so the next shipment of the same product pre-fills the customs grid.
    if (shipmentTemplate?.products?.length) {
      learnProductProfiles(userId, shipmentTemplate.products);
    }
    const isManual = order.orderPlatform === "manual" && order.manuallyCreated;
    if (isManual && shipmentTemplate) {
      const enrichedOrder: EnrichedOrder = {
        manuallyCreated: true,
        orderId: order.orderId,
        orderPlatform: "manual",
        orderStatus: "COMPLETED",
        createdAt: order.createdAt,
        updatedAt: new Date().toISOString(),
        grandTotal: shipmentTemplate.shipmentOptions?.totalShipmentValue || 0,
        shippingAddress: { ...shipmentTemplate.recipientAddress! },
        billingAddress: { ...shipmentTemplate.recipientAddress! },
        orderedItems: [],
        shipment,
      };
      // Fail-soft: /api/orders/set bestaat nog niet op de proxy — TODO(order-flow).
      // De lokale store wordt hieronder hoe dan ook bijgewerkt.
      try {
        const res = await fetch(`${apiBaseUrl}/api/orders/set`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, order: enrichedOrder }),
        });
        if (res.ok) {
          await orders.refresh(userId);
          lastUpdated = new Date();
        }
      } catch (e) {
        console.warn("persist manual order failed (interim, fail-soft)", e);
      }
      // Interim: zet de handmatige order lokaal in de lijst zodat de rij direct
      // zichtbaar is, ook zonder persist-route.
      if (!get(orders).some((o) => String(o.orderId) === String(order.orderId))) {
        orders.replaceAll([enrichedOrder, ...get(orders)]);
      }
    }
    // Fail-soft: /api/orders/shipment/set bestaat nog niet op de proxy — TODO(order-flow).
    try {
      await fetch(`${apiBaseUrl}/api/orders/shipment/set`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          orderId: order.orderId,
          orderPlatform: order.orderPlatform,
          shipment,
        }),
      });
    } catch (e) {
      console.warn("persist shipment failed (interim, fail-soft)", e);
    }
    updateOrderLocally(order.orderId, shipment);
  }

  function updateOrderLocally(orderId: string, shipment: any) {
    orders.updateShipment(orderId, shipment);
  }

  // “new since seen” badges
  const trackedForNew = [STATUS_LABELS.CREATED, STATUS_LABELS.FAILED];
  let lastSeenAt = $state<Record<string, number>>({});

  const unseenCounts = $derived(() =>
    trackedForNew.reduce(
      (acc, st) => {
        const since = lastSeenAt[st] || 0;
        const count = ordersList.filter(
          (o) => readableStatus(o) === st && statusTimestamp(o) > since
        ).length;
        acc[st] = count;
        return acc;
      },
      {} as Record<string, number>
    )
  );

  // badges for the SearchFilterBar
  let unseenCreated = $state(0);
  let unseenFailed = $state(0);

  $effect(() => {
    const map = unseenCounts();
    unseenCreated = map[STATUS_LABELS.CREATED] ?? 0;
    unseenFailed = map[STATUS_LABELS.FAILED] ?? 0;
  });

  function statusTimestamp(o: EnrichedOrder): number {
    const s = o.shipment;
    return (
      (s?.updatedAt && new Date(s.updatedAt).getTime()) ||
      (s?.createdAt && new Date(s.createdAt).getTime()) ||
      (o.updatedAt && new Date(o.updatedAt).getTime()) ||
      (o.createdAt && new Date(o.createdAt).getTime()) ||
      0
    );
  }

  // Background sync — never blocks the view. The order list is already painted from the
  // (interim lege) /api/orders route; this only kicks a background live sync.
  // TODO(order-flow): /api/orders/sync-now bestaat nog niet op de proxy — fail-soft.
  let lastSyncTs = $state(0);
  let mounted = $state(false);
  $effect(() => {
    if (mounted) return;
    mounted = true;

    trackedForNew.forEach(
      (st) => (lastSeenAt = { ...lastSeenAt, [st]: Date.now() })
    );
    const now = Date.now();
    if (now - lastSyncTs > 30_000) {
      lastSyncTs = now;
      isSyncing = true;
      (async () => {
        try {
          const res = await fetch(`${apiBaseUrl}/api/orders/sync-now`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId }),
          });
          if (res?.ok) {
            await runSearch();
            lastUpdated = new Date();
          }
        } catch (err) {
          console.warn("Immediate sync failed (interim, fail-soft)", err);
        } finally {
          isSyncing = false;
        }
      })();
    }
  });

  const MAX_PAGE_BUTTONS = 7; // total numeric buttons visible (tweak 5–9)

  type PageItem =
    | { type: "page"; n: number }
    | { type: "ellipsis"; key: string };

  function buildPageItems(
    total: number,
    current: number,
    maxBtns: number
  ): PageItem[] {
    if (total <= 0) return [];
    const win = Math.min(maxBtns, total);
    const half = Math.floor(win / 2);

    let start = Math.max(1, current - half);
    let end = start + win - 1;
    if (end > total) {
      end = total;
      start = Math.max(1, end - win + 1);
    }

    const items: PageItem[] = [];

    if (start > 1) {
      items.push({ type: "page", n: 1 });
      if (start > 2) items.push({ type: "ellipsis", key: "lead" });
    }

    for (let n = start; n <= end; n++) items.push({ type: "page", n });

    if (end < total) {
      if (end < total - 1) items.push({ type: "ellipsis", key: "trail" });
      items.push({ type: "page", n: total });
    }

    return items;
  }

  const pageItems = $derived(() =>
    buildPageItems(totalPages(), currentPage, MAX_PAGE_BUTTONS)
  );

  function goToPage(n: number) {
    const t = totalPages();
    if (!t) return;
    currentPage = Math.min(t, Math.max(1, n));
  }

  function prevPage() {
    goToPage(currentPage - 1);
  }
  function nextPage() {
    goToPage(currentPage + 1);
  }

  // keep page in bounds
  $effect(() => {
    const t = totalPages();
    if (t <= 0) {
      if (currentPage !== 1) currentPage = 1;
      return;
    }
    if (currentPage > t) currentPage = t;
    if (currentPage < 1) currentPage = 1;
  });

  function closeWizard() {
    showShipmentModal = false;
    selectedOrder = null;
    headlessInitialShipment = undefined;
    resolveStartStep = undefined;
    resolveRedoAllSteps = false;
    resolveForceManual = false;
  }
</script>

<div class="orders-root max-w-6xl mx-auto px-6 pt-0 pb-1">
  <!-- De ship-wizard vervangt de overview in-place (zelfde container, dus exact
       hetzelfde oppervlak — geen overlay over de hostpagina). display:none i.p.v.
       {#if} zodat lijst-DOM, filters en scrollpositie bewaard blijven. -->
  <div class:hidden={showShipmentModal && !!selectedOrder}>
    <!-- Sticky header with search + controls -->
  <div
    class="orders-header sticky top-0 z-10 bg-white/85 backdrop-blur border-b border-gray-100 -mx-6 px-6 py-2 mb-2"
  >
    <!-- use items-center so the right controls are NOT lower -->
    <div class="flex items-center gap-2">
      <div class="flex-1 min-w-0">
        <SearchFilterBar
          bind:query
          bind:tokens
          {unseenCreated}
          {unseenFailed}
          allStatusKeys={["NEW", "CREATED", "AFGEROND", "CANCELED", "UNPLANNED", "FAILED"]}
          statusLabels={{
            NEW: m.orderOverview.readableStatus.new,
            CREATED: m.orderOverview.readableStatus.created,
            AFGEROND: m.orderOverview.readableStatus.afgerond,
            CANCELED: m.orderOverview.readableStatus.canceled,
            UNPLANNED: m.orderOverview.readableStatus.unplanned,
            FAILED: m.orderOverview.readableStatus.failed,
          }}
          allowedPlatforms={[
            "Shopify",
            "WooCommerce",
            "Magento",
            "ExactOnline",
            "BusinessCentral",
            "afas",
            "manual",
          ]}
          platformLabels={{
            Shopify: "Shopify",
            WooCommerce: "WooCommerce",
            Magento: "Magento",
            ExactOnline: "Exact Online",
            BusinessCentral: "Business Central",
            afas: "AFAS",
            manual: "Manual",
          }}
        />
      </div>

      <!-- right controls: locked to h-8 so all baselines match -->
      <div class="flex items-center gap-2 text-gray-600 shrink-0">
        <!-- Last update label (fixed min width) -->
        <div
          class="h-8 px-2 flex items-center justify-center whitespace-nowrap min-w-[22ch] text-center shrink-0"
        >
          <span class="block leading-none tabular-nums text-[12px]">
            {lastUpdated
              ? m.orderOverview.lastUpdate +
                ": " +
                lastUpdated.toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : ""}
          </span>
        </div>

        <button
          on:click={createManualShipment}
          class="h-8 px-3 rounded-lg text-[12px] leading-none font-medium border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 inline-flex items-center gap-1"
          title={m.orderOverview.createShipment}
        >
          <svg class="w-3.5 h-3.5 text-gray-700"><use href="#icon-truck" /></svg
          >
          {m.orderOverview.createShipment}
        </button>

        <ConfigButton {userId} {token} />
        <OrderViewMenu {columns} />

        <button
          aria-label={m.help?.helpLabel ?? "Hulp"}
          title={m.help?.helpLabel ?? "Hulp"}
          on:click={() => openHelp("order-overview")}
          class="inline-flex items-center justify-center h-7 w-7 rounded-lg
                 border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 hover:text-gray-700
                 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30
                 transition-colors"
        >
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
            <path d="M12 17h.01" />
          </svg>
        </button>

        <!-- Spinner on the far right; slot width is always reserved. It only signals a
             background refresh — the list stays fully interactive, it never blocks. -->
        <div class="h-8 w-8 flex items-center justify-center">
          {#if isSyncing || extLoading}<div class="spinner"></div>{/if}
        </div>
      </div>
    </div>
  </div>

  <!-- Bulk-action bar: sits between filters and the rows. Master tri-state checkbox + selection
       count + clear link. The leading 28-px slot mirrors SELECT_COL_PX in OrderRow so this
       master checkbox sits vertically over each row's checkbox. -->
  <div class="flex items-center gap-x-3 px-3 py-1.5 text-[12px] text-gray-500 border-b border-gray-100">
    <div class="flex items-center justify-center" style="width: 28px;">
      <input
        type="checkbox"
        class="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:outline-none focus:ring-0 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-0 cursor-pointer"
        checked={allSelected()}
        indeterminate={someSelected() && !allSelected()}
        on:change={toggleAll}
        aria-label="Selecteer alle zichtbare orders"
      />
    </div>
    {#if selectedIds.size > 0}
      <span class="tabular-nums">{selectedIds.size} geselecteerd</span>
      <button
        type="button"
        class="text-blue-600 hover:underline"
        on:click={clearSelection}
      >Wis selectie</button>
    {:else}
      <span>Selecteer orders</span>
    {/if}
  </div>

  <!-- Orders list -->
  <div
    role="table"
    aria-label="Orders"
    class="relative"
    style={`min-height:${pageSize * ROW_PX}px`}
  >
    {#if ordersList.length === 0}
      <!-- Centered empty-state overlay; does not affect layout -->
      <div class="absolute inset-0 grid place-items-center">
        <p class="text-sm text-gray-400 italic">
          {m.orderOverview.noOrdersFoundForFilter}
          <button
            class="ml-3 px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
            on:click={resetFilters}
          >
            Reset filters
          </button>
        </p>
      </div>
    {:else}
      {#each pagedOrders() as order (order.orderId)}
        <div class="overflow-hidden" style={`height:${ROW_PX}px`}>
          <!-- `needsExtraInfo` excludes `no_rule` — when there's no rate_selection
               automation, the user is expected to pick a service in the wizard. That's
               the normal flow, not a "missing step". -->
          <OrderRow
            {order}
            {columns}
            jobState={jobStates[order.orderId] ?? null}
            needsExtraInfo={!!extraInfoOrders[order.orderId] || (readinessFor(order)?.status ?? "") === "needs_input" || (readinessFor(order)?.status ?? "") === "error"}
            attentionReason={extraInfoOrders[order.orderId]?.reason ?? readinessFor(order)?.reason ?? ""}
            canFullyAutoShip={(readinessFor(order)?.status ?? "") === "ready" && !extraInfoOrders[order.orderId]}
            autoExceptRate={(readinessFor(order)?.status ?? "") === "no_rule" && !extraInfoOrders[order.orderId]}
            selected={selectedIds.has(String(order.orderId))}
            on:deleteShipment={() => cancelShipment(order)}
            on:manualShip={() => manualShip(order)}
            on:forceManualShip={() => forceManualShip(order)}
            on:resolveJob={() => openAttentionForOrder(order.orderId)}
            on:voidOrder={() => voidOrder(order)}
            on:restoreOrder={() => restoreOrder(order)}
            on:printed={() => markOrderPrinted(order)}
            on:toggleSelect={() => toggleSelect(String(order.orderId))}
          />
        </div>
      {/each}
      {#if pagedOrders().length < pageSize}
        <!-- optional spacer to keep footer from jumping when last page is short -->
        <div
          style={`height:${(pageSize - pagedOrders().length) * ROW_PX}px`}
        ></div>
      {/if}
    {/if}
  </div>

  <div class="footer mt-4 flex items-center gap-3">
    <!-- Range + pagination always sit on the left, regardless of selection state. -->
    <div class="flex items-center gap-2">
      <span
        class="range-chip"
        title={extTotal > ordersList.length
          ? `${ordersList.length} geladen — ${extTotal} matches in het archief`
          : ""}
        >{rangeStart()}–{rangeEnd()} van {extTotal > ordersList.length
          ? extTotal
          : ordersList.length}</span
      >

      {#if totalPages() > 1}
        <div
          class="pagination flex items-center gap-1"
          role="navigation"
          aria-label="Pagination"
        >
          <button
            class="page-btn icon"
            title="Vorige"
            aria-label="Previous page"
            disabled={currentPage === 1}
            on:click={prevPage}>‹</button
          >

          {#each pageItems() as it (it.type === "page" ? `p-${it.n}` : it.key)}
            {#if it.type === "page"}
              <button
                class={`page-btn ${currentPage === it.n ? "is-active" : ""}`}
                aria-current={currentPage === it.n ? "page" : undefined}
                on:click={() => goToPage(it.n)}
              >
                {it.n}
              </button>
            {:else}
              <span class="ellipsis" aria-hidden="true">…</span>
            {/if}
          {/each}

          <button
            class="page-btn icon"
            title="Volgende"
            aria-label="Next page"
            disabled={currentPage === totalPages()}
            on:click={nextPage}>›</button
          >
        </div>
      {/if}
    </div>

    <div class="flex-1"></div>

    {#if selectedIds.size === 0}
      <div class="basket-inline shrink-0 flex items-center">
        <LabelBasket {userId} variant="inline" />
      </div>
    {:else}
      <div class="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          class="inline-flex items-center rounded-lg border border-gray-200 bg-white hover:bg-gray-50 px-3 py-1.5 text-xs leading-none text-gray-700 disabled:opacity-40 disabled:hover:bg-white disabled:cursor-not-allowed"
          disabled={!canBulkArchive()}
          title={canBulkArchive() ? "Geselecteerde orders archiveren" : "Geen archiveerbare orders in de selectie"}
          on:click={bulkArchive}
        >Archiveren</button>
        <button
          type="button"
          class="inline-flex items-center whitespace-nowrap rounded-lg border border-gray-200 bg-white hover:bg-gray-50 px-3 py-1.5 text-xs leading-none text-gray-700 disabled:opacity-40 disabled:hover:bg-white disabled:cursor-not-allowed"
          disabled={!canBulkShip()}
          title={canBulkShip() ? "Verzend de geselecteerde orders één voor één — na elke zending opent automatisch de volgende" : "Geen verzendbare orders in de selectie"}
          on:click={bulkShipSeparately}
        >Allemaal verzenden</button>
        <button
          type="button"
          class="inline-flex items-center whitespace-nowrap rounded-lg border border-gray-200 bg-white hover:bg-gray-50 px-3 py-1.5 text-xs leading-none text-gray-700 disabled:opacity-40 disabled:hover:bg-white disabled:cursor-not-allowed"
          disabled={!canMergeShip()}
          title={canMergeShip() ? "Geselecteerde orders combineren tot één zending (één doos, één label)" : "Selecteer minstens 2 verzendbare orders om samen te voegen"}
          on:click={bulkShipTogether}
        >Samenvoegen tot 1 zending</button>
        <button
          type="button"
          class="inline-flex items-center rounded-lg border border-gray-200 bg-white hover:bg-gray-50 px-3 py-1.5 text-xs leading-none text-gray-700 disabled:opacity-40 disabled:hover:bg-white disabled:cursor-not-allowed"
          disabled={!canBulkPrint()}
          title={canBulkPrint() ? "Labels van geselecteerde orders printen" : "Geen printbare labels in de selectie"}
          on:click={bulkPrint}
        >Printen</button>
        <button
          type="button"
          class="inline-flex items-center rounded-lg border border-gray-200 bg-white hover:bg-gray-50 px-2 py-1.5 text-xs leading-none text-gray-700"
          aria-label="Meer acties"
          on:click={() => toast.success("Meer acties komen eraan")}
        >⋯</button>
      </div>
    {/if}
  </div>
  </div>

  <!-- Wizard — rendert inline in orders-root, op de plek van de (verborgen) overview.
       v2: WizardShell met het versimpelde event-contract (close/success/shipmenterror).
       TODO(order-flow): initialShipment/startStep/redoAllSteps/forceManual/batchLabel +
       onHide/onAttemptBackground/onExtraInfoRequired/onQueueCorrected van v1's modal. -->
  {#if showShipmentModal && selectedOrder}
    <WizardShell
      {tenant}
      {provider}
      {userId}
      {token}
      order={selectedOrder}
      on:success={({ detail: evt }) => {
        const targetOrder = (evt?.order ?? selectedOrder) as EnrichedOrder;
        const detail = evt?.detail ?? {};
        const creatingId = targetOrder?.orderId;
        if (creatingId && extraInfoOrders[creatingId]) {
          const next = { ...extraInfoOrders };
          delete next[creatingId];
          extraInfoOrders = next;
        }
        handleShipmentSuccess(
          targetOrder,
          detail.trackingNumber || "",
          detail.forwarderRef || "",
          detail.pdfUrl || "",
          detail.carrier || "",
          detail.service || "",
          detail.country || "",
          detail.shipmentTemplate
        );
        toast.success(
          `${m.orderOverview.labelCreatedActionStart}${targetOrder?.orderId}${m.orderOverview.labelCreatedActionMid}${
            (targetOrder?.shippingAddress?.firstName || "") +
            " " +
            (targetOrder?.shippingAddress?.lastName || "")
          }${m.orderOverview.labelCreatedActionEnd}`
        );
        if (orderLabelCreating?.orderId === targetOrder?.orderId) {
          orderLabelCreating = null;
        }
        // Geslaagd → wizard dicht, terug naar de lijst; loopt de bin door als die draait.
        closeWizard();
        if (shipBinTotal > 0) void advanceShipBin();
      }}
      on:close={() => {
        closeWizard();
        // Cancelling the wizard stops a running "Allemaal verzenden" bin.
        if (shipBinTotal > 0) stopShipBin();
      }}
      on:shipmenterror={async ({ detail: evt }) => {
        const reason: string = evt?.reason ?? "";
        const shipment: ShipmentTemplate = evt?.shipment;
        const eventOrder = (evt?.order ?? selectedOrder ?? orderLabelCreating) as EnrichedOrder | null;
        const idLong = await sha1(
          JSON.stringify(shipment) + " " + reason + Date.now()
        );
        const id = idLong.slice(0, 12);
        const mailFormat = `${m.shipmentWizard.errorMessageStart}${id}${m.shipmentWizard.errorMessageMid}${reason}${m.shipmentWizard.errorMessageEnd}`;
        const mailto =
          m.shipmentWizard.errorMessageMailto + encodeURIComponent(mailFormat);
        const errorMessage = `${reason}${m.orderOverview.orderRow.errorMessageStart}${mailto}${m.orderOverview.orderRow.errorMessageEnd}`;
        await sendErrorToBackend(apiBaseUrl, userId, shipment, reason, id);
        if (eventOrder) {
          // v1 sloot hier niet: de wizard blijft open zodat de gebruiker direct kan
          // herstellen; de rij toont ondertussen de rode "Mislukt"-badge + popover.
          await markShipmentAsFailed(eventOrder, errorMessage, shipment);
        }
      }}
    />
  {/if}

  {#if showShipTogetherPicker && shipTogetherAddressGroups.length > 0}
    <!-- Receiver picker: shown only when the selected orders don't all share one address. -->
    <div
      class="fixed inset-0 z-[110] bg-slate-900/25 backdrop-blur-[1.5px] flex items-center justify-center p-4"
      on:click={(e) => {
        if (e.target === e.currentTarget) {
          showShipTogetherPicker = false;
          shipTogetherCandidates = [];
          shipTogetherAddressGroups = [];
        }
      }}
      role="presentation"
    >
      <div class="bg-white rounded-2xl border border-gray-200 shadow-xl shadow-slate-900/10 max-w-xl w-full max-h-[92vh] flex flex-col">
        <div class="p-5 pb-3 flex items-start justify-between gap-4 border-b border-gray-100">
          <div>
            <h3 class="text-base font-semibold text-gray-900">Kies ontvangstadres</h3>
            <p class="text-xs text-gray-500 mt-0.5">
              De geselecteerde orders hebben verschillende ontvangstadressen. Kies welk adres je wilt gebruiken.
            </p>
          </div>
          <button
            type="button"
            class="rounded-full p-1 hover:bg-gray-100 shrink-0"
            on:click={() => {
              showShipTogetherPicker = false;
              shipTogetherCandidates = [];
              shipTogetherAddressGroups = [];
            }}
            aria-label="Sluiten"
          >✕</button>
        </div>

        <div class="flex-1 overflow-y-auto px-3 py-3 space-y-1.5">
          {#each shipTogetherAddressGroups as g, i (i)}
            {@const a = g.address}
            {@const name = [a?.firstName, a?.lastName].filter(Boolean).join(" ") || a?.company || "—"}
            {@const streetLine = (a?.street ?? []).filter(Boolean).join(" ")}
            {@const cityLine = [a?.postalCode, a?.city].filter(Boolean).join(" ")}
            <button
              type="button"
              class="w-full text-left rounded-lg border border-gray-200 hover:border-blue-400 hover:bg-blue-50/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 px-3 py-2 flex items-start gap-3"
              on:click={() => commitShipTogether(shipTogetherCandidates, g.address)}
            >
              <div class="flex-1 min-w-0">
                <div class="text-xs font-medium text-gray-900 truncate">{name}</div>
                <div class="text-[11px] text-gray-500 truncate">{streetLine}</div>
                <div class="text-[11px] text-gray-500 truncate">{[cityLine, a?.country].filter(Boolean).join(", ")}</div>
              </div>
              <div class="text-[11px] text-gray-500 shrink-0 tabular-nums mt-0.5">
                {g.orders.length} {g.orders.length === 1 ? "order" : "orders"}
              </div>
            </button>
          {/each}

          <button
            type="button"
            class="w-full text-left rounded-lg border border-dashed border-gray-300 hover:border-blue-400 hover:bg-blue-50/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 px-3 py-2 text-xs text-gray-700"
            on:click={() => commitShipTogether(shipTogetherCandidates, EMPTY_ADDRESS)}
          >
            Voer adres later in (handmatig in de wizard)
          </button>
        </div>

        <div class="px-5 py-3 border-t border-gray-100 flex items-center justify-end gap-2 bg-gray-50 rounded-b-2xl">
          <button
            type="button"
            class="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700"
            on:click={() => {
              showShipTogetherPicker = false;
              shipTogetherCandidates = [];
              shipTogetherAddressGroups = [];
            }}
          >Annuleren</button>
        </div>
      </div>
    </div>
  {/if}

</div>

<style>
  .spinner {
    width: 1rem;
    height: 1rem;
    border: 2px solid #2563eb;
    border-top-color: transparent;
    border-radius: 9999px;
    animation: spin 0.6s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* lock body text + fix inherited issues inside overview */
  .orders-root {
    font-size: 13px !important;
    line-height: 1.2 !important;
    color: #111827 !important;
  }
  .orders-root svg,
  .orders-root img {
    display: block;
  } /* remove baseline offsets */

  /* header: ensure all immediate children are 32px tall and centered */
  .orders-header :where(button, a) {
    line-height: 1 !important;
  }

  .range-chip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 2rem;
    width: 6.5rem; /* ← fixed, not min-width */
    padding: 0 10px;
    font-size: 12px;
    color: #64748b;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    background: #fff;
    margin-right: 0.25rem;
    font-variant-numeric: tabular-nums; /* equal digit widths */
    white-space: nowrap; /* no wrap */
  }

  /* lock basket to the same baseline */
  .basket-inline,
  .basket-inline :global(.wrap-inline),
  .basket-inline :global(.btn) {
    height: 2rem;
  }
  .basket-inline :global(.btn) {
    padding-top: 0;
    padding-bottom: 0;
  }

  /* (nice-to-have) keyboard focus */
  .footer .page-btn:focus-visible,
  .basket-inline :global(.btn:focus-visible) {
    outline: 2px solid rgba(37, 99, 235, 0.55);
    outline-offset: 2px;
  }

  /* Ensure pagination never collapses or hides due to overflow */
  .pagination {
    min-height: 2rem;
  }

  /* Buttons */
  .footer .page-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 2rem;
    line-height: 1;
    padding: 0 0.75rem;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    background: #fff;
    color: #374151;
    font-size: 12px;
    transition:
      background 120ms ease,
      border-color 120ms ease;
  }
  .footer .page-btn:not(:disabled):not(.is-active):hover {
    background: #f9fafb;
  }
  .footer .page-btn.icon {
    width: 2rem;
    padding: 0;
  }
  .footer .page-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .footer .page-btn.is-active {
    border-color: #2563eb !important;
    background: #2563eb;
    color: #fff;
  }
  .footer .ellipsis {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    color: #94a3b8;
  }
</style>
