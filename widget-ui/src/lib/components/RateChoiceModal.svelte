<script lang="ts">
  // Geport uit v1 src/lib/components/RateChoiceModal.svelte. Wijzigingen:
  // - Generated steps/-imports (fingerprintMatrix/widgetFieldsMatrix/additionalFieldPolicies)
  //   → provider-laag (PARAMETER provider.submit.*). Ontbreekt provider.submit dan lege maps.
  // - `provider: WidgetProviderLayer` als prop toegevoegd en doorgegeven aan ShipStepBlock
  //   (v2 ShipStepBlock verwacht 'm). Verder markup/gedrag verbatim.
  // - v1-context: getoond wanneer meerdere kandidaat-rates (no_rule/handmatig). Hosts de
  //   echte ShipStepBlock — dezelfde UI als de wizard-ship-stap — i.p.v. een tweede
  //   rate-lijst. De rates zijn al opgehaald (OrderOverview) en op het partialTemplate gezet,
  //   dus GEEN client-side rate-fetch hier. De gebruiker kiest, vult evt. extra's, en op
  //   submit geven we de pick terug aan de aanroeper (in v1 de queue-pick-rate-endpoint;
  //   v2-order-flow reikt 'm door naar de wizard-ship-stap — fail-soft zonder queue).
  import { writable, get } from "svelte/store";
  import type { ShipmentTemplate, AutomationRule } from "../types/config";
  import type { EnrichedOrder } from "../types/webshop";
  import type { WidgetProviderLayer } from "../providers/types";
  import { userPreferences } from "../state/userPreferences";
  import { shallowSnapshot } from "../api/rateFetcher";
  import { fingerprintPartsFromReusableData } from "../api/fingerprintDiscovery";
  import { isInEUCustomsTerritory } from "../utils/countries";
  import { productsHaveLineItems, invoiceReadyFor } from "../utils/laneRequirements";
  import { fieldValidity, resetFieldValidity } from "../state/formValidation";
  import { onMount } from "svelte";
  import ShipStepBlock from "./ShipStepBlock.svelte";
  import HelpIcon from "./HelpIcon.svelte";

  type Props = {
    order: EnrichedOrder;
    /** Provider-laag (fabriek-emit): validators + submit-matrices. */
    provider: WidgetProviderLayer;
    /** Full Rating objects (with reusableData/fingerprint) from the rate fetch. */
    availableRates: any[];
    partialTemplate?: any;
    userId: string;
    /** The job behind this picker was queued with the "handmatig" flag — the user explicitly
     *  wants to pick the service themselves even though a rate_selection rule exists. Strip
     *  rate_selection actions from the rules we feed the ShipStepBlock so it doesn't auto-pick
     *  and instantly auto-submit, leaving the user staring at "Wordt verwerkt". */
    skipAutoRateSelection?: boolean;
    onClose: () => void;
    onSubmit: (sel: {
      chosenRate: { carrier: string; service: string; servicecode?: string };
      extraFieldValues: Record<string, any>;
      prebuiltShipment?: ShipmentTemplate;
    }) => void;
    /** "Zending aanpassen" — close the picker and reopen the full wizard step-by-step
     *  with the data we already have, same path as the pencil button on a parked row.
     *  `startStep` pins the wizard on a specific step (e.g. "products" when the user
     *  clicked a blocked rate's "Vereist handelsfactuur"/"Vereist productdetails" badge). */
    onEditShipment?: (startStep?: string) => void;
  };
  let { order, provider, availableRates, partialTemplate, userId, skipAutoRateSelection = false, onClose, onSubmit, onEditShipment }: Props = $props();

  const fpMap = (provider.submit?.fingerprintMatrix ?? {}) as Record<string, string>;
  const fieldsMatrix = (provider.submit?.widgetFieldsMatrix ?? {}) as Record<string, string[]>;
  const policies = (provider.submit?.additionalFieldPolicies ?? {}) as Record<string, { onlyShowIf?: string }>;

  // Build a local shipment store from the partial template, with the fetched rates pre-loaded.
  // `ratesHash = shallowSnapshot(...)` marks them as fresh-for-this-snapshot so anything that
  // might inspect rate freshness sees no staleness. We never call autoFetchRates here.
  const baseTemplate: ShipmentTemplate = (() => {
    try { return partialTemplate ? JSON.parse(JSON.stringify(partialTemplate)) : ({} as any); }
    catch { return {} as any; }
  })();
  if (!baseTemplate.shipmentOptions) baseTemplate.shipmentOptions = {} as any;
  (baseTemplate as any).rates = Array.isArray(availableRates) ? availableRates : [];
  (baseTemplate as any).ratesHash = shallowSnapshot(baseTemplate);
  const shipment = writable<ShipmentTemplate>(baseTemplate);

  // In handmatig mode, strip rate_selection actions so ShipStepBlock's automator can't auto-pick
  // (and then auto-submit via on:autocomplete) the moment the modal opens. Other actions
  // (description, default_packages, product_*, paperless invoice, …) still apply — only the
  // *automatic service choice* is suppressed, since that's the part the user wanted to do by hand.
  const automationRules: AutomationRule[] = (() => {
    const base: AutomationRule[] = userPreferences?.automationRules ?? [];
    if (!skipAutoRateSelection) return base;
    return base.map((rule: any) => ({
      ...rule,
      actions: (rule.actions ?? []).filter((a: any) => a?.toType !== "rate_selection"),
    }));
  })();

  let saving = $state(false);

  // ShipStepBlock writes shipmentOptions.chosenRate + sessionKey when the user picks (and
  // chooseOption completes). That's our submit gate.
  let cr = $derived(($shipment as any)?.shipmentOptions?.chosenRate);
  let sessionKey = $derived(String(($shipment as any)?.shipmentOptions?.sessionKey ?? "").trim());

  // The required extras for the picked rate must ALL validate before we let the user submit.
  // ShipStepBlock renders an input + validator for every key in extraFieldsForChosen() (driven
  // by widgetFieldsMatrix), and each input's validation result lands in the `fieldValidity`
  // store. Without this gate the user could click "Verzenden" with e.g. an empty description,
  // the worker would bounce as "Beschrijving is verplicht.", and clicking the resulting
  // attention pill would just re-open this picker — loop. (Important when the automation rule
  // that normally fills these is disabled, or when the user came in via "handmatig" so the
  // rule's rate-selection action is suppressed and the rule path doesn't run at all.)
  let extrasAllValid = $derived.by(() => {
    if (!cr?.reusableData) return false; // nothing picked yet → nothing to check, but submit is gated by cr
    const keys = extraFieldsForChosen();
    if (!keys.length) return true;
    const v = $fieldValidity;
    return keys.every((k) => v[k] === true);
  });
  // Lane requirements of the picked rate (per-product line items / commercial invoice).
  // ShipStepBlock keeps such rates selectable so the user can inspect them (access points,
  // pickup dates) — the submit gate lives here. invoiceReadyFor's queueMode carve-out lets
  // the paperless flow through (the worker generates the invoice itself before submit).
  let laneRequirementsMet = $derived.by(() => {
    if (!cr?.reusableData) return true; // nothing picked yet — submit is gated by cr anyway
    const fp = fingerprintForChosen();
    const fields = fp ? (fieldsMatrix[fp] ?? []) : [];
    const s = $shipment as any;
    if (fields.includes("products") && !productsHaveLineItems(s)) return false;
    if (outsideEU() && fields.includes("invoice") && !invoiceReadyFor(s, true)) return false;
    return true;
  });

  let canSubmit = $derived(
    !!cr?.reusableData && !!sessionKey && extrasAllValid && laneRequirementsMet && !saving,
  );

  // Reset cross-component validation state when this picker opens so we don't inherit stale
  // entries from a previous wizard session or another picker instance — the freshly mounted
  // fields will repopulate fieldValidity as soon as they render their first validation pass.
  // Also wire Esc to close — modals without an Esc handler feel broken on a keyboard.
  onMount(() => {
    resetFieldValidity();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Don't hijack Esc when the user is in the middle of editing something obvious like a
      // <select> dropdown — those handle Esc themselves to close their popup. For text inputs
      // / textareas the user typically still wants Esc to dismiss the modal, so we let it
      // through and call onClose.
      const t = e.target as HTMLElement | null;
      if (t && t.tagName === "SELECT") return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  // ── helpers: figure out which extra-field bindPaths the picked rate needs, so we can pull
  // the user's values off $shipment on submit and send them as extraFieldValues. The worker
  // overlays those onto the prebuilt shipment server-side (step 6b of runHeadlessShipment) so
  // they outlive any rule patch the worker applies in step 6.

  function originCountry(): string {
    return String((baseTemplate as any)?.shipperAddress?.country ?? "").toUpperCase();
  }
  function destCountry(): string {
    return String(
      (baseTemplate as any)?.recipientAddress?.country ?? order?.shippingAddress?.country ?? "",
    ).toUpperCase();
  }
  function packageType(): "pallet" | "package" | "document" {
    const pkgs: any[] = Array.isArray((baseTemplate as any)?.packages)
      ? (baseTemplate as any).packages
      : [];
    if (pkgs.some((p) => p?.type === "pallet")) return "pallet";
    if (pkgs.some((p) => p?.type === "package")) return "package";
    return "document";
  }
  function outsideEU(): boolean {
    const o = originCountry();
    const d = destCountry();
    const oPostal = (baseTemplate as any)?.shipperAddress?.postalCode;
    const dPostal =
      (baseTemplate as any)?.recipientAddress?.postalCode ?? order?.shippingAddress?.postalCode;
    return (
      (!!d && !isInEUCustomsTerritory(d, dPostal)) ||
      (!!o && !isInEUCustomsTerritory(o, oPostal))
    );
  }

  function fingerprintForChosen(): string | undefined {
    if (!cr) return undefined;
    if (cr.fingerprint) return cr.fingerprint as string;
    const { carrier, service } = fingerprintPartsFromReusableData({
      choose_carrier: cr.carrier ?? cr.reusableData?.choose_carrier,
      choose_service_name: cr.service ?? cr.reusableData?.choose_service_name,
      choose_servicecode: cr.servicecode ?? cr.reusableData?.choose_servicecode ?? "",
    });
    const key = `${originCountry()}_${destCountry()}_${packageType()}_${carrier}_${service}`;
    return fpMap[key];
  }

  function extraFieldsForChosen(): string[] {
    const fp = fingerprintForChosen();
    const base = fp ? (fieldsMatrix[fp] ?? []) : [];
    const set = new Set(base);
    for (const [field, policy] of Object.entries(policies)) {
      const cond = policy?.onlyShowIf;
      if (!cond) continue;
      const show = cond === "isNonEUExportImport" ? outsideEU() : false;
      if (show) set.add(field);
      else set.delete(field);
    }
    return [...set];
  }

  function getByPath(obj: any, path: string): any {
    return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
  }

  function submit() {
    if (!canSubmit) return;
    saving = true;
    const s = get(shipment) as any;
    const c = s.shipmentOptions.chosenRate ?? {};
    // IMPORTANT: pick-rate's findRateByCarrierService matches on reusableData.choose_carrier /
    // choose_service_name / choose_servicecode (the carrier's short codes — e.g. "FED",
    // "Fedex regional economy"). The Rating's top-level `carrier` / `service` are the DISPLAY
    // names (e.g. "FedEx") and don't match — sending those leads to "Gekozen service is niet
    // meer beschikbaar — kies opnieuw" on every retry. Always prefer the reusableData fields.
    const rd = c.reusableData ?? {};
    const carrier = String(rd.choose_carrier ?? c.carrier ?? "").trim();
    const service = String(rd.choose_service_name ?? rd.choose_service ?? c.service ?? "").trim();
    const servicecode = String(rd.choose_servicecode ?? c.servicecode ?? "").trim();

    const extraFieldValues: Record<string, any> = {};
    for (const fieldKey of extraFieldsForChosen()) {
      // Field keys use underscore-separated paths (e.g. "shipmentOptions_insuranceValue"); the
      // bindPath is the same with dots. We accept whichever form `getByPath` finds first.
      const dotted = fieldKey.replace(/_/g, ".");
      const v = getByPath(s, dotted);
      if (v !== undefined && v !== null && v !== "") extraFieldValues[dotted] = v;
    }

    const prebuiltShipment: any = JSON.parse(JSON.stringify(s));
    delete prebuiltShipment.rates;
    delete prebuiltShipment.ratesHash;

    onSubmit({
      chosenRate: { carrier, service, servicecode },
      extraFieldValues,
      prebuiltShipment,
    });
  }

  // ShipStepBlock dispatches "autocomplete" when a rate-selection rule matches AND any extra
  // fields the picked rate needs are pre-filled. Treat that as the user clicking Verzenden.
  // In handmatig mode we ignore it — the whole point is the user picks manually. (We also
  // stripped rate_selection actions above so the dispatch shouldn't fire, but keep this as a
  // belt-and-braces guard.)
  function handleAutoComplete() {
    if (skipAutoRateSelection) return;
    void submit();
  }
</script>

<div
  class="fixed inset-0 z-[110] bg-black/40 flex items-center justify-center p-4"
  on:click={(e) => { if (e.target === e.currentTarget) onClose(); }}
  role="presentation"
>
  <div class="bg-white rounded-2xl shadow-xl max-w-6xl w-full max-h-[92vh] flex flex-col">
    <div class="p-6 pb-3 flex items-start justify-between gap-4 border-b border-gray-100">
      <h3 class="text-lg font-semibold inline-flex items-center gap-2">
        Kies een verzendservice
        <HelpIcon topic="rate-choice" />
      </h3>
      <button type="button" class="rounded-full p-1 hover:bg-gray-100 shrink-0" on:click={onClose} aria-label="Sluiten">✕</button>
    </div>

    <div class="flex-1 overflow-y-auto px-6 py-4">
      <ShipStepBlock
        {provider}
        {userId}
        {shipment}
        {automationRules}
        {order}
        skipChooseOption={true}
        on:autocomplete={handleAutoComplete}
        on:gotoproducts={() => onEditShipment?.("products")}
      />
    </div>

    <div class="px-6 py-3 border-t border-gray-100 flex items-center justify-end gap-3 bg-gray-50 rounded-b-2xl">
      {#if onEditShipment}
        <button
          type="button"
          class="mr-auto px-5 py-2 text-sm rounded-full border bg-white border-gray-300 font-semibold text-gray-800 hover:bg-gray-50 transition inline-flex items-center gap-2"
          on:click={() => onEditShipment?.()}
          title="Open de wizard met de huidige zendingsgegevens"
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
            aria-hidden="true"
          >
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
          </svg>
          Zending aanpassen
        </button>
      {/if}
      {#if cr?.reusableData && !laneRequirementsMet}
        <span class="text-xs text-amber-700">
          Verzenden kan pas als de douanestap compleet is —
          <button
            type="button"
            class="font-medium underline hover:no-underline"
            on:click={() => onEditShipment?.("products")}
          >douanestap invullen</button>
        </span>
      {:else if cr?.reusableData && !extrasAllValid}
        <span class="text-xs text-amber-700">Vul eerst de verplichte velden in.</span>
      {/if}
      <button
        type="button"
        class="px-5 py-2 text-sm rounded-full border bg-white border-gray-300 font-semibold text-gray-800 hover:bg-gray-50 transition"
        on:click={onClose}
      >Annuleren</button>
      <button
        type="button"
        class="px-6 py-2 text-sm rounded-full bg-blue-600 font-semibold text-white hover:bg-blue-700 transition disabled:bg-blue-600/50"
        on:click={submit}
        title={!cr?.reusableData
          ? "Kies eerst een service"
          : !laneRequirementsMet
            ? "Vul eerst de douanestap in (productdetails / handelsfactuur)"
            : !extrasAllValid
              ? "Vul de verplichte extra velden in"
              : ""}
        disabled={!canSubmit}
      >
        {saving ? "Bezig…" : "Verzenden & in wachtrij"}
      </button>
    </div>
  </div>
</div>
