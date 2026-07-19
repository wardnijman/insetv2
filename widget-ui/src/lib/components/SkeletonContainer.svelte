<script lang="ts">
  // Geport uit v1 SkeletonContainer.svelte. Wijzigingen (widget-extractie):
  // - provider-parameter: gridValidators + domain uit de fabriek-emit i.p.v.
  //   generated imports (steps/validations + steps/domain.json)
  // - paperless-domain doorgegeven aan validatePaperlessInvoice (postcode-verplicht-gedrag)
  // - paperless-generator fail-soft achter provider.paperlessInvoice (toast i.p.v. crash)
  // - §4-consolidatie op de Genereer-gate: grid-validators (validateProducts) als pre-check
  import ValidatedSelect from "./selects/ValidatedSelect.svelte";
  import ValidatedInput from "./inputs/ValidatedInput.svelte";
  import HelpIcon from "./HelpIcon.svelte";
  import type { WidgetProviderLayer } from "../providers/types";
  import type {
    ShipmentTemplate,
    ProductTemplate,
    ValidationResult,
  } from "../types/config";
  import type { Writable } from "svelte/store";
  import { get } from "svelte/store";
  import { onMount, tick } from "svelte";
  import { getCountryOptions } from "../utils/countries";
  import { setInvoiceMethod } from "../utils/skipExportDetails";
  import { fieldValidity, clearFieldValidityKey } from "../state/formValidation";
  import { currentLang, m } from "../state/messageStore";
  import { ensurePaperlessInvoiceDefaults } from "../utils/paperlessInvoiceDefaults";
  import { validatePaperlessInvoice } from "../validations/paperlessInvoice";
  import {
    applyGeneratedPaperlessInvoiceToShipment,
    generatePaperlessInvoiceForShipment,
  } from "../utils/paperlessInvoiceGenerator";
  import { userPreferences, setUserPreferences } from "../state/userPreferences";
  import { updateUserConfig } from "../api/updateUserConfig";
  import HsCodeSuggestInput from "./inputs/HsCodeSuggestInput.svelte";
  import { hsSuggestions, requestHsSuggestions } from "../api/hsSuggest";
  import type { HsSuggestion } from "../api/hsSuggest";
  import StepSection from "./wizard/StepSection.svelte";
  import { toast } from "./toast/toast";

  export let categories: [string, ProductTemplate[]][] = [];
  export let shipment: Writable<ShipmentTemplate>;
  export let userId: string | number = "demo";
  export let provider: WidgetProviderLayer;

  // Provider-laag (fabriek-emit, semantisch bewezen tegen v1): douane-grid-validators
  // + domeintabellen. v1 importeerde deze rechtstreeks uit de generated laag.
  const {
    validateItemDescription,
    validateHsCode,
    validateItemValue,
    validateItemWeight,
    validateOriginCountry,
    validateProducts,
  } = provider.gridValidators! as any;
  const domain = provider.domain as any;

  type Option = {
    value: string;
    label: string;
  };

  type LooseProductTemplate = ProductTemplate & {
    id?: string;
    productId?: string;
    category?: string;
    categoryName?: string;
    source?: string;
    isManual?: boolean;
    manual?: boolean;
  };

  const EXTRA_PRODUCTS_CATEGORY = "Extra products";

  // Opened on mount via openPaperlessInvoicePanel() (which also seeds the user's saved
  // invoice-type/currency/incoterm/export-reason defaults) — the generate button must be
  // visible because generating the invoice is required before continuing.
  let paperlessOpen = false;
  // Product-lines grid disclosure, used only in "manual_upload" mode (paperless always shows
  // it expanded). Collapsed by default there — line items are optional for an own invoice.
  let productGridOpen = false;
  // Hover state for the "?" hint next to the collapsed grid. State-driven (not CSS
  // group-hover) because that Tailwind variant doesn't render in the injected widget build.
  let productsHintOpen = false;
  let generatingPaperlessInvoice = false;
  let paperlessGenerateError = "";
  let paperlessInvoicePreviewUrl = "";

  // Generic persistence helper for widgetBehavior fields. Updates the singleton in place
  // so other widget code reading it sees the new value, then fires a background save —
  // soft-fails (next reload re-fetches from server, so a dropped write will be visible
  // when the user opens the panel again).
  function persistWidgetBehaviorPref(key: string, value: unknown) {
    const prevWb = (userPreferences?.widgetBehavior as any) ?? {};
    const nextWb = { ...prevWb, [key]: value };
    setUserPreferences({
      ...(userPreferences ?? {}),
      widgetBehavior: nextWb,
    });
    void updateUserConfig(
      `preferences.widgetBehavior.${key}`,
      value,
      String(userId),
    ).catch(() => {});
  }

  // Persisted toggle: when on, the paperless invoice's recipient.company becomes
  // "{Company} / {firstName} {lastName}" so the contact name is visible on the customs
  // document. Stored in widgetBehavior so it survives across shipments + sessions.
  let includeNameInPaperlessCompany =
    !!(userPreferences?.widgetBehavior as any)?.includeNameInPaperlessCompany;

  function setIncludeNameInPaperlessCompany(next: boolean) {
    includeNameInPaperlessCompany = next;
    persistWidgetBehaviorPref("includeNameInPaperlessCompany", next);
  }

  // Last-used paperless invoice defaults — currency / invoice type / incoterm / export
  // reason. Read once at module load, written whenever the user changes the value in the
  // panel. On panel open we inject these onto the shipment if it doesn't have its own
  // value yet (see openPaperlessInvoicePanel).
  function persistPaperlessCurrency(v: string) {
    persistWidgetBehaviorPref("paperlessDefaultCurrency", v);
  }
  function persistPaperlessInvoiceType(v: string) {
    persistWidgetBehaviorPref("paperlessDefaultInvoiceType", v);
  }
  function persistPaperlessIncoterm(v: string) {
    persistWidgetBehaviorPref("paperlessDefaultIncoterm", v);
  }
  function persistPaperlessExportReason(v: string) {
    persistWidgetBehaviorPref("paperlessDefaultExportReason", v);
  }

  // Customs step: how the commercial invoice is supplied. "paperless" = we generate it from
  // the product grid; "manual_upload" = upload your own PDF. The product grid is shown in
  // BOTH modes (line items are the customs declaration, not part of this choice — in upload
  // mode they're optional). See ../utils/skipExportDetails. Default to paperless when unset.
  $: invoiceMethod =
    ($shipment as any)?.invoiceSource === "manual_upload" ? "manual_upload" : "paperless";
  $: uploadedInvoiceName = ($shipment as any)?.invoice?.filename ?? "";

  // ── AI HS-code suggestions ──────────────────────────────────────────────
  // One batched request per grid open, only for products still missing a code.
  // Delayed slightly so the learned product-profiles (applied async in
  // ProductStepBlock) get a chance to fill fields from memory first — memory
  // outranks AI, and SKUs that memory covers are never sent to the model.
  onMount(() => {
    const timer = setTimeout(() => {
      void requestHsSuggestions(String(userId), get(shipment)?.products ?? []);
    }, 900);
    return () => clearTimeout(timer);
  });

  $: hsBySku = $hsSuggestions.bySku;

  // Silent auto-fill: as soon as suggestions land, empty HS fields get their
  // suggested code — no banner, no button. The blue dotted underline (+ the
  // model's note on hover) in the cell marks the value as AI-suggested until
  // the user edits it; a quiet counter in the category header attributes it.
  // Each SKU is filled at most once, so a deliberately cleared field never
  // gets re-filled behind the user's back.
  const hsAutoFilledSkus = new Set<string>();
  $: autoFillHsSuggestions(hsBySku);
  function autoFillHsSuggestions(bySku: Record<string, HsSuggestion>) {
    if (!Object.keys(bySku ?? {}).length) return;
    const current = get(shipment)?.products ?? [];
    const skus = new Set(
      current
        .filter(
          (p) =>
            p?.sku &&
            !p.hsCode &&
            bySku[p.sku]?.hsCode &&
            !hsAutoFilledSkus.has(p.sku),
        )
        .map((p) => p.sku as string),
    );
    if (!skus.size) return;
    skus.forEach((sku) => hsAutoFilledSkus.add(sku));
    shipment.update((s) => ({
      ...s,
      products: (s.products ?? []).map((p) =>
        p.sku && skus.has(p.sku) && !p.hsCode
          ? { ...p, hsCode: bySku[p.sku].hsCode }
          : p,
      ),
    }));
  }

  // Column headers carry a trailing "*" for required fields. In upload mode the grid is
  // optional, so strip it there. (Value/weight do this inline in the markup; description and
  // origin carry the "*" inside their i18n string, so strip it here.)
  function stripStar(s: string): string {
    return String(s ?? "").replace(/\s*\*$/, "");
  }
  $: descLabel =
    invoiceMethod === "manual_upload"
      ? stripStar(m.shipmentWizard.productStep.description)
      : m.shipmentWizard.productStep.description;
  $: originLabel =
    invoiceMethod === "manual_upload"
      ? stripStar(m.shipmentWizard.productStep.origin)
      : m.shipmentWizard.productStep.origin;

  // Gate "Verder" (the wizard's isCurrentStepValid checks `products_*` fieldValidity keys):
  //  - manual_upload → require an uploaded PDF.
  //  - paperless     → require a generated customs invoice (per-product validators do the rest).
  $: {
    if (invoiceMethod === "manual_upload") {
      const ok = !!uploadedInvoiceName;
      fieldValidity.update((v) =>
        v.products_invoice === ok ? v : { ...v, products_invoice: ok },
      );
      clearFieldValidityKey("products_paperlessInvoice");
    } else {
      const ok = hasPaperlessInvoiceAttached($shipment);
      fieldValidity.update((v) =>
        v.products_paperlessInvoice === ok ? v : { ...v, products_paperlessInvoice: ok },
      );
      clearFieldValidityKey("products_invoice");
    }
  }

  // File input for the own-invoice upload; bound so picking "Upload eigen handelsfactuur"
  // can open the picker straight away (one click instead of two).
  let invoiceFileInput: HTMLInputElement | undefined;

  // Persist + remember the chosen method so a user who always uploads doesn't have to pick it
  // every time. Only the non-default ("manual_upload") is auto-applied (paperless is default).
  async function chooseInvoiceMethod(method: "paperless" | "manual_upload") {
    setInvoiceMethod(shipment, method);
    persistWidgetBehaviorPref("lastInvoiceMethod", method);

    // Selecting "upload" wipes any prior attachment (setInvoiceMethod resets it), so the
    // upload box renders its file button — open the native picker immediately. tick() lets
    // that button mount first; we're still inside the radio-click gesture, so the browser
    // allows the programmatic open.
    if (method === "manual_upload") {
      await tick();
      invoiceFileInput?.click();
    }
  }

  onMount(() => {
    // Open + seed the paperless panel: applies the user's saved invoice-type / currency /
    // incoterm / export-reason defaults onto a fresh shipment, and shows the generate button.
    openPaperlessInvoicePanel();

    const remembered = (userPreferences?.widgetBehavior as any)?.lastInvoiceMethod;
    if (
      remembered === "manual_upload" &&
      (get(shipment) as any)?.invoiceSource !== "manual_upload"
    ) {
      setInvoiceMethod(shipment, "manual_upload");
    }
  });

  // No manual "total value" field in this step; derive it from the product values (same as
  // deriveShipmentValue at submit) when unset, so the paperless invoice validation has a
  // declared value (otherwise it fails with "Total shipment value must be greater than 0").
  $: {
    const sum = (((($shipment as any)?.products ?? []) as ProductTemplate[])).reduce(
      (acc, p) => acc + (Number((p as any)?.value) || 0),
      0,
    );
    const rounded = Math.round(sum * 100) / 100;
    const cur = Number(($shipment as any)?.shipmentOptions?.totalShipmentValue ?? 0);
    if (rounded > 0 && !(cur > 0)) {
      shipment.update((s) => ({
        ...s,
        shipmentOptions: {
          ...((s as any).shipmentOptions ?? {}),
          totalShipmentValue: rounded,
        },
      }) as any);
    }
  }

  let invoiceUploadError = "";

  async function handleInvoiceUpload(e: Event) {
    invoiceUploadError = "";
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (!/pdf$/i.test(file.type) && !/\.pdf$/i.test(file.name)) {
      invoiceUploadError = "Alleen PDF-bestanden.";
      input.value = "";
      return;
    }
    const maxKb = Number((domain as any).maxFileUploadSize ?? 2048);
    if (file.size > maxKb * 1024) {
      invoiceUploadError = `Bestand is groter dan ${maxKb} KB.`;
      input.value = "";
      return;
    }
    try {
      const base64: string = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
        r.onerror = () => reject(r.error);
        r.readAsDataURL(file);
      });
      shipment.update((s) => ({
        ...s,
        invoice: { filename: file.name, base64, contentType: "application/pdf" },
      }) as any);
    } catch {
      invoiceUploadError = "Kon het bestand niet lezen.";
    }
    input.value = "";
  }

  function removeUploadedInvoice() {
    invoiceUploadError = "";
    shipment.update((s) => ({
      ...s,
      invoice: { filename: "", base64: "", contentType: "" },
    }) as any);
  }

  const countryOptions = getCountryOptions(
    domain.countries,
    currentLang.toLowerCase(),
  );

  function prettifyOptionLabel(value: string): string {
    return value
      .replace(/_/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function normalizeOptions(
    rawOptions: any,
    fallbackOptions: Option[],
    labelMap: Record<string, string> = {},
  ): Option[] {
    const source =
      Array.isArray(rawOptions) && rawOptions.length
        ? rawOptions
        : fallbackOptions;

    return source
      .map((option: any) => {
        const value =
          typeof option === "string" ? option : option?.value ?? "";

        if (!value) return null;

        const normalizedValue = String(value);

        const fallbackLabel = fallbackOptions.find(
          (fallback) => fallback.value === normalizedValue,
        )?.label;

        const label =
          typeof option === "object" && option?.label
            ? String(option.label)
            : labelMap[normalizedValue] ??
              fallbackLabel ??
              prettifyOptionLabel(normalizedValue);

        return {
          value: normalizedValue,
          label,
        };
      })
      .filter(Boolean) as Option[];
  }

  const paperlessInvoiceTypes: Option[] = normalizeOptions(
    (domain as any).paperlessInvoiceTypes,
    [
      { value: "commercial_invoice", label: "Commercial invoice" },
      { value: "pro_forma_invoice", label: "Pro-forma invoice" },
    ],
    {
      commercial_invoice: "Commercial invoice",
      pro_forma_invoice: "Pro-forma invoice",
    },
  );

  const currencies: Option[] = normalizeOptions(
    (domain as any).currencies,
    [
      { value: "EUR", label: "EUR" },
      { value: "USD", label: "USD" },
      { value: "GBP", label: "GBP" },
      { value: "JPY", label: "JPY" },
      { value: "CNY", label: "CNY" },
      { value: "CHF", label: "CHF" },
    ],
  );

  const incotermsGroupDOptions: Option[] = normalizeOptions(
    (domain as any).incotermsGroupD,
    [
      { value: "DAP", label: "DAP" },
      { value: "DPU", label: "DPU" },
      { value: "DDP", label: "DDP" },
      { value: "EXW", label: "EXW (ex works)" },
    ],
    {
      DAP: "DAP",
      DPU: "DPU",
      DDP: "DDP",
      EXW: "EXW (ex works)",
    },
  );

  const exportReasonOptions: Option[] = normalizeOptions(
    (domain as any).exportReasonOptions,
    [
      { value: "sale", label: "Sale" },
      { value: "return", label: "Return" },
      { value: "repair_return", label: "Return after repair" },
      { value: "personal", label: "Personal" },
      { value: "sample", label: "Sample" },
      { value: "gift", label: "Gift" },
    ],
    {
      sale: "Sale",
      return: "Return",
      repair_return: "Return after repair",
      personal: "Personal",
      sample: "Sample",
      gift: "Gift",
    },
  );

  const invoiceStatementOptions: Option[] = normalizeOptions(
    (domain as any).invoiceStatementOptions,
    [
      { value: "standard", label: "Standard" },
      { value: "preferentialOrigin", label: "Preferential origin" },
      { value: "euri", label: "EURI" },
      { value: "cites", label: "CITES" },
    ],
    {
      standard: "Standard",
      preferentialOrigin: "Preferential origin",
      euri: "EURI",
      cites: "CITES",
    },
  );

  $: displayCategories = buildDisplayCategories(
    (($shipment as any)?.products ?? []) as ProductTemplate[],
    categories,
  );

  $: productValueCurrency = $shipment.paperlessInvoice?.currency ?? "EUR";

  $: paperlessValidation = validatePaperlessInvoice($shipment, {
    requireDeclarantName: false,
    requirePaymentConditions: false,
    domain,
  });

  function normalizeExportReasonValue(value: any): string {
    const normalized = String(value ?? "");

    const legacyMap: Record<string, string> = {
      retour: "return",
      "retour after repair": "repair_return",
      repairReturn: "repair_return",
      return_after_repair: "repair_return",
    };

    return legacyMap[normalized] ?? normalized;
  }

  function getProductKey(product: ProductTemplate): string {
    const loose = product as LooseProductTemplate;

    return String(
      loose.sku ??
        loose.id ??
        loose.productId ??
        loose.name ??
        "",
    );
  }

  function safeFieldKey(product: ProductTemplate): string {
    return (
      getProductKey(product)
        .replace(/[^a-zA-Z0-9_-]/g, "_")
        .replace(/_+/g, "_") || "unknown"
    );
  }

  function isManualProduct(product: ProductTemplate): boolean {
    const loose = product as LooseProductTemplate;
    const sku = getProductKey(product);

    return (
      loose.source === "manual" ||
      loose.isManual === true ||
      loose.manual === true ||
      sku.startsWith("manual-")
    );
  }

  function buildDisplayCategories(
    products: ProductTemplate[],
    sourceCategories: [string, ProductTemplate[]][] = [],
  ): [string, ProductTemplate[]][] {
    const categoryBySku = new Map<string, string>();

    for (const [categoryName, categoryProducts] of sourceCategories ?? []) {
      for (const product of categoryProducts ?? []) {
        const key = getProductKey(product);
        if (key) categoryBySku.set(key, categoryName);
      }
    }

    const grouped = new Map<string, ProductTemplate[]>();

    for (const product of products ?? []) {
      const loose = product as LooseProductTemplate;
      const key = getProductKey(product);

      const categoryName =
        loose.categoryName ||
        loose.category ||
        categoryBySku.get(key) ||
        "Products";

      if (!grouped.has(categoryName)) {
        grouped.set(categoryName, []);
      }

      grouped.get(categoryName)?.push(product);
    }

    return Array.from(grouped.entries());
  }

  async function generatePaperlessInvoice() {
    // TODO(fabriek-emit paperless): komt met de ship-stap-slice. Tot die er is heeft
    // provider.paperlessInvoice geen invulling — degradeer netjes i.p.v. crashen.
    const paperless = provider.paperlessInvoice;
    if (!paperless) {
      toast.error("Factuur genereren is nog niet beschikbaar in deze omgeving.");
      return;
    }

    paperlessGenerateError = "";

    // §4-consolidatie (blueprint): grid-validators zijn DE productlijn-waarheid; genereren
    // mag nooit met een grid-afgekeurde regel. v1 gate'te alleen op de lossere
    // validatePaperlessInvoice (HS enkel non-empty), waardoor een factuur gegenereerd kon
    // worden met een HS-code die het grid afkeurt.
    const gridResults = validateProducts(
      (($shipment as any)?.products ?? []) as ProductTemplate[],
    ) as ValidationResult[];
    const firstInvalidProduct = gridResults.find((r) => !r.valid);
    if (firstInvalidProduct) {
      paperlessGenerateError =
        firstInvalidProduct.message || "Controleer de productregels.";
      return;
    }

    generatingPaperlessInvoice = true;

    try {
      const result = await generatePaperlessInvoiceForShipment($shipment, {
        customerId: userId,
        defaultCarrier: "TFF",
        defaultCurrency: $shipment.paperlessInvoice?.currency ?? "EUR",
        defaultInvoiceType:
          $shipment.paperlessInvoice?.invoiceType ?? "commercial_invoice",
        requireDeclarantName: false,
        requirePaymentConditions: false,
        attachToTff: true,
        includeRecipientNameInCompany: includeNameInPaperlessCompany,
        domain,
      }, paperless);

      paperlessInvoicePreviewUrl = result.url ?? "";

      shipment.update((current) =>
        applyGeneratedPaperlessInvoiceToShipment(
          {
            ...current,
            paperlessInvoice: result.shipment.paperlessInvoice,
            shipmentOptions: result.shipment.shipmentOptions,
            products: result.shipment.products,
          },
          result,
        ),
      );
    } catch (error: any) {
      const validation = error?.validation;

      // Prefer the per-field issue messages over the "N fields missing" count —
      // the count alone doesn't tell the user which field to fix.
      const issueMessages = (validation?.issues ?? [])
        .map((issue: { message?: string }) => issue?.message)
        .filter(Boolean)
        .slice(0, 3)
        .join(" ");

      paperlessGenerateError =
        issueMessages ||
        validation?.message ||
        error?.message ||
        "Could not generate paperless invoice.";
    } finally {
      generatingPaperlessInvoice = false;
    }
  }

  function calculateQuantity(product: ProductTemplate) {
    const assignedQuantity =
      product.packageAssignments?.reduce((total, assignment) => {
        const perSku = assignment[product.sku];

        return (
          total +
          (perSku
            ? Object.values(perSku).reduce(
                (a, b) => Number(a) + Number(b),
                0,
              )
            : 0)
        );
      }, 0) ?? 0;

    return assignedQuantity || product.quantity || 1;
  }

  function setDeep(obj: any, path: string, value: any): void {
    const keys = path.split(".");
    const last = keys.pop();
    if (!last) return;

    const target = keys.reduce((current, key) => {
      current[key] ??= {};
      return current[key];
    }, obj);

    target[last] = value;
  }

  function updateShipmentPath(path: string, value: any) {
    shipment.update((s) => {
      const next = { ...s };
      setDeep(next, path, value);
      return next;
    });
  }

  function updateProductField(
    product: ProductTemplate,
    field: string,
    value: any,
  ) {
    shipment.update((s) => {
      const currentProducts = [
        ...(((s as any).products ?? []) as ProductTemplate[]),
      ];

      const productKey = getProductKey(product);

      const index = currentProducts.findIndex((candidate) => {
        const candidateKey = getProductKey(candidate);

        return (
          candidate === product ||
          Boolean(productKey && candidateKey === productKey)
        );
      });

      if (index === -1) return s;

      currentProducts[index] = {
        ...(currentProducts[index] as any),
        [field]: value,
      };

      return {
        ...s,
        products: currentProducts,
      };
    });
  }

  function updateProductQuantity(product: ProductTemplate, value: any) {
    const quantity = Math.max(1, Number(value) || 1);

    // Edit quantity → also drop any existing packageAssignments for this product. The
    // assignments were sized for the previous total; leaving them in place would make
    // `calculateQuantity` silently override what the user just typed (it prefers the
    // assignment sum). The package step will re-allocate against the new count.
    shipment.update((s) => {
      const currentProducts = [
        ...(((s as any).products ?? []) as ProductTemplate[]),
      ];

      const productKey = getProductKey(product);
      const index = currentProducts.findIndex((candidate) => {
        const candidateKey = getProductKey(candidate);
        return (
          candidate === product ||
          Boolean(productKey && candidateKey === productKey)
        );
      });
      if (index === -1) return s;

      const { packageAssignments: _drop, ...rest } = currentProducts[index] as any;
      currentProducts[index] = { ...rest, quantity } as ProductTemplate;

      return { ...s, products: currentProducts };
    });
  }

  function getDefaultOriginCountry(template: ShipmentTemplate): string {
    return (
      (template as any)?.shipmentOptions?.shipmentOriginCountry ||
      (template as any)?.shipperAddress?.country ||
      "NL"
    );
  }

  function createManualProduct(template: ShipmentTemplate): ProductTemplate {
    const id = `manual-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 7)}`;

    return {
      sku: id,
      name: "",
      description: "",
      hsCode: "",
      value: "" as any,
      weight: "" as any,
      originCountry: getDefaultOriginCountry(template),
      quantity: 1,
      category: EXTRA_PRODUCTS_CATEGORY,
      categoryName: EXTRA_PRODUCTS_CATEGORY,
      source: "manual",
      isManual: true,
      // v1 castte direct `as ProductTemplate`; het doel-type heeft currency/createdAt/
      // updatedAt verplicht, dus hier via unknown (zelfde runtime-object als v1).
    } as unknown as ProductTemplate;
  }

  function addManualProduct() {
    shipment.update((s) => {
      const products = [...(((s as any).products ?? []) as ProductTemplate[])];

      return {
        ...s,
        products: [...products, createManualProduct(s)],
      };
    });
  }

  function removeProduct(product: ProductTemplate) {
    shipment.update((s) => {
      const productKey = getProductKey(product);
      const products = (((s as any).products ?? []) as ProductTemplate[]).filter(
        (candidate) => getProductKey(candidate) !== productKey,
      );

      // Manual products never get re-synced from the order, so we don't need to track
      // them in the removed list. For everything else: record the SKU so the sync block
      // in ProductStepBlock doesn't immediately add it back from order.orderedItems.
      if (isManualProduct(product)) {
        return { ...s, products };
      }

      const prevRemoved = ((s as any).removedProductSkus ?? []) as string[];
      const sku = (product as any).sku;
      const removedProductSkus = sku && !prevRemoved.includes(sku)
        ? [...prevRemoved, sku]
        : prevRemoved;

      return { ...s, products, removedProductSkus } as ShipmentTemplate;
    });
  }

  function openPaperlessInvoicePanel() {
    paperlessOpen = true;

    shipment.update((s) => {
      // Seed paperless defaults from the user's last-used values. The shipment's own
      // values win — these only kick in for a fresh shipment with no paperlessInvoice
      // populated yet (or no shipmentOptions.incotermsGroupD / exportReason).
      const wb = (userPreferences?.widgetBehavior as any) ?? {};

      const next = ensurePaperlessInvoiceDefaults(s, {
        declarantName: "",
        declarantPosition: "",
        defaultCarrier: "TFF",
        defaultCurrency:
          s.paperlessInvoice?.currency ?? wb.paperlessDefaultCurrency ?? "EUR",
        defaultInvoiceType:
          s.paperlessInvoice?.invoiceType ??
          wb.paperlessDefaultInvoiceType ??
          "commercial_invoice",
      });

      // ensurePaperlessInvoiceDefaults doesn't touch shipmentOptions.incotermsGroupD or
      // exportReason, so inject the last-used values inline.
      if (!next.shipmentOptions?.incotermsGroupD && wb.paperlessDefaultIncoterm) {
        (next as any).shipmentOptions ??= {};
        (next as any).shipmentOptions.incotermsGroupD = wb.paperlessDefaultIncoterm;
      }
      if (!next.shipmentOptions?.exportReason && wb.paperlessDefaultExportReason) {
        (next as any).shipmentOptions ??= {};
        (next as any).shipmentOptions.exportReason = wb.paperlessDefaultExportReason;
      }

      const currentExportReason = (next as any)?.shipmentOptions?.exportReason;
      const normalizedExportReason =
        normalizeExportReasonValue(currentExportReason);

      if (currentExportReason && currentExportReason !== normalizedExportReason) {
        (next as any).shipmentOptions ??= {};
        (next as any).shipmentOptions.exportReason = normalizedExportReason;
      }

      return next;
    });
  }

  function togglePaperlessInvoicePanel() {
    if (paperlessOpen) {
      paperlessOpen = false;
      return;
    }

    openPaperlessInvoicePanel();
  }

  function updateInvoiceStatement(key: string, checked: boolean) {
    updateShipmentPath(`paperlessInvoice.invoiceStatement.${key}`, checked);
  }

  function getInvoiceStatementValue(key: string): boolean {
    return Boolean(
      ($shipment as any)?.paperlessInvoice?.invoiceStatement?.[key],
    );
  }

  function hasPaperlessInvoiceAttached(template: ShipmentTemplate) {
    return (
      template.invoiceSource === "paperless" &&
      Boolean(template.invoice?.filename || template.invoice?.base64)
    );
  }
</script>

<div class="w-full min-h-[400px] text-sm text-gray-800">
  <!-- Factuurkeuze bovenaan; daaronder de productregels (douane-aangifte). Paperless =
       grid uitgeklapt + verplicht; eigen factuur = grid ingeklapt als optioneel. -->
  <StepSection
    label={m.shipmentWizard.productStep.invoiceMethodLabel ?? "Handelsfactuur"}
  >
    <svelte:fragment slot="actions">
      <HelpIcon topic="customs-invoice" />
    </svelte:fragment>

    <div>
      <!-- Segmented control mirrors the old radios 1:1; the guard replicates radio
           `change` semantics (re-clicking the active option must be a no-op —
           chooseInvoiceMethod resets the attached invoice on every call). -->
      <div
        class="seg"
        role="group"
        aria-label={m.shipmentWizard.productStep.invoiceMethodLabel ??
          "Handelsfactuur"}
      >
        <button
          type="button"
          class:on={invoiceMethod === "paperless"}
          on:click={() => {
            if (invoiceMethod !== "paperless") chooseInvoiceMethod("paperless");
          }}
        >
          Paperless (PLT)
        </button>
        <button
          type="button"
          class:on={invoiceMethod === "manual_upload"}
          on:click={() => {
            if (invoiceMethod !== "manual_upload")
              chooseInvoiceMethod("manual_upload");
          }}
        >
          Upload eigen handelsfactuur
        </button>
      </div>
    </div>
  </StepSection>

  <!-- Productregels (douane-aangifte). In upload-modus ingeklapt als optioneel — alleen
       nodig voor vervoerders die line items eisen (zoals DHL). -->
  <StepSection
    label={m.shipmentWizard.productStep.productLinesLabel ?? "Productregels"}
  >
    <svelte:fragment slot="actions">
      {#if invoiceMethod === "manual_upload"}
        <span class="text-xs text-gray-400"
          >{m.shipmentWizard.productStep.optionalLabel ?? "(optioneel)"}</span
        >
        <span
          class="relative inline-flex"
          on:mouseenter={() => (productsHintOpen = true)}
          on:mouseleave={() => (productsHintOpen = false)}
        >
          <span
            class="inline-flex h-4 w-4 items-center justify-center rounded-full border border-gray-300 text-[10px] leading-none text-gray-400 cursor-help"
            aria-label="Uitleg productregels"
          >?</span>
          {#if productsHintOpen}
            <span
              class="pointer-events-none absolute left-1/2 top-[160%] z-[60] w-60 -translate-x-1/2 rounded bg-gray-800 px-2 py-1.5 text-xs font-normal leading-snug text-white shadow-lg"
            >
              Sommige vervoerdersdiensten zoals DHL verwachten altijd productregels bij exportzendingen.
            </span>
          {/if}
        </span>
        <button
          type="button"
          class="text-xs text-gray-500 hover:text-gray-800 underline decoration-dotted"
          on:click={() => (productGridOpen = !productGridOpen)}
        >
          {productGridOpen
            ? m.shipmentWizard.productStep.hideProductLines ?? "Verbergen"
            : m.shipmentWizard.productStep.showProductLines ?? "Tonen"}
        </button>
      {/if}
    </svelte:fragment>

    {#if invoiceMethod !== "manual_upload" || productGridOpen}
  <div>
  <div
    class="grid grid-cols-[8%_24%_22%_10%_10%_10%_16%] border-b border-gray-100 pb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400 leading-tight select-none"
  >
    <div></div>

    <div>
      <div class="px-2">{m.shipmentWizard.productStep.product}</div>
    </div>

    <div>
      <div class="px-2">{descLabel}</div>
    </div>

    <div>
      <div class="px-2">{m.shipmentWizard.productStep.hsCode}</div>
    </div>

    <div>
      <div class="px-2 whitespace-nowrap">
        {m.shipmentWizard.productStep.value}<span
          class="text-[9px] align-top">({productValueCurrency})</span>{#if invoiceMethod !== "manual_upload"}&nbsp;*{/if}
      </div>
    </div>

    <div>
      <div class="px-2 whitespace-nowrap">
        {m.shipmentWizard.productStep.weight}<span
          class="text-[10px] align-top">(kg)</span>{#if invoiceMethod !== "manual_upload"}&nbsp;*{/if}
      </div>
    </div>

    <div>
      <div class="px-2">{originLabel}</div>
    </div>
  </div>

  {#each displayCategories as [categoryName, products] (categoryName)}
    {@const aiMarked = products.filter(
      (p) => p?.sku && p.hsCode && hsBySku[p.sku]?.hsCode === p.hsCode,
    ).length}
    <div class="mb-2 last:mb-0">
      <div
        class="flex items-center justify-between border-b border-gray-100 px-2 py-2 text-xs font-semibold text-gray-600"
      >
        <span>{categoryName}</span>

        <span class="flex items-center gap-3 font-normal">
          {#if aiMarked > 0}
            <!-- Quiet attribution for the silent auto-fill; the count drops
                 as the user confirms/edits fields, and it disappears once
                 nothing AI-suggested is left. -->
            <span class="flex items-center gap-1 text-xs text-gray-400">
              <svg
                viewBox="0 0 24 24"
                fill="currentColor"
                class="h-2.5 w-2.5 shrink-0"
              >
                <path
                  d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z"
                />
              </svg>
              {aiMarked}
              {aiMarked === 1
                ? m.shipmentWizard.productStep.hsSuggest?.autoFilledOne ??
                  "HS-code automatisch ingevuld"
                : m.shipmentWizard.productStep.hsSuggest?.autoFilledMany ??
                  "HS-codes automatisch ingevuld"}
            </span>
          {/if}
          <span class="text-xs text-gray-400">
            {products.length}
            {m.shipmentWizard.productStep.products}
          </span>
        </span>
      </div>

      {#each products as product (getProductKey(product))}
        <div
          class="grid grid-cols-[8%_24%_22%_10%_10%_10%_16%] items-center border-b border-gray-100 py-2 text-sm transition hover:bg-gray-50"
        >
          <div class="text-xs text-gray-500 text-center select-none">
            <!-- Quantity input is editable for every product, not just manual ones.
                 No leading × multiplier symbol: the trash icon in the name column is
                 the unambiguous delete affordance. (The old invisible ×-placeholder
                 relied on the Tailwind `invisible` utility, which host CSS can beat
                 in the injected build — spacing is handled by the flex layout now.) -->
            <div class="flex items-center justify-center px-1">
              <input
                type="number"
                min="1"
                step="1"
                class="w-10 h-[28px] rounded border border-transparent hover:border-gray-200 focus:border-blue-400 bg-transparent text-center text-xs text-gray-600 focus:outline-none"
                value={calculateQuantity(product)}
                on:input={(e) =>
                  updateProductQuantity(
                    product,
                    (e.currentTarget as HTMLInputElement).value,
                  )}
              />
            </div>
          </div>

          <div class="flex items-center gap-2 min-w-0 px-2">
            {#if product.imageUrl}
              <img
                src={product.imageUrl}
                alt={product.name || "Product image"}
                class="w-8 h-8 object-cover rounded shrink-0"
              />
            {/if}

            {#if isManualProduct(product)}
              <input
                class="min-w-0 flex-1 h-[30px] border border-transparent bg-transparent px-1 text-sm text-gray-700 truncate hover:border-gray-200 focus:border-blue-400 focus:bg-white focus:outline-none"
                placeholder="Product name"
                value={product.name ?? ""}
                on:input={(e) =>
                  updateProductField(
                    product,
                    "name",
                    (e.currentTarget as HTMLInputElement).value,
                  )}
              />
            {:else}
              <span class="truncate flex-1 min-w-0" title={product.name}>
                {product.name}
              </span>
            {/if}

            <!-- Always-visible delete affordance. Uses a real trash icon and a clearly
                 visible grey so the action is obvious; turns red on direct hover. No
                 row-level group-hover (collides with ValidatedInput's unnamed `group`
                 used for its error tooltip). -->
            <button
              type="button"
              class="shrink-0 inline-flex items-center justify-center h-6 w-6 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
              aria-label="Remove product"
              title="Remove product"
              on:click={() => removeProduct(product)}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="w-3.5 h-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6M14 11v6" />
                <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
              </svg>
            </button>
          </div>

          <div class="pl-[4px] pr-[8px]">
            <ValidatedInput
              name={`products_${safeFieldKey(product)}_description`}
              type="text"
              bind:value={product.description}
              placeholder={m.shipmentWizard.productStep.descriptionPlaceholder}
              shipmentTemplate={$shipment}
              validator={{
                dependsOn: (t) => ({ src: t?.invoiceSource }),
                validate: ({ src }) =>
                  src === "manual_upload"
                    ? { valid: true, message: "" }
                    : validateItemDescription(product),
              }}
              compactValidation={true}
              inputClass={"py-[5px] px-2 text-[13px] leading-tight"}
            />
          </div>

          <div class="pl-[4px] pr-[8px]">
            <HsCodeSuggestInput
              name={`products_${safeFieldKey(product)}_hsCode`}
              placeholder={m.shipmentWizard.productStep.hsSuggest
                ?.searchPlaceholder ?? "Zoek code…"}
              bind:value={product.hsCode}
              shipmentTemplate={$shipment}
              suggestion={product.sku ? hsBySku[product.sku] : undefined}
              userId={String(userId)}
              searchProduct={{
                name: product.name,
                description: product.description,
              }}
              validator={{
                dependsOn: (t) => ({ src: t?.invoiceSource }),
                validate: ({ src }) =>
                  src === "manual_upload"
                    ? { valid: true, message: "" }
                    : validateHsCode(product),
              }}
              inputClass={"py-[5px] px-2 text-[13px] leading-tight"}
            />
          </div>

          <div class="pl-[3px] pr-[8px]">
            <ValidatedInput
              name={`products_${safeFieldKey(product)}_value`}
              type="number"
              bind:value={product.value}
              shipmentTemplate={$shipment}
              validator={{
                dependsOn: (t) => ({ src: t?.invoiceSource }),
                validate: ({ src }) =>
                  src === "manual_upload"
                    ? { valid: true, message: "" }
                    : validateItemValue(product),
              }}
              compactValidation={true}
              inputClass={"py-[5px] px-2 text-[13px] leading-tight"}
            />
          </div>

          <div class="pl-[4px] pr-[8px]">
            <ValidatedInput
              name={`products_${safeFieldKey(product)}_weight`}
              type="number"
              bind:value={product.weight}
              shipmentTemplate={$shipment}
              validator={{
                dependsOn: (t) => ({ src: t?.invoiceSource }),
                validate: ({ src }) =>
                  src === "manual_upload"
                    ? { valid: true, message: "" }
                    : validateItemWeight(product),
              }}
              compactValidation={true}
              inputClass={"py-[5px] px-2 text-[13px] leading-tight"}
            />
          </div>

          <div class="pl-[4px] pr-[8px]">
            <ValidatedSelect
              name={`products_${safeFieldKey(product)}_originCountry`}
              bind:value={product.originCountry}
              shipmentTemplate={$shipment}
              validator={{
                dependsOn: (t) => ({ src: t?.invoiceSource }),
                validate: ({ src }) =>
                  src === "manual_upload"
                    ? { valid: true, message: "" }
                    : validateOriginCountry(product),
              }}
              options={countryOptions}
              compactValidation={true}
              inputClass={"py-[5px] px-2 text-[13px] leading-tight"}
            />
          </div>
        </div>
      {/each}
    </div>
  {/each}

  <div class="pt-1">
    <button
      type="button"
      class="text-xs text-gray-500 hover:text-gray-800 underline decoration-dotted"
      on:click={addManualProduct}
    >
      + Extra product toevoegen
    </button>
  </div>
  </div>
    {/if}
  </StepSection>

  {#if invoiceMethod === "manual_upload"}
    <StepSection
      label={m.shipmentWizard.productStep.uploadInvoiceLabel ??
        "Eigen handelsfactuur"}
    >
      <div class="rounded-lg border border-gray-200 bg-gray-50 px-4 py-4">
        {#if uploadedInvoiceName}
          <div class="flex items-center justify-between gap-3">
            <span class="flex min-w-0 items-center gap-2 text-sm text-gray-800">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-4 w-4 shrink-0 text-gray-400"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.7"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              <span class="truncate">{uploadedInvoiceName}</span>
            </span>
            <button
              type="button"
              on:click={removeUploadedInvoice}
              class="shrink-0 text-xs text-gray-500 hover:text-gray-800 underline decoration-dotted"
            >
              Verwijderen
            </button>
          </div>
        {:else}
          <label
            class="inline-flex items-center gap-2 cursor-pointer rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            <span class="text-base leading-none">＋</span>
            <span>Handelsfactuur uploaden (PDF)</span>
            <!-- Visually hidden via scoped CSS, NOT the Tailwind `hidden` utility —
                 host-page CSS in the TFF back-office can override @layer utilities,
                 which would surface the raw file input. Must stay in the DOM
                 (bind:this + programmatic .click() from chooseInvoiceMethod). -->
            <input
              bind:this={invoiceFileInput}
              type="file"
              accept=".pdf,application/pdf"
              class="file-input"
              on:change={handleInvoiceUpload}
            />
          </label>
        {/if}
        {#if invoiceUploadError}
          <p class="mt-2 text-xs text-red-600">{invoiceUploadError}</p>
        {/if}
      </div>
    </StepSection>
  {:else}
  <StepSection
    label={m.shipmentWizard.productStep.paperlessPanelLabel ?? "Customs invoice"}
  >
    <svelte:fragment slot="actions">
      <button
        type="button"
        class="text-xs text-gray-500 hover:text-gray-800 underline decoration-dotted"
        on:click={togglePaperlessInvoicePanel}
      >
        {paperlessOpen ? "Hide details" : "Create paperless invoice"}
      </button>
    </svelte:fragment>

    <div class="text-xs text-gray-400">
      {#if hasPaperlessInvoiceAttached($shipment)}
        Paperless invoice attached
        {#if $shipment.invoice?.filename}
          · {$shipment.invoice.filename}
        {/if}
      {:else}
        Generate a paperless commercial invoice from these products.
      {/if}
    </div>

    {#if paperlessOpen}
      <div class="space-y-5">
        <div>
          <div
            class="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400"
          >
            Invoice
          </div>

          <div class="grid gap-x-4 gap-y-4 sm:grid-cols-2 md:grid-cols-4">
            <label>
              <span class="mb-1 block text-xs text-gray-500">Invoice type</span>

              <select
                class="pfield"
                value={$shipment.paperlessInvoice?.invoiceType ?? ""}
                on:change={(e) => {
                  const v = (e.currentTarget as HTMLSelectElement).value;
                  updateShipmentPath("paperlessInvoice.invoiceType", v);
                  persistPaperlessInvoiceType(v);
                }}
              >
                <option value="" disabled>Select...</option>
                {#each paperlessInvoiceTypes as option}
                  <option value={option.value}>{option.label}</option>
                {/each}
              </select>
            </label>

            <label>
              <span class="mb-1 block text-xs text-gray-500">Currency</span>

              <select
                class="pfield"
                value={$shipment.paperlessInvoice?.currency ?? ""}
                on:change={(e) => {
                  const v = (e.currentTarget as HTMLSelectElement).value;
                  updateShipmentPath("paperlessInvoice.currency", v);
                  persistPaperlessCurrency(v);
                }}
              >
                <option value="" disabled>Select...</option>
                {#each currencies as option}
                  <option value={option.value}>{option.label}</option>
                {/each}
              </select>
            </label>

            <label>
              <span class="mb-1 block text-xs text-gray-500">Delivery terms</span>

              <select
                class="pfield"
                value={$shipment.shipmentOptions?.incotermsGroupD ?? ""}
                on:change={(e) => {
                  const v = (e.currentTarget as HTMLSelectElement).value;
                  updateShipmentPath("shipmentOptions.incotermsGroupD", v);
                  persistPaperlessIncoterm(v);
                }}
              >
                <option value="" disabled>Select...</option>
                {#each incotermsGroupDOptions as option}
                  <option value={option.value}>{option.label}</option>
                {/each}
              </select>
            </label>

            <label>
              <span class="mb-1 block text-xs text-gray-500">Export reason</span>

              <select
                class="pfield"
                value={normalizeExportReasonValue(
                  $shipment.shipmentOptions?.exportReason ?? "",
                )}
                on:change={(e) => {
                  const v = (e.currentTarget as HTMLSelectElement).value;
                  updateShipmentPath("shipmentOptions.exportReason", v);
                  persistPaperlessExportReason(v);
                }}
              >
                <option value="" disabled>Select...</option>
                {#each exportReasonOptions as option}
                  <option value={option.value}>{option.label}</option>
                {/each}
              </select>
            </label>
          </div>

          {#if $shipment.shipmentOptions?.incotermsGroupD === "DDP"}
            <div
              class="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-800"
            >
              <span class="font-medium">Inklaringskosten: €43,-</span><br />
              BTW en invoerrechten worden achteraf doorbelast, vermeerderd met
              een voorschotvergoeding van 3% van het voorgeschoten bedrag, met
              een minimum van €25,-.
            </div>
          {/if}

          <label class="mt-3 flex items-center gap-2 text-[12px] text-gray-600 cursor-pointer select-none">
            <input
              type="checkbox"
              class="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:outline-none focus:ring-0 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-0"
              checked={includeNameInPaperlessCompany}
              on:change={(e) =>
                setIncludeNameInPaperlessCompany(
                  (e.currentTarget as HTMLInputElement).checked,
                )}
            />
            <span>
              Voor- en achternaam van ontvanger in bedrijfsnaam zetten
              <span class="text-gray-400">— Bedrijf / Voornaam Achternaam</span>
            </span>
          </label>
        </div>

        <div>
          <div
            class="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400"
          >
            Registration
          </div>

          <div class="grid gap-x-4 gap-y-4 sm:grid-cols-2 md:grid-cols-4">
            <label>
              <span class="mb-1 block text-xs text-gray-500">VAT shipper</span>

              <input
                class="pfield"
                value={$shipment.paperlessInvoice?.vatNumberShipper ?? ""}
                on:input={(e) =>
                  updateShipmentPath(
                    "paperlessInvoice.vatNumberShipper",
                    (e.currentTarget as HTMLInputElement).value,
                  )}
              />
            </label>

            <label>
              <span class="mb-1 block text-xs text-gray-500">VAT consignee</span>

              <input
                class="pfield"
                value={$shipment.paperlessInvoice?.vatNumberConsignee ?? ""}
                on:input={(e) =>
                  updateShipmentPath(
                    "paperlessInvoice.vatNumberConsignee",
                    (e.currentTarget as HTMLInputElement).value,
                  )}
              />
            </label>

            <label>
              <span class="mb-1 block text-xs text-gray-500">EORI shipper</span>

              <input
                class="pfield"
                value={$shipment.paperlessInvoice?.eoriNumberShipper ?? ""}
                on:input={(e) =>
                  updateShipmentPath(
                    "paperlessInvoice.eoriNumberShipper",
                    (e.currentTarget as HTMLInputElement).value,
                  )}
              />
            </label>

            <label>
              <span class="mb-1 block text-xs text-gray-500">
                EORI consignee
              </span>

              <input
                class="pfield"
                value={$shipment.paperlessInvoice?.eoriNumberConsignee ?? ""}
                on:input={(e) =>
                  updateShipmentPath(
                    "paperlessInvoice.eoriNumberConsignee",
                    (e.currentTarget as HTMLInputElement).value,
                  )}
              />
            </label>
          </div>
        </div>

        <div>
          <div
            class="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400"
          >
            References
          </div>

          <div class="grid gap-x-4 gap-y-4 sm:grid-cols-3">
            <label>
              <span class="mb-1 block text-xs text-gray-500">
                Payment conditions
              </span>

              <input
                class="pfield"
                placeholder="Example: 14 days"
                value={$shipment.paperlessInvoice?.paymentConditions ?? ""}
                on:input={(e) =>
                  updateShipmentPath(
                    "paperlessInvoice.paymentConditions",
                    (e.currentTarget as HTMLInputElement).value,
                  )}
              />
            </label>

            <label>
              <span class="mb-1 block text-xs text-gray-500">Carrier</span>

              <input
                class="pfield"
                value={$shipment.paperlessInvoice?.carrier ?? ""}
                on:input={(e) =>
                  updateShipmentPath(
                    "paperlessInvoice.carrier",
                    (e.currentTarget as HTMLInputElement).value,
                  )}
              />
            </label>

            <label>
              <span class="mb-1 block text-xs text-gray-500">
                Receiver reference
              </span>

              <input
                class="pfield"
                value={$shipment.paperlessInvoice?.receiverReference ?? ""}
                on:input={(e) =>
                  updateShipmentPath(
                    "paperlessInvoice.receiverReference",
                    (e.currentTarget as HTMLInputElement).value,
                  )}
              />
            </label>
          </div>
        </div>

        <div>
          <div
            class="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400"
          >
            Declaration
          </div>

          <div class="space-y-3">
            <label>
              <span class="mb-1 block text-xs text-gray-500">Remarks</span>

              <textarea
                class="pfield pfield-area"
                value={$shipment.paperlessInvoice?.remarks ?? ""}
                on:input={(e) =>
                  updateShipmentPath(
                    "paperlessInvoice.remarks",
                    (e.currentTarget as HTMLTextAreaElement).value,
                  )}
              ></textarea>
            </label>

            <div>
              <span class="mb-1 block text-xs text-gray-500">
                Invoice statement
              </span>

              <div class="flex flex-wrap gap-x-4 gap-y-1.5">
                {#each invoiceStatementOptions as option}
                  <label
                    class="inline-flex items-center gap-1.5 text-[13px] text-gray-600"
                  >
                    <input
                      type="checkbox"
                      class="w-3.5 h-3.5 border-gray-300"
                      checked={getInvoiceStatementValue(option.value)}
                      on:change={(e) =>
                        updateInvoiceStatement(
                          option.value,
                          (e.currentTarget as HTMLInputElement).checked,
                        )}
                    />

                    <span>{option.label}</span>
                  </label>
                {/each}
              </div>
            </div>

            <div class="grid gap-x-4 gap-y-4 sm:grid-cols-2">
              <label>
                <span class="mb-1 block text-xs text-gray-500">Your name</span>

                <input
                  class="pfield"
                  value={$shipment.paperlessInvoice?.declarantName ?? ""}
                  on:input={(e) =>
                    updateShipmentPath(
                      "paperlessInvoice.declarantName",
                      (e.currentTarget as HTMLInputElement).value,
                    )}
                />
              </label>

              <label>
                <span class="mb-1 block text-xs text-gray-500">
                  Your position
                </span>

                <input
                  class="pfield"
                  value={$shipment.paperlessInvoice?.declarantPosition ?? ""}
                  on:input={(e) =>
                    updateShipmentPath(
                      "paperlessInvoice.declarantPosition",
                      (e.currentTarget as HTMLInputElement).value,
                    )}
                />
              </label>
            </div>
          </div>
        </div>

        <div class="flex items-center justify-between pt-2">
          <div class="text-xs text-gray-400">
            {#if paperlessGenerateError}
              <span class="text-red-500">{paperlessGenerateError}</span>
            {:else if hasPaperlessInvoiceAttached($shipment)}
              <span>
                Invoice generated
                {#if $shipment.invoice?.filename}
                  · {$shipment.invoice.filename}
                {/if}

                {#if paperlessInvoicePreviewUrl}
                  ·
                  <a
                    href={paperlessInvoicePreviewUrl}
                    target="_blank"
                    rel="noreferrer"
                    class="text-blue-600 hover:underline"
                  >
                    Open
                  </a>
                {/if}
              </span>
            {:else if !paperlessValidation.valid}
              <div class="space-y-0.5">
                {#each paperlessValidation.issues.slice(0, 5) as issue (issue.path)}
                  <div>{issue.message}</div>
                {/each}
                {#if paperlessValidation.issues.length > 5}
                  <div>
                    +{paperlessValidation.issues.length - 5} more field{paperlessValidation.issues.length - 5 === 1 ? "" : "s"}
                  </div>
                {/if}
              </div>
            {:else}
              Ready to generate invoice.
            {/if}
          </div>

          <button
            type="button"
            class="rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
            disabled={!paperlessValidation.valid || generatingPaperlessInvoice}
            on:click={generatePaperlessInvoice}
          >
            {generatingPaperlessInvoice ? "Generating..." : "Generate invoice"}
          </button>
        </div>
      </div>
    {/if}
  </StepSection>
  {/if}
</div>

<style>
  /* Segmented Paperless/Upload control — same pattern as ReceiverStepBlock's
     Bedrijf/Particulier toggle; scoped so host CSS can't touch it. */
  .seg {
    display: inline-flex;
    background: #f3f4f6;
    border-radius: 9px;
    padding: 3px;
  }

  .seg button {
    border: 0;
    background: transparent;
    padding: 6px 18px;
    border-radius: 7px;
    font-family: inherit;
    font-size: 13px;
    font-weight: 500;
    color: #6b7280;
    cursor: pointer;
    transition:
      background 0.15s ease,
      color 0.15s ease;
  }

  .seg button.on {
    background: #ffffff;
    color: #1f2937;
    box-shadow: 0 1px 2px rgba(16, 24, 40, 0.1);
  }

  /* Hidden file input for the own-invoice upload. Scoped CSS instead of the
     Tailwind `hidden` utility: the TFF host page's CSS outranks Tailwind v4
     @layer utilities in the injected build, which would surface the raw input. */
  .file-input {
    display: none;
  }

  /* Plain (non-validated) fields in the paperless-invoice panel. Matches the
     ValidatedInput look (gray-300 border, rounded, blue focus) via scoped CSS
     so the host page can't restyle them. */
  .pfield {
    width: 100%;
    height: 34px;
    border: 1px solid #d1d5db;
    border-radius: 7px;
    background: #ffffff;
    padding: 0 10px;
    font-family: inherit;
    font-size: 13px;
    color: #374151;
    outline: none;
    transition: border-color 0.15s ease;
  }

  .pfield::placeholder {
    color: #9ca3af;
  }

  .pfield:focus {
    border-color: #60a5fa;
  }

  .pfield-area {
    height: auto;
    min-height: 58px;
    padding: 6px 10px;
    resize: none;
  }

  @media (prefers-reduced-motion: reduce) {
    .seg button,
    .pfield {
      transition: none;
    }
  }
</style>
