<script lang="ts">
  // Geport uit v1 src/lib/components/ShipStepBlock.svelte. Wijzigingen (widget-extractie):
  // - PROXY-FIRST: geen authFetch/portaal-calls. chooseOption loopt via de proxy
  //   (api/chooseOption → POST /api/choose; v1 deed browser→TFF en patchte ook
  //   accessPoints/paperlessAvailable). Verrijkte rates (met reusableData) volgen dat
  //   v1-gedragspad met een echte server-sessionKey; kale rates (mock/dev) ronden af
  //   met een "proxy:"-placeholder zodat de "chooseOption heeft plaatsgevonden"-gates
  //   (sessionKeyReadyValidator) passeren. paperlessKnown filtert die placeholder uit
  //   (paperless blijft onbekend → geen melding); access points patcht de route (nog)
  //   niet (AccessPointSelector's bestaande "geen afhaalpunten"-pad).
  //   Zie TODO(proxy-chooseOption-kale-rates).
  // - Generated-imports omgelegd naar de provider-laag: steps/widgetFieldsMatrix.json →
  //   provider.submit.widgetFieldsMatrix; steps/fingerprintMatrix.json →
  //   provider.submit.fingerprintMatrix; steps/additionalFieldPolicies.json →
  //   provider.submit.additionalFieldPolicies; steps/submitShipmentValidators →
  //   provider.submit.validatorsByForm. Ontbreekt provider.submit, dan lege maps
  //   (fail-soft i.p.v. crash).
  // - fieldDefinitions: v1 laadde ../fields/definitions lazy in onMount (module met
  //   domain.json-import); nu dezelfde lazy import maar als factory
  //   makeFieldDefinitions(provider.domain).
  // - Props: + `provider: WidgetProviderLayer`; `order` optioneel (standalone tenants
  //   hebben geen webshop-order — alle order-gebruik geguard); `userId` default "".
  // - Fail-soft op onverrijkte proxy-rates ({carrier, service, price}): reusableData/
  //   transitTime/imgUrl/serviceDescription/availablePickupDates/pickupDate e.d. zijn
  //   undefined-veilig gemaakt; de fingerprint-key valt terug op top-level
  //   carrier/service; resolven er 0 rates naar een bekende fingerprint terwijl er wél
  //   rates zijn, dan toont de lijst ze allemaal (anders bleef hij leeg). Transit:
  //   transitTime undefined → toon niets (geen "1 dag"-fallback; "op aanvraag" alleen
  //   bij een echte TFF-sentinel). Zie TODO(proxy-rates-verrijking).
  // - shipmentOptions wordt bij init geseed als de host 'm niet meegaf (v1's
  //   ShipWizardModal deed dat altijd; de v2-shell nog niet) — nodig voor de hidden
  //   ValidatedInputs en persistentFieldValidators (t.shipmentOptions.chosenRate).
  // - extractSessionKeyFromAny vervalt: de proxy-route retourneert { sessionKey }
  //   direct (v1 moest 'm uit resultaat/store peuteren).
  // - m-keys: alle shipmentWizard.shipStep-keys bestaan in de v2-catalogus;
  //   fieldDefinitions-keys met v1-fallbacks (invoicePresentQuestion e.d.) ontbreken
  //   in de catalogus en dragen op v1's fallback-strings.
  import { onMount, createEventDispatcher } from "svelte";
  import type { ShipmentTemplate, AutomationRule } from "../types/config";
  import type { EnrichedOrder } from "../types/webshop";
  import type { WidgetProviderLayer } from "../providers/types";
  import { applyAutomationRules, resolveRate } from "../wizard/automationApplier";
  import { userPreferences } from "../state/userPreferences";
  import ShipWizardSummary from "./ShipWizardSummary.svelte";
  import { derived, get, type Writable } from "svelte/store";
  import { rateFetchStart, shallowSnapshot } from "../api/rateFetcher";
  import { isInEUCustomsTerritory } from "../utils/countries";
  import { productsHaveLineItems, invoiceReadyFor } from "../utils/laneRequirements";
  import { persistentFieldValidators } from "../validations/field-validators";
  import DynamicValidatedField from "./validated-fields/DynamicValidatedField.svelte";
  import ValidatedInput from "./inputs/ValidatedInput.svelte";
  import { fieldValidity } from "../state/formValidation";
  import CarrierAccountNumberValidatedBlock from "./validated-fields/CarrierAccountNumberValidatedBlock.svelte";
  import AccessPointSelector from "./validated-fields/AccessPointSelector.svelte";
  import StepSection from "./wizard/StepSection.svelte";
  import { m } from "../state/messageStore";
  import { apiBaseUrl } from "../api/global";
  import {
    enrichRatesWithFingerprintAvailabilityApi,
    fingerprintPartsFromReusableData,
  } from "../api/fingerprintDiscovery";

  type FieldDef = {
    label: string;
    inputType:
      | "text"
      | "select"
      | "textarea"
      | "checkbox"
      | "date"
      | "file"
      | "number"
      | "blob"
      | "blobs"
      | "carrierAccountNumber"
      | "accessPoints";
    options?: { value: string; label: string }[];
    bindPath: string;
  };

  let fieldDefinitions: Record<string, FieldDef> = {};

  export let shipment: Writable<ShipmentTemplate>;
  export let provider: WidgetProviderLayer;
  export let userId: string = "";
  export let automationRules: AutomationRule[] = [];
  // Standalone tenants hebben geen webshop-order — alle gebruik hieronder is geguard.
  export let order: EnrichedOrder | null = null;
  // Auth token for deep-linking into the app's settings pages (the "Lang wachten?" hint).
  // Only the wizard host passes it; the RateChoiceModal host doesn't need it (hint hidden there).
  export let token: string = "";
  // When true, selecting a rate does NOT fire chooseOption — we trust whatever is already on
  // the rate (notably `accessPoints`, pre-fetched server-side). Used by the queue's "Kies een
  // verzendservice" picker (RateChoiceModal) so the user never has to wait on a client-side
  // TFF call, and the user's browser PHPSESSID never gets touched. The server worker fires its
  // own chooseOption on its isolated session when the user clicks Verzenden.
  export let skipChooseOption: boolean = false;

  // v1: steps/*.json + steps/submitShipmentValidators (generated) → provider.submit
  // (fabriek-emit). Fail-soft lege maps als de provider (nog) geen submit-laag levert.
  const widgetFieldsMatrix = (provider.submit?.widgetFieldsMatrix ?? {}) as Record<string, string[]>;
  const fingerprintMatrixMap = (provider.submit?.fingerprintMatrix ?? {}) as Record<string, string>;
  const fieldPolicies = (provider.submit?.additionalFieldPolicies ?? {}) as Record<string, any>;
  const submitShipmentValidators = (provider.submit?.validatorsByForm ?? {}) as Record<
    string,
    Record<string, any>
  >;

  // v1-host (ShipWizardModal) seedde shipmentOptions altijd vóór dit blok rende; de
  // v2-shell (nog) niet. Zonder dit object crashen de hidden ValidatedInputs en de
  // persistente chosenRate-validator (t.shipmentOptions.chosenRate). Eénmalige seed;
  // geen gedragswijziging voor hosts die 'm wél meegeven.
  if (!get(shipment).shipmentOptions) {
    shipment.update((s) => ({
      ...s,
      shipmentOptions: {
        chosenRate: { carrier: "", service: "", price: "", reusableData: undefined },
      } as any,
    }));
  }

  // "gotoproducts" = user clicked a rate's requirement badge ("Vereist productdetails" /
  // "Vereist handelsfactuur") or the customs notice — the host navigates to the customs step.
  const dispatch = createEventDispatcher<{ autocomplete: void; gotoproducts: void }>();

  let _autoSelectionDone = false;
  let _autoSelectInProgress = false;
  let selectedRateIndex: number | null = null;
  let animDuration = 16000;

  let selectedPickups: Record<number, string> = {};
  let calculatedDeliveries: Record<number, string | undefined> = {};

  let resolvedRates: any[] | null = null;
  let resolvingFingerprints = false;
  let fingerprintResolutionDone = false;
  let lastFingerprintResolveKey = "";
  let pendingFingerprintCount = 0;

  let validators: Record<string, any> = {};
  let chooseOptionSeq = 0;

  $: rawRates = $shipment?.rates ?? [];
  $: hasRates =
    !!rawRates.length && $shipment.ratesHash === shallowSnapshot($shipment);
  $: activeRates = resolvedRates ?? [];

  // Line-item lanes (DHL) need per-product line items (HS code etc.) in the submit form.
  // Those are filled in the customs step's product grid — independent of whether the
  // commercial invoice is generated or uploaded. So we disable such lanes only when the
  // line items aren't actually present (empty/incomplete grid), NOT merely because the user
  // uploaded their own invoice (you can upload your own CI *and* still fill the grid). TFF
  // can't derive line items from a PDF, so an unfilled grid still blocks these lanes.
  $: lineItemsReady = productsHaveLineItems($shipment as any);

  // Commercial-invoice readiness for invoice-slot lanes (see laneRequirements.ts for the
  // queue-picker paperless carve-out — removing it breaks the headless/queue flow).
  $: invoiceReady = invoiceReadyFor($shipment as any, skipChooseOption);

  // "Lang wachten?"-hint onder de pakketdetails: alleen zinvol wanneer tarieven in de browser
  // geladen worden ómdat de gebruiker "Laad tarieven op de achtergrond" expliciet uit heeft
  // staan (default is aan). In de queue-picker (skipChooseOption) zijn de tarieven al geladen,
  // dus daar nooit tonen.
  const showBackgroundRatesHint =
    !skipChooseOption &&
    (userPreferences?.widgetBehavior as any)?.loadRatesInBackground === false;

  function openBackgroundRatesSettings() {
    // New tab: navigating this window away would kill the wizard mid-shipment.
    window.open(
      `${apiBaseUrl}/sync/packages?userId=${encodeURIComponent(userId)}&token=${encodeURIComponent(token)}`,
      "_blank",
    );
  }

  $: chooseOptionLoading = !!(($shipment as any)?.shipmentOptions?.__chooseOptionLoading);
  $: chooseOptionError = String(
    (($shipment as any)?.shipmentOptions?.__chooseOptionError ?? ""),
  ).trim();
  $: currentSessionKey = String(
    (($shipment as any)?.shipmentOptions?.sessionKey ?? ""),
  ).trim();

  // Paperless-trade availability for the chosen route. chooseOption sets it from the TFF
  // final page (see C_chooseOption transform). It's only meaningful once chooseOption has
  // actually run for this rate — i.e. a real sessionKey is in and we're not mid-call, and not
  // on the queue/skipChooseOption path (which uses a "queue:" placeholder key and resolves
  // paperless server-side at submit). Until then it stays unknown → we show nothing.
  // De "proxy:"-placeholder (kale-rates-fallback in selectRate, zie
  // TODO(proxy-chooseOption-kale-rates)) is geen echte chooseOption → paperless
  // blijft onbekend, dus die filteren we hier net zo uit als "queue:".
  $: paperlessKnown =
    !chooseOptionLoading &&
    !!currentSessionKey &&
    !currentSessionKey.startsWith("queue:") &&
    !currentSessionKey.startsWith("proxy:");
  $: paperlessAvailable =
    ($shipment as any)?.shipmentOptions?.paperlessAvailable as
      | boolean
      | undefined;

  // Hidden validator used only to disable submit while chooseOption is still in flight
  // or when a rate is selected but no sessionKey is ready yet.
  const sessionKeyReadyValidator: any = {
    dependsOn: (template: any) => ({
      chosenRate: template?.shipmentOptions?.chosenRate,
      sessionKey: template?.shipmentOptions?.sessionKey ?? "",
      chooseOptionLoading: template?.shipmentOptions?.__chooseOptionLoading ?? false,
      chooseOptionError: template?.shipmentOptions?.__chooseOptionError ?? "",
    }),
    validate: ({
      chosenRate,
      sessionKey,
      chooseOptionLoading,
    }: {
      chosenRate: any;
      sessionKey: string;
      chooseOptionLoading: boolean;
      chooseOptionError: string;
    }) => {
      const hasChosenRate =
        !!chosenRate &&
        ((chosenRate?.carrier && chosenRate?.carrier !== "") ||
          (chosenRate?.service && chosenRate?.service !== ""));

      // No rate selected yet -> let the normal chosenRate validator handle that
      if (!hasChosenRate) return { valid: true, message: "" };

      // Rate selected, but chooseOption still running
      if (chooseOptionLoading) {
        return { valid: false, message: "Shipping option is still loading." };
      }

      // Rate selected, chooseOption done, but still no session key
      if (!String(sessionKey ?? "").trim()) {
        return { valid: false, message: "Shipping option is not ready yet." };
      }

      return { valid: true, message: "" };
    },
  };

  // Hidden validator that keeps the wizard's Verzenden button disabled while the CHOSEN rate's
  // lane requirements (product line items / commercial invoice) aren't fulfilled yet. Selection
  // itself stays allowed so the user can inspect the service (access points, pickup dates)
  // before completing the customs step.
  const laneRequirementsValidator: any = {
    dependsOn: (template: any) => ({
      chosenRate: template?.shipmentOptions?.chosenRate,
      products: template?.products,
      invoice: template?.invoice,
      invoiceSource: template?.invoiceSource,
    }),
    validate: ({ chosenRate }: { chosenRate: any }) => {
      const hasChosenRate =
        !!chosenRate &&
        ((chosenRate?.carrier && chosenRate?.carrier !== "") ||
          (chosenRate?.service && chosenRate?.service !== ""));
      if (!hasChosenRate) return { valid: true, message: "" };

      const miss = missingRequirementsFor(chosenRate);
      if (miss.products) {
        return { valid: false, message: "Deze dienst vereist productdetails — vul de douanestap in." };
      }
      if (miss.invoice) {
        return { valid: false, message: "Deze dienst vereist een handelsfactuur — genereer of upload deze in de douanestap." };
      }
      return { valid: true, message: "" };
    },
  };

  $: if (!hasRates) {
    selectedRateIndex = null;
    resolvedRates = null;
    resolvingFingerprints = false;
    fingerprintResolutionDone = false;
    lastFingerprintResolveKey = "";
    pendingFingerprintCount = 0;
    selectedPickups = {};
    calculatedDeliveries = {};
    _autoSelectionDone = false;
    _autoSelectInProgress = false;
    // Do NOT clear shipment.shipmentOptions.sessionKey here.
    // That can race with chooseOption/access point loading and wipe valid state.
  }

  $: if (selectedRateIndex !== null && !activeRates?.[selectedRateIndex]) {
    selectedRateIndex = null;
  }

  $: if (selectedRateIndex !== null && activeRates?.[selectedRateIndex]) {
    validators = getMergedValidators(activeRates[selectedRateIndex]);

    fieldValidity.update((map): Record<string, boolean> => {
      const cleaned: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(map)) {
        if (!k.startsWith("shipmentOptions_")) cleaned[k] = v;
      }
      return cleaned;
    });
  }

  $: if (fingerprintResolutionDone) {
    activeRates.forEach((rate, i) => {
      if (!selectedPickups[i]) {
        const base =
          rate.availablePickupDates?.[0]?.date ??
          rate.pickupDate ??
          toYmdLocal(new Date());
        selectedPickups[i] = nextBusinessDayStr(base);
      }

      const del = computeDeliveryDate(selectedPickups[i], rate);
      if (calculatedDeliveries[i] !== del) calculatedDeliveries[i] = del;
    });
  }

  $: if (hasRates) {
    const resolveKey = `${$shipment.ratesHash ?? ""}::${rawRates.length}`;
    if (resolveKey !== lastFingerprintResolveKey) {
      lastFingerprintResolveKey = resolveKey;
      void resolveRateFingerprintsForWidget();
    }
  }

  $: if (fingerprintResolutionDone && !resolvingFingerprints && !_autoSelectionDone && (resolvedRates?.length ?? 0) > 0) {
    console.log("[auto-select] trigger: resolvedRates=", resolvedRates?.length, "automationRules=", automationRules?.length);
    _autoSelectionDone = true;
    void attemptAutoSelectRate();
  }

  const isOutsideEU = derived(shipment, ($shipment) => {
    const dest = $shipment?.recipientAddress?.country?.toUpperCase?.();
    const orig = $shipment?.shipperAddress?.country?.toUpperCase?.();
    return (
      (dest && !isInEUCustomsTerritory(dest, $shipment?.recipientAddress?.postalCode)) ||
      (orig && !isInEUCustomsTerritory(orig, $shipment?.shipperAddress?.postalCode))
    );
  });

  // TODO(proxy-rates-verrijking): onverrijkte proxy-rates dragen geen reusableData en
  // resolven (nog) geen fingerprint — v1 zou dan een LEGE lijst tonen. Interim: als
  // niets approved is terwijl er wél rates zijn, toon ze allemaal (selecteerbaar;
  // submit faalt later netjes op "Unknown fingerprint"/501 via het bestaande error-pad).
  function withProxyFallback(approved: any[]): any[] {
    return approved.length === 0 && rawRates.length > 0 ? rawRates : approved;
  }

  async function resolveRateFingerprintsForWidget() {
    if (!rawRates.length || resolvingFingerprints) return;

    resolvingFingerprints = true;
    const currentResolveKey = lastFingerprintResolveKey;

    const immediateRates = rawRates.filter((rate: any) => {
      const key = getFingerprintKey(rate);
      return Boolean(fingerprintMatrixMap[key]);
    });

    resolvedRates = withProxyFallback(immediateRates);
    pendingFingerprintCount = Math.max(0, rawRates.length - immediateRates.length);
    fingerprintResolutionDone = true;

    try {
      const customerId = "demo";

      if (!customerId) {
        return;
      }

      const requestId = `fp-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;

      // TODO(proxy-fingerprint-fallback): alleen het statische matrix-pad — de v2-port
      // van enrichRatesWithFingerprintAvailabilityApi negeert de netwerk-opties en zet
      // onopgeloste keys op "missing" (v1's faalpad).
      const enriched = await enrichRatesWithFingerprintAvailabilityApi({
        rates: rawRates,
        template: $shipment as any,
        staticMatrix: fingerprintMatrixMap,
        fetchFn: fetch,
        apiBaseUrl,
        requestId,
        customerId,
        waitMs: 0,
        pollMs: 500,
        dbg: {
          log: (msg: string, data?: any) =>
            console.log("[shipstep-fingerprint]", msg, data),
          warn: (msg: string, data?: any) =>
            console.warn("[shipstep-fingerprint]", msg, data),
        },
      });

      if (currentResolveKey !== lastFingerprintResolveKey) return;

      resolvedRates = withProxyFallback(
        enriched.filter((rate: any) => rate.fingerprintStatus === "approved"),
      );
      console.log("[auto-select] fingerprint enrichment done, approved=", resolvedRates.length, "/", enriched.length, enriched.map((r: any) => `${r.reusableData?.choose_carrier ?? r.carrier}:${r.reusableData?.choose_service_name ?? r.reusableData?.choose_service ?? r.service} → ${r.fingerprintStatus}`));

      pendingFingerprintCount = enriched.filter(
        (rate: any) =>
          rate.fingerprintStatus === "pending" ||
          rate.fingerprintStatus === "missing",
      ).length;
    } catch (err) {
      console.error("Failed to resolve dynamic fingerprints", err);

      if (currentResolveKey !== lastFingerprintResolveKey) return;

      resolvedRates = withProxyFallback(immediateRates);
      pendingFingerprintCount = Math.max(0, rawRates.length - immediateRates.length);
    } finally {
      if (currentResolveKey === lastFingerprintResolveKey) {
        resolvingFingerprints = false;
      }
    }
  }

  async function selectRate(index: number) {
    const rate = activeRates?.[index];
    if (!rate) return;
    // NOTE: rates with missing lane requirements (line items / commercial invoice) are
    // deliberately still selectable — the user may want to inspect the options (UPS access
    // points, pickup dates) before completing the customs step. Submit stays gated via the
    // hidden laneRequirementsValidator below (wizard) and canSubmit (RateChoiceModal).
    selectedRateIndex = index;

    const pickup =
      selectedPickups[index] ??
      nextBusinessDayStr(rate.pickupDate ?? toYmdLocal(new Date()));
    const delivery = computeDeliveryDate(pickup, rate);

    if (skipChooseOption) {
      // Queue mode: backend pre-fetched access points (if any) onto this rate, and will fire
      // its own chooseOption on its isolated session when the user clicks Verzenden. Just mark
      // the rate as selected — no network, no waiting on the user's PHPSESSID. The fake
      // sessionKey satisfies "chooseOption has happened" gates downstream; it's never sent.
      shipment.update((s) => {
        s.shipmentOptions!.chosenRate = rate;
        s.pickupDate = pickup;
        s.deliveryDate = delivery;
        (s.shipmentOptions as any).sessionKey = "queue:" + (rate?.reusableData?.choose_servicecode ?? "rate");
        (s.shipmentOptions as any).__chooseOptionLoading = false;
        (s.shipmentOptions as any).__chooseOptionError = "";
        return s;
      });
      return;
    }

    shipment.update((s) => {
      s.shipmentOptions!.chosenRate = rate;
      s.pickupDate = pickup;
      s.deliveryDate = delivery;

      (s.shipmentOptions as any).sessionKey = "";
      (s.shipmentOptions as any).__chooseOptionLoading = true;
      (s.shipmentOptions as any).__chooseOptionError = "";

      return s;
    });

    const seq = ++chooseOptionSeq;

    try {
      let sessionKey: string;

      if (rate?.reusableData) {
        // v1-gedragspad: echte chooseOption, nu via de proxy (POST /api/choose;
        // v1 deed dit browser→TFF via `import("../api/chooseOption")`). De server
        // draait het portaalpad op zijn eigen sessie en retourneert de sessionKey.
        // Fouten vallen in het bestaande catch-pad (__chooseOptionError + lege
        // sessionKey → sessionKeyReadyValidator blokkeert submit).
        const { chooseOption } = await import("../api/chooseOption");
        const result = await chooseOption(rate);
        sessionKey = String(result?.sessionKey ?? "").trim();
      } else {
        // TODO(proxy-chooseOption-kale-rates): de /api/choose-route bestaat nu, maar
        // kale rates (zonder reusableData, mock/dev-proxy) dragen niet de portaal-
        // postData die de server nodig heeft — voor die fallback ronden we de keuze
        // af met een "proxy:"-placeholder zodat de submit-gate passeert. Gevolgen:
        // accessPoints blijven leeg (AccessPointSelector toont "geen afhaalpunten")
        // en paperless blijft onbekend (paperlessKnown filtert "proxy:" uit).
        sessionKey = "proxy:" + (rate?.service ?? "rate");
      }

      if (seq !== chooseOptionSeq) return;

      shipment.update((s) => {
        if (!s.shipmentOptions) s.shipmentOptions = {} as any;

        (s.shipmentOptions as any).__chooseOptionLoading = false;

        if (sessionKey) {
          (s.shipmentOptions as any).sessionKey = sessionKey;
          (s.shipmentOptions as any).__chooseOptionError = "";
        } else {
          (s.shipmentOptions as any).sessionKey = "";
          (s.shipmentOptions as any).__chooseOptionError =
            "No sessionKey found after chooseOption";
        }

        return s;
      });

      console.log("[ShipStepBlock] chooseOption done", {
        viaProxyRoute: !!rate?.reusableData,
        finalSessionKey: sessionKey,
      });
    } catch (err: any) {
      if (seq !== chooseOptionSeq) return;

      shipment.update((s) => {
        if (!s.shipmentOptions) s.shipmentOptions = {} as any;
        (s.shipmentOptions as any).__chooseOptionLoading = false;
        (s.shipmentOptions as any).sessionKey = "";
        (s.shipmentOptions as any).__chooseOptionError =
          err?.message ?? "chooseOption failed";
        return s;
      });

      console.error("chooseOptionAndPatchShipment failed", err);
    }
  }

  function clearSelection() {
    selectedRateIndex = null;

    shipment.update((s) => {
      if (s.shipmentOptions) {
        (s.shipmentOptions as any).sessionKey = "";
        (s.shipmentOptions as any).__chooseOptionLoading = false;
        (s.shipmentOptions as any).__chooseOptionError = "";
        s.shipmentOptions.chosenRate = {
          carrier: "",
          service: "",
          price: "",
          reusableData: undefined,
        } as any;
      }
      return s;
    });
  }

  function toYmdLocal(d: Date) {
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function nextBusinessDayStr(ymd: string) {
    const [y, m, d] = ymd.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    const w = dt.getDay();
    if (w === 6) dt.setDate(dt.getDate() + 2);
    else if (w === 0) dt.setDate(dt.getDate() + 1);
    return toYmdLocal(dt);
  }

  function isWeekendYmd(ymd: string): boolean {
    const [y, m, d] = ymd.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    const w = dt.getDay();
    return w === 0 || w === 6;
  }

  function buildFallbackPickupOptions(rate: any) {
    const base = rate.pickupDate ?? toYmdLocal(new Date());
    const [y, m, d] = base.split("-").map(Number);
    const out: { date: string; weekend: boolean }[] = [];
    for (let offset = 0; offset < 7; offset++) {
      const dt = new Date(y, m - 1, d);
      dt.setDate(dt.getDate() + offset);
      const ymd = toYmdLocal(dt);
      out.push({ date: ymd, weekend: isWeekendYmd(ymd) });
    }
    return out;
  }

  function parseTransitDays(raw: any) {
    const s = String(raw ?? "").trim();
    if (!s) return 1;
    const r = s.match(/^(\d+)\s*-\s*(\d+)$/);
    if (r) return Math.max(parseInt(r[2], 10), 1);
    const n = parseInt(s, 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }

  // TFF puts a non-numeric value in the "transit days" column when the carrier
  // can't commit a transit time (e.g. remote regions in Argentina). Observed
  // values: the literal text "transit time on request" / "op aanvraag", and the
  // legacy "0" sentinel. In those cases we can't compute a delivery date, so we
  // show "delivery time on request" instead of silently defaulting to 1 day.
  function isTransitOnRequest(raw: any): boolean {
    const s = String(raw ?? "").trim();
    if (!s || s === "0") return true;
    if (/request|aanvraag/i.test(s)) return true;
    const n = parseInt(s, 10);
    return !(Number.isFinite(n) && n > 0);
  }

  // The computed delivery date for a rate, or undefined when transit is "on
  // request" — we must not claim a delivery date the carrier won't commit to.
  function computeDeliveryDate(pickup: string, rate: any): string | undefined {
    if (!pickup || isTransitOnRequest(rate?.transitTime)) return undefined;
    return addBusinessDays(pickup, parseTransitDays(rate.transitTime));
  }

  function applyPickup(i: number, rate: any) {
    const pickup = selectedPickups[i];
    const delivery = computeDeliveryDate(pickup, rate);
    calculatedDeliveries[i] = delivery;

    if (selectedRateIndex === i) {
      $shipment.pickupDate = pickup;
      $shipment.deliveryDate = delivery;
    }
  }

  function evaluateCondition(
    condition: string,
    _shipment: ShipmentTemplate,
  ): boolean {
    if (condition === "isNonEUExportImport") {
      return $isOutsideEU || false;
    }
    return false;
  }

  function resolvePackageType(
    packages: any[],
  ): "pallet" | "package" | "document" {
    if (packages.some((p) => p.type === "pallet")) return "pallet";
    if (packages.some((p) => p.type === "package")) return "package";
    return "document";
  }

  function getFingerprintKey(rate: any): string {
    const originCountry = $shipment.shipperAddress?.country;
    const destinationCountry = $shipment.recipientAddress?.country;
    // TODO(proxy-rates-verrijking): fail-soft — zonder reusableData vallen
    // carrier/service terug op de top-level proxy-velden (zelfde patroon als
    // applyRateExclusions en de v2-enrich in fingerprintDiscovery).
    const { carrier, service } = fingerprintPartsFromReusableData(
      rate.reusableData ?? rate,
    );
    const type = resolvePackageType($shipment.packages);

    return `${originCountry}_${destinationCountry}_${type}_${carrier}_${service}`;
  }

  function getResolvedFingerprint(rate: any): string | undefined {
    return rate?.fingerprint ?? fingerprintMatrixMap[getFingerprintKey(rate)];
  }

  // A rate "needs products" when its submit form collects per-product line items
  // (HS code etc.) — encoded canonically as the "products" key in widgetFieldsMatrix.
  // Only certain DHL lanes do; FedEx/DPD/Mainfreight/TFF only take the shipment-level
  // customs floor. When the user skipped the product step, those rates can't be SUBMITTED
  // yet — they stay selectable for inspection (badge in the list), but auto-selection skips
  // them and submit is gated (laneRequirementsValidator / RateChoiceModal canSubmit).
  function rateNeedsProducts(rate: any): boolean {
    const fp = getResolvedFingerprint(rate);
    return !!fp && (widgetFieldsMatrix[fp] ?? []).includes("products");
  }

  // A rate "needs a commercial invoice" when its submit form has a file_invoice slot —
  // encoded as the "invoice" key in widgetFieldsMatrix. Only trusted on customs lanes
  // ($isOutsideEU gate in the markup) — never on domestic ones.
  function rateNeedsInvoice(rate: any): boolean {
    const fp = getResolvedFingerprint(rate);
    return !!fp && (widgetFieldsMatrix[fp] ?? []).includes("invoice");
  }

  // Which lane requirements the rate's submit form has that the shipment doesn't fulfil yet.
  // Rates with missing requirements stay SELECTABLE (the user may want to inspect access
  // points / pickup dates before completing the customs step) — only auto-selection and
  // submit are gated on this.
  function missingRequirementsFor(rate: any): { products: boolean; invoice: boolean } {
    const s = get(shipment) as any;
    return {
      products: !productsHaveLineItems(s) && rateNeedsProducts(rate),
      invoice:
        !!get(isOutsideEU) &&
        !invoiceReadyFor(s, skipChooseOption) &&
        rateNeedsInvoice(rate),
    };
  }

  function laneRequirementsMissing(rate: any): boolean {
    const miss = missingRequirementsFor(rate);
    return miss.products || miss.invoice;
  }

  function getExtraFieldsForRate(rate: any): string[] {
    const fingerprint = getResolvedFingerprint(rate);
    const baseFields = fingerprint
      ? (widgetFieldsMatrix[fingerprint] ?? [])
      : [];

    const allFields = new Set(baseFields);

    for (const [field, policy] of Object.entries(fieldPolicies)) {
      const condition = (policy as any).onlyShowIf;
      if (!condition) continue;

      const shouldShow = evaluateCondition(condition, $shipment);

      if (shouldShow) allFields.add(field);
      else allFields.delete(field);
    }

    // The commercial invoice is uploaded in the customs step when the user picked
    // "manual_upload" — don't re-ask for it as an extra field here.
    if (($shipment as any)?.invoiceSource === "manual_upload") allFields.delete("invoice");

    return [...allFields];
  }

  function getMergedValidators(rate: any): Record<string, any> {
    const fingerprint = getResolvedFingerprint(rate);
    if (!fingerprint) return persistentFieldValidators;

    return {
      ...persistentFieldValidators,
      ...(submitShipmentValidators?.[fingerprint] ?? {}),
    };
  }

  function formatDate(dateStr: string, timeStr?: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
    const time =
      timeStr?.length === 4
        ? `${timeStr.slice(0, 2)}:${timeStr.slice(2)}`
        : timeStr || "00:00";
    const date = new Date(`${dateStr}T${time}`);
    return new Intl.DateTimeFormat("nl-NL", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(date);
  }

  function formatDayDate(dateStr: string, timeStr?: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
    const time =
      timeStr?.length === 4
        ? `${timeStr.slice(0, 2)}:${timeStr.slice(2)}`
        : timeStr || "00:00";
    const date = new Date(`${dateStr}T${time}`);

    const formatter = new Intl.DateTimeFormat("nl-NL", {
      weekday: "short",
      day: "2-digit",
      month: "short",
    });
    const parts = formatter.formatToParts(date);
    const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    const day = map.weekday?.slice(0, 2);
    return `${day} ${map.day} ${map.month}`;
  }

  function daysBetween(from: string, to: string): number {
    return Math.round(
      (new Date(to).getTime() - new Date(from).getTime()) /
        (1000 * 60 * 60 * 24),
    );
  }

  function addBusinessDays(start: string, businessDays: number): string {
    const date = new Date(start);
    let added = 0;
    while (added < businessDays) {
      date.setDate(date.getDate() + 1);
      if (date.getDay() !== 0 && date.getDay() !== 6) {
        added++;
      }
    }
    return date.toISOString().split("T")[0];
  }

  async function attemptAutoSelectRate() {
    console.log("[auto-select] attemptAutoSelectRate called, rules=", automationRules?.length, "rates=", resolvedRates?.length);
    if (!automationRules?.length || !resolvedRates?.length) {
      _autoSelectInProgress = false;
      return;
    }

    // Order-loze tenants: matchers die order-velden lezen mogen de wizard niet
    // neerhalen — dan gewoon geen auto-select (handmatige keuze).
    let rateSelection: any = null;
    try {
      ({ rateSelection } = applyAutomationRules(automationRules, {
        shipment: get(shipment),
        order: order as any,
        packageTemplates: userPreferences?.packageTemplates ?? [],
      }));
    } catch {}

    console.log("[auto-select] rateSelection=", rateSelection);
    if (!rateSelection) {
      _autoSelectInProgress = false;
      return;
    }

    const targetRate = resolveRate(rateSelection, resolvedRates);
    console.log("[auto-select] targetRate=", targetRate ? `${targetRate.reusableData?.choose_carrier ?? targetRate.carrier}/${targetRate.reusableData?.choose_service_name ?? targetRate.reusableData?.choose_service ?? targetRate.service}` : "null");
    if (!targetRate) {
      _autoSelectInProgress = false;
      return;
    }

    // Lane requirements not met (line items / commercial invoice) → don't auto-pick a rate
    // the user can't fulfil (auto-pick would auto-submit). Fall through to a manual pick.
    if (laneRequirementsMissing(targetRate)) {
      console.log("[auto-select] target's lane requirements (line items / invoice) aren't met — leaving for manual pick");
      _autoSelectInProgress = false;
      return;
    }

    const idx = resolvedRates.findIndex((r) => r === targetRate);
    if (idx === -1) {
      _autoSelectInProgress = false;
      return;
    }

    await selectRate(idx);

    const s = get(shipment);
    const sk = String((s?.shipmentOptions as any)?.sessionKey ?? "").trim();
    const err = String((s?.shipmentOptions as any)?.__chooseOptionError ?? "").trim();
    console.log("[auto-select] after chooseOption: sk=", sk || "(empty)", "err=", err || "(none)");
    if (!sk || err) {
      _autoSelectInProgress = false;
      return;
    }

    // Force validators to reflect the selected rate — the reactive $: block may lag
    // behind in async context, causing extra fields to render with no validators.
    validators = getMergedValidators(resolvedRates[idx]);

    const extraFields = getExtraFieldsForRate(resolvedRates[idx]);
    console.log("[auto-select] extraFields=", extraFields);

    if (extraFields.length === 0) {
      console.log("[auto-select] no extra fields, dispatching autocomplete");
      dispatch("autocomplete");
      return;
    }

    // If all extra fields are already valid (pre-filled by automation), auto-submit.
    const allFieldsValid = extraFields.every((fieldKey) => {
      const validator = validators[fieldKey];
      if (!validator?.dependsOn || !validator?.validate) return true;
      try {
        const deps = validator.dependsOn(s);
        const result = validator.validate(deps);
        return result?.valid !== false;
      } catch {
        return false;
      }
    });

    console.log("[auto-select] allFieldsValid=", allFieldsValid, "extraFields=", extraFields);
    if (allFieldsValid) {
      console.log("[auto-select] all extra fields valid, dispatching autocomplete");
      dispatch("autocomplete");
    } else {
      _autoSelectInProgress = false;
    }
  }

  onMount(async () => {
    // Only show the "auto-selecting…" overlay if a rate-selection rule actually MATCHES this
    // shipment+order — otherwise it's a manual pick, so show the rate list straight away.
    let matchedRateRule: any = null;
    try {
      matchedRateRule = applyAutomationRules(automationRules ?? [], {
        shipment: $shipment,
        order: order as any,
        packageTemplates: userPreferences?.packageTemplates ?? [],
      }).rateSelection;
    } catch {}
    if (matchedRateRule) _autoSelectInProgress = true;

    const maxWaitMs = 50000;
    const intervalMs = 100;
    let tries = 0;

    while (!$shipment?.rates && tries++ < maxWaitMs / intervalMs) {
      await new Promise((r) => setTimeout(r, intervalMs));
    }

    // Rates never showed up (TFF slow / returned nothing / a reactive loop) — don't sit on the
    // "auto-selecting…" overlay forever; drop it so the user at least sees the rate list (and
    // can pick one) instead of a frozen spinner.
    if (_autoSelectInProgress && !($shipment?.rates && ($shipment.rates as any[]).length)) {
      console.warn("[auto-select] no rates after wait — dropping the auto-select overlay so the user can pick manually");
      _autoSelectInProgress = false;
    }

    if (!$shipment?.rates) {
      throw new Error("shipment rates could not load after 50s");
    }

    if ($rateFetchStart) {
      const delta = performance.now() - $rateFetchStart;
      animDuration = Math.max(0, 16000 - delta);
    }

    // v1: `import("../fields/definitions")` (module las domain.json op import-tijd);
    // v2: zelfde lazy import, maar de domeintabellen komen uit provider.domain.
    const mod = await import("../fields/definitions");
    fieldDefinitions = mod.makeFieldDefinitions(provider.domain) as any;

    if ($shipment?.products?.length) {
      const totalValue = $shipment.products.reduce(
        (sum, p) => sum + (p.value || 0),
        0,
      );
      $shipment.shipmentOptions!.totalShipmentValue = totalValue;
    }
  });
</script>

<div class="relative flex w-full flex-col gap-6 text-sm text-gray-800 lg:flex-row">
  {#if _autoSelectInProgress}
    <div class="flex flex-1 flex-col items-center justify-center gap-4 py-24">
      <div class="spinner" aria-hidden="true"></div>
      <p class="text-sm text-gray-500">Vervoersdienst wordt automatisch geselecteerd…</p>
    </div>
  {:else}
    <div class="space-y-2.5 lg:w-[55%]">
    {#if hasRates}
      {#if activeRates.length}
        {#each activeRates as rate, i}
          {@const needsProducts = !lineItemsReady && rateNeedsProducts(rate)}
          {@const needsInvoice = !!$isOutsideEU && !invoiceReady && rateNeedsInvoice(rate)}
          <!-- Rows with missing lane requirements stay selectable: the user can inspect the
               service (access points, pickup dates) — only Verzenden is gated. -->
          <div
            class={`group flex cursor-pointer flex-col gap-2 rounded-xl border bg-white px-4 py-3.5 transition
            ${
              selectedRateIndex === i
                ? "border-blue-500 ring-1 ring-blue-500/30"
                : "border-gray-200 hover:border-gray-300"
            }`}
            on:click={() => void selectRate(i)}
          >
            {#if needsProducts || needsInvoice}
              <div class="flex items-center gap-1.5">
                {#if needsProducts}
                  <button
                    type="button"
                    class="inline-flex cursor-pointer items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 transition hover:bg-amber-100"
                    title="Ga naar de douanestap om de productdetails in te vullen"
                    on:click|stopPropagation={() => dispatch("gotoproducts")}
                  >
                    Vereist productdetails
                  </button>
                {/if}
                {#if needsInvoice}
                  <button
                    type="button"
                    class="inline-flex cursor-pointer items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 transition hover:bg-amber-100"
                    title="Ga naar de douanestap om de handelsfactuur te genereren of te uploaden"
                    on:click|stopPropagation={() => dispatch("gotoproducts")}
                  >
                    Vereist handelsfactuur
                  </button>
                {/if}
              </div>
            {/if}
            <div class="flex items-start gap-4">
              <div class="flex-none pt-1">
                <!-- TODO(proxy-rates-verrijking): imgUrl komt (nog) niet uit de proxy;
                     undefined → Svelte laat het src-attribuut weg. -->
                <img src={rate.imgUrl} class="h-5 w-9 object-contain" />
              </div>

              <div class="flex flex-1 flex-col justify-center">
                <div class="text-sm font-medium leading-tight text-gray-900">
                  {#if rate.serviceDescription}
                    {@html rate.serviceDescription!.trim()}
                  {:else}
                    <!-- TODO(proxy-rates-verrijking): geen serviceDescription van de
                         proxy → kale carrier + service, anders bleef de rij naamloos. -->
                    {rate.carrier} {rate.service}
                  {/if}
                </div>

                {#if !(rate.service ?? "").includes("Spoedkoerier") && !rate.noPickupPossible}
                  <div
                    class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-gray-500"
                  >
                    <div class="flex items-center gap-2">
                      <span>
                        {m.shipmentWizard.shipStep.ratingPickup}
                      </span>
                      <select
                        class="w-[120px] rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 transition focus:border-blue-400 focus:outline-none"
                        bind:value={selectedPickups[i]}
                        on:change={() => {
                          selectedPickups[i] = nextBusinessDayStr(
                            selectedPickups[i],
                          );
                          applyPickup(i, rate);
                        }}
                      >
                        {#if rate.availablePickupDates?.length}
                          {#each rate.availablePickupDates as p (p.date)}
                            <option
                              value={p.date}
                              disabled={isWeekendYmd(p.date)}
                            >
                              {formatDate(p.date || "")}{isWeekendYmd(p.date)
                                ? " (weekend)"
                                : ""}
                            </option>
                          {/each}
                        {:else}
                          {#each buildFallbackPickupOptions(rate) as f (f.date)}
                            <option value={f.date} disabled={f.weekend}>
                              {formatDate(f.date)}{f.weekend
                                ? " (weekend)"
                                : ""}
                            </option>
                          {/each}
                        {/if}
                      </select>
                    </div>

                    {#if rate.transitTime != null && !isTransitOnRequest(rate.transitTime)}
                      <div class="flex items-center gap-1">
                        <span>
                          {m.shipmentWizard.shipStep.ratingDelivery}
                        </span>
                        <span class="text-gray-700">
                          {formatDayDate(
                            calculatedDeliveries[i] ??
                              addBusinessDays(
                                rate.pickupDate ??
                                  new Date().toISOString().split("T")[0],
                                parseInt(rate.transitTime ?? "1"),
                              ),
                          )}
                        </span>
                      </div>
                    {/if}
                  </div>
                {:else if (rate.service ?? "").includes("Spoedkoerier")}
                  <div class="mt-1 text-xs text-gray-500">
                    {m.shipmentWizard.shipStep.tffSpoedException}
                  </div>
                {/if}
              </div>

              <div class="flex min-w-[72px] flex-col items-end justify-start pt-1">
                <div class="font-semibold text-gray-900">
                  €{rate.price}
                </div>
                <div class="mt-1 text-xs text-gray-500">
                  <!-- TODO(proxy-rates-verrijking): transitTime undefined → niets tonen
                       (geen "1 dag"-fallback en géén "op aanvraag" — dat is een claim). -->
                  {#if rate.transitTime == null}
                    <!-- geen transit-info van de proxy -->
                  {:else if selectedPickups[i] && calculatedDeliveries[i] && !isTransitOnRequest(rate.transitTime)}
                    {daysBetween(selectedPickups[i], calculatedDeliveries[i])}
                    {m.shipmentWizard.shipStep.ratingDays}{daysBetween(
                      selectedPickups[i],
                      calculatedDeliveries[i],
                    ) > 1
                      ? m.shipmentWizard.shipStep.ratingDaysMultiple
                      : ""}
                  {:else if !isTransitOnRequest(rate.transitTime)}
                    {parseInt(rate.transitTime ?? "1")}
                    {m.shipmentWizard.shipStep.ratingDays}{parseInt(
                      rate.transitTime ?? "1",
                    ) > 1
                      ? m.shipmentWizard.shipStep.ratingDaysMultiple
                      : ""}
                  {:else}
                    {m.shipmentWizard.shipStep.deliveryTimeOnRequest}
                  {/if}
                </div>
              </div>
            </div>
          </div>
        {/each}
      {:else}
        <div
          class="rounded-xl border border-dashed border-gray-200 px-4 py-10 text-center text-sm text-gray-500"
        >
          {m.shipmentWizard.shipStep.rateNotAvailable}
        </div>
      {/if}
    {:else}
      <div
        class="flex flex-col items-center justify-center px-6 py-16 text-center"
      >
        <div class="spinner mb-6" aria-hidden="true"></div>
        <p class="text-sm font-medium text-gray-700">
          {m.shipmentWizard.shipStep.rateLoaderText}
        </p>

        <div class="progress mb-2 mt-4">
          <div
            class="progress-bar"
            style="animation-duration: {animDuration}ms;"
          ></div>
        </div>
      </div>
    {/if}
  </div>

  <div class="lg:w-[45%]">
    {#if selectedRateIndex !== null}
      {@const selNeedsProducts = !lineItemsReady && rateNeedsProducts(activeRates[selectedRateIndex])}
      {@const selNeedsInvoice = !!$isOutsideEU && !invoiceReady && rateNeedsInvoice(activeRates[selectedRateIndex])}
      <div class="rounded-xl border border-gray-200 bg-white px-5 py-4 shadow-sm">
        {#if selNeedsProducts || selNeedsInvoice}
          <div
            class="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs leading-relaxed text-amber-800"
          >
            Je kunt deze dienst alvast bekijken, maar verzenden kan pas als de douanestap
            compleet is ({[
              selNeedsProducts ? "productdetails" : "",
              selNeedsInvoice ? "handelsfactuur" : "",
            ]
              .filter(Boolean)
              .join(" + ")}).
            <button
              type="button"
              class="font-medium underline hover:no-underline"
              on:click={() => dispatch("gotoproducts")}
            >
              Douanestap invullen
            </button>
          </div>
        {/if}
        <div class="mb-4 flex items-start justify-between gap-3">
          <div class="flex items-center gap-3">
            <img
              src={activeRates[selectedRateIndex].imgUrl}
              class="w-18 h-10 object-contain"
            />
            <h2 class="text-base font-semibold text-gray-900">
              {activeRates[selectedRateIndex].service}
            </h2>
          </div>
          <button
            class="shrink-0 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50"
            on:click={clearSelection}
          >
            {m.shipmentWizard.shipStep.back}
          </button>
        </div>

        {#if $isOutsideEU && paperlessKnown && paperlessAvailable === false}
          <div
            class="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs leading-relaxed text-amber-800"
          >
            <span class="font-medium">Let op!</span> Indien u zelf de douaneafhandeling
            regelt, kunnen er kosten aan verbonden zijn. Paperless en commercial invoice upload
            zijn niet mogelijk.
          </div>
        {/if}

        {#if Object.keys(fieldDefinitions).length}
          {@const extraFieldKeys = getExtraFieldsForRate(
            activeRates[selectedRateIndex],
          )}
          {#if extraFieldKeys.length}
            <StepSection
              label={m.shipmentWizard.shipStep.shippingOptionsLabel ??
                "Verzendopties"}
            >
              <!-- Eén kolom: dit paneel is de smalle 45%-kolom naast de tarieven-
                   lijst; twee kolommen van ~230px lieten labels drievoudig
                   wrappen en foutmeldingen over buurvelden vallen. -->
              <div class="grid gap-y-4">
                {#each extraFieldKeys as fieldKey (fieldKey)}
                  {#if fieldDefinitions[fieldKey] && validators[fieldKey]}
                    <div>
                      <label class="mb-1 block text-xs text-gray-500">
                        {fieldDefinitions[fieldKey].label}
                      </label>

                      {#if fieldKey === "shipmentOptions_carrierAccountNumber"}
                        <CarrierAccountNumberValidatedBlock
                          {provider}
                          shipmentTemplate={$shipment}
                          validator_account={validators[
                            "shipmentOptions_carrierAccountNumber"
                          ]}
                          validator_country={validators[
                            "shipmentOptions_carrierAccountNumber_carrierAccountNumberCountry"
                          ]}
                        />
                      {:else if fieldKey === "shipmentOptions_chosenRate_accessPoints"}
                        <AccessPointSelector
                          shipmentTemplate={$shipment}
                          validator={validators[
                            "shipmentOptions_chosenRate_accessPoints"
                          ]}
                        />
                      {:else}
                        <DynamicValidatedField
                          {m}
                          {provider}
                          {fieldKey}
                          fieldDef={fieldDefinitions[fieldKey] as any}
                          shipmentTemplate={shipment}
                          validator={validators[fieldKey]}
                        />
                      {/if}

                      {#if fieldKey === "shipmentOptions_incotermsGroupD" && $shipment.shipmentOptions?.incotermsGroupD === "DDP"}
                        <div
                          class="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs leading-relaxed text-amber-800"
                        >
                          <span class="font-medium"
                            >Inklaringskosten: €43,-</span
                          ><br />
                          BTW en invoerrechten worden achteraf doorbelast, vermeerderd
                          met een voorschotvergoeding van 3% van het voorgeschoten
                          bedrag, met een minimum van €25,-.
                        </div>
                      {/if}
                    </div>
                  {/if}
                {/each}
              </div>
            </StepSection>
          {/if}
        {/if}
      </div>
    {:else}
      <ShipWizardSummary {shipment}>
        {#if showBackgroundRatesHint}
          <div class="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-[13px] text-blue-900 leading-relaxed">
            <span class="font-medium">Lang wachten?</span>
            Je kunt tarieven ook op de achtergrond laden. Zendingen gaan dan in de wachtrij
            en je hoeft hier niet op het laden te wachten.
            <button
              type="button"
              class="font-medium underline hover:no-underline whitespace-nowrap"
              on:click={openBackgroundRatesSettings}
            >
              Zet aan in de instellingen
            </button>
          </div>
        {/if}
      </ShipWizardSummary>
    {/if}
  </div>
  {/if}

  <div
    aria-hidden="true"
    style="
      position: absolute;
      visibility: hidden;
      height: 0;
      overflow: hidden;
      pointer-events: none;
    "
  >
    <ValidatedInput
      name="shipmentOptions_chosenRate"
      value={$shipment.shipmentOptions!.chosenRate}
      shipmentTemplate={$shipment}
      validator={persistentFieldValidators["shipmentOptions_chosenRate"]}
    />

    <ValidatedInput
      name="shipmentOptions_sessionKeyReady"
      value={currentSessionKey}
      shipmentTemplate={$shipment}
      validator={sessionKeyReadyValidator}
    />

    <ValidatedInput
      name="shipmentOptions_laneRequirementsReady"
      value={`${lineItemsReady}:${invoiceReady}:${$shipment.shipmentOptions?.chosenRate?.service ?? ""}`}
      shipmentTemplate={$shipment}
      validator={laneRequirementsValidator}
    />
  </div>
</div>

<style>
  /* Spinner + rate-loading progress bar — Svelte-scoped (incl. keyframes) so
     TFF host-page CSS can't collide with them. */
  .spinner {
    width: 30px;
    height: 30px;
    flex-shrink: 0;
    border-radius: 9999px;
    border: 3px solid rgba(37, 99, 235, 0.18);
    border-top-color: #2563eb;
    animation: spin 0.8s linear infinite;
  }

  .progress {
    position: relative;
    width: 100%;
    height: 3px;
    border-radius: 2px;
    background: #eef0f3;
    overflow: hidden;
  }

  .progress-bar {
    position: absolute;
    top: 0;
    left: 0;
    height: 100%;
    width: 100%;
    background: #2563eb;
    transform: translateX(-100%);
    /* One pass over the (remaining) expected fetch time; duration is set
       inline per render (animDuration). */
    animation-name: slide-once;
    animation-timing-function: ease-in-out;
    animation-fill-mode: forwards;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  @keyframes slide-once {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(100%);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .spinner,
    .progress-bar {
      animation: none;
    }
  }
</style>
