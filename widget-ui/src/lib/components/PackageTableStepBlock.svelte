<!-- Geport uit v1 PackageTableStepBlock.svelte; wijziging (widget-extractie):
     pakket-validators uit de provider-parameter i.p.v. generated imports.
     Table-style packages editor (the only packages editor).
     One ROW = one package *type* with an "Aantal" (quantity); on sync each row
     expands into `qty` individual colli in shipment.packages, so everything
     downstream (getRates / submitShipment / validation) is unchanged. -->
<script lang="ts">
  import { onMount } from "svelte";
  import { get, writable, type Writable } from "svelte/store";

  import ValidatedInput from "./inputs/ValidatedInput.svelte";
  import PackageTemplateBar from "./PackageTemplateBar.svelte";
  import StepSection from "./wizard/StepSection.svelte";

  import { useFieldValidity } from "../state/userFormValidationSection";
  import { fieldValidity } from "../state/formValidation";
  import { m } from "../state/messageStore";

  import type {
    PackageTemplate,
    ShipmentTemplate,
    TruckShipmentInformation,
  } from "../types/config";

  import type { WidgetProviderLayer } from "../providers/types";

  import { isInEUCustomsTerritory } from "../utils/countries";
  import { apiBaseUrl } from "../api/global";
  import { updateUserConfig } from "../api/updateUserConfig";
  import { setUserPreferences, userPreferences } from "../state/userPreferences";

  export let order: any;
  export let shipment: Writable<ShipmentTemplate>;
  export let userId: string;
  export let provider: WidgetProviderLayer;

  // Pakket-rij-validators uit de provider-PARAMETER (widget-extractie; v1
  // importeerde ze hardcoded uit de generated laag B_getRates_0.validations).
  const {
    length: validatePackageLength,
    width: validatePackageWidth,
    height: validatePackageHeight,
    weight: validatePackageWeight,
  } = provider.packageValidators;

  type Flag = "DG" | "BIO";
  type PkgType = "package" | "pallet" | "document";

  // One row = one package type with a quantity. Rows carry stable ids so
  // ValidatedInput bindings keep focus while typing.
  type Row = {
    id: string;
    label?: string;
    type: PkgType;
    length: number;
    width: number;
    height: number;
    weight: number;
    stackable?: boolean;
    flags: Flag[];
    qty: number;
  };

  const rows = writable<Row[]>([]);
  const selectedRowId = writable<string | null>(null);

  const packageTemplates = writable<PackageTemplate[]>(
    (userPreferences?.packageTemplates as PackageTemplate[]) ?? [],
  );

  let focusRowId: string | null = null;
  let focusSeq = 0;

  const newId = () => crypto.randomUUID();

  // ---------- helpers ----------
  $: isNonEUDomestic =
    !$shipment.recipientAddress ||
    !isInEUCustomsTerritory(
      $shipment.recipientAddress.country?.toUpperCase(),
      $shipment.recipientAddress.postalCode,
    ) ||
    (!!$shipment.shipperAddress?.country &&
      !isInEUCustomsTerritory(
        $shipment.shipperAddress.country?.toUpperCase(),
        $shipment.shipperAddress.postalCode,
      ));

  $: totalColli = $rows.reduce(
    (a, r) => a + Math.max(1, Math.floor(Number(r.qty) || 1)),
    0,
  );

  function currentRow(): Row | undefined {
    const id = get(selectedRowId);
    return get(rows).find((r) => r.id === id);
  }

  // Reactive selected row for template-driven props (suggestedName).
  $: selectedRow = $rows.find((r) => r.id === $selectedRowId) ?? null;

  // Bewaar-actie in de template-bar alleen aanbieden als de regel compleet is;
  // anders sla je een leeg 0×0×0-profiel op.
  $: canSaveSelectedRow =
    !!selectedRow &&
    (selectedRow.type === "document" ||
      (selectedRow.length > 0 &&
        selectedRow.width > 0 &&
        selectedRow.height > 0 &&
        selectedRow.weight > 0));

  function emptyRow(): Row {
    return {
      id: newId(),
      label: "",
      type: "package",
      length: 0,
      width: 0,
      height: 0,
      weight: 0,
      stackable: false,
      flags: [],
      qty: 1,
    };
  }

  function registerValidity(id: string) {
    ["length", "width", "height", "weight", "type"].forEach((f) =>
      useFieldValidity(`packages_${id}_` + f),
    );
  }
  function dropValidity(id: string) {
    fieldValidity.update((f) => {
      const map = { ...f };
      ["length", "width", "height", "weight", "type"].forEach(
        (k) => delete map[`packages_${id}_${k}`],
      );
      return map;
    });
  }

  // ---------- row mutations ----------
  function patchRow(id: string, patch: Partial<Row>) {
    rows.update((list) =>
      list.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    );
  }

  function setType(id: string, type: PkgType) {
    patchRow(id, type === "pallet" ? { type } : { type, stackable: false });
  }

  function toggleFlag(id: string, flag: Flag) {
    rows.update((list) =>
      list.map((r) => {
        if (r.id !== id) return r;
        const has = r.flags.includes(flag);
        return {
          ...r,
          flags: has ? r.flags.filter((f) => f !== flag) : [...r.flags, flag],
        };
      }),
    );
  }

  function setQty(id: string, q: number | string) {
    const n = Math.max(1, Math.floor(Number(q) || 1));
    patchRow(id, { qty: n });
  }

  function addRow() {
    const r = emptyRow();
    rows.update((list) => [...list, r]);
    registerValidity(r.id);
    selectedRowId.set(r.id);
    focusRowId = r.id;
    focusSeq += 1;
  }

  function duplicateRow(id: string) {
    const src = get(rows).find((r) => r.id === id);
    if (!src) return;
    const r: Row = {
      ...structuredClone(src),
      id: newId(),
      label: src.label ? `${src.label} (kopie)` : "",
      flags: [...(src.flags || [])],
    };
    rows.update((list) => {
      const idx = list.findIndex((x) => x.id === id);
      const next = [...list];
      next.splice(idx + 1, 0, r);
      return next;
    });
    registerValidity(r.id);
    selectedRowId.set(r.id);
    focusRowId = r.id;
    focusSeq += 1;
  }

  function removeRow(id: string) {
    const list = get(rows);
    if (list.length <= 1) return; // keep at least one
    rows.update((l) => l.filter((r) => r.id !== id));
    dropValidity(id);
    if (get(selectedRowId) === id) {
      selectedRowId.set(get(rows)[0]?.id ?? null);
    }
  }

  // ---------- sync rows -> shipment.packages (expand qty) ----------
  rows.subscribe((list) => {
    if (list.length === 0) return;
    const now = new Date().toISOString();
    const packages: any[] = [];
    let n = 0;
    for (const r of list) {
      const qty = Math.max(1, Math.floor(Number(r.qty) || 1));
      for (let k = 0; k < qty; k++) {
        n += 1;
        packages.push({
          templateId: `${r.id}-${k}`,
          userId: "",
          name:
            r.label?.trim() ||
            `${m.shipmentWizard.packageStep.packageLabel} ${n}`,
          length: r.length,
          width: r.width,
          height: r.height,
          weight: r.weight,
          type: r.type,
          stackable: r.stackable ?? false,
          dangerousGoods: r.flags.includes("DG"),
          bioGoods: r.flags.includes("BIO"),
          carrier: undefined,
          originCountry: undefined,
          hsCode: undefined,
          vehicle: undefined,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
    if (packages.length === 0) return;
    shipment.update((s) => ({ ...s, packages }));
  });

  // ---------- freight (truck) options — pallet freight only ----------
  type FreightMode = "none" | "load" | "unload" | "both";
  const FREIGHT_MODES: FreightMode[] = ["none", "load", "unload", "both"];
  const FREIGHT_FALLBACK: Record<string, string> = {
    title: "Vracht opties",
    tailLift: "Laadklep",
    boxTruck: "Bakwagen",
    none: "geen",
    load: "laden",
    unload: "lossen",
    both: "beide",
  };
  const freightLabels: Record<string, string> = {
    ...FREIGHT_FALLBACK,
    ...(m?.shipmentWizard?.packageStep?.freightOptions ?? {}),
  };

  $: hasPallet = $rows.some((r) => r.type === "pallet");

  function tailliftMode(t?: TruckShipmentInformation): FreightMode {
    if (t?.shipperTaillift && t?.recipientTaillift) return "both";
    if (t?.shipperTaillift) return "load";
    if (t?.recipientTaillift) return "unload";
    return "none";
  }
  function boxTruckMode(t?: TruckShipmentInformation): FreightMode {
    const s = t?.shipperVehicle === "box truck";
    const r = t?.recipientVehicle === "box truck";
    if (s && r) return "both";
    if (s) return "load";
    if (r) return "unload";
    return "none";
  }

  $: tailliftValue = tailliftMode($shipment.shipmentOptions?.truckShipmentInfo);
  $: boxTruckValue = boxTruckMode($shipment.shipmentOptions?.truckShipmentInfo);

  function updateTruck(mut: (t: TruckShipmentInformation) => void) {
    shipment.update((s) => {
      if (!s.shipmentOptions) return s;
      const t: TruckShipmentInformation = {
        ...(s.shipmentOptions.truckShipmentInfo ?? {}),
      };
      mut(t);
      return {
        ...s,
        shipmentOptions: { ...s.shipmentOptions, truckShipmentInfo: t },
      };
    });
  }

  // Clear freight options when the last pallet is removed (self-terminating).
  $: if (!hasPallet && $shipment.shipmentOptions?.truckShipmentInfo) {
    const t = $shipment.shipmentOptions.truckShipmentInfo;
    if (
      t.shipperTaillift ||
      t.recipientTaillift ||
      t.shipperVehicle === "box truck" ||
      t.recipientVehicle === "box truck"
    ) {
      updateTruck((ti) => {
        ti.shipperTaillift = false;
        ti.recipientTaillift = false;
        ti.shipperVehicle = undefined;
        ti.recipientVehicle = undefined;
      });
    }
  }

  function setTaillift(mode: FreightMode) {
    updateTruck((t) => {
      t.shipperTaillift = mode === "load" || mode === "both";
      t.recipientTaillift = mode === "unload" || mode === "both";
    });
  }
  function setBoxTruck(mode: FreightMode) {
    updateTruck((t) => {
      t.shipperVehicle =
        mode === "load" || mode === "both" ? "box truck" : undefined;
      t.recipientVehicle =
        mode === "unload" || mode === "both" ? "box truck" : undefined;
    });
  }

  // ---------- templates ----------
  function suggestNameFrom(r: Row) {
    const base = (r.label || "").trim();
    const dims =
      r.type === "document"
        ? "Document"
        : `${r.length}×${r.width}×${r.height}${r.weight ? ` / ${r.weight}kg` : ""}`;
    return (
      base ||
      `${r.type === "pallet" ? "Pallet" : r.type === "document" ? "Document" : "Pakket"} ${dims}`
    );
  }

  async function persistTemplates(next: PackageTemplate[]) {
    await updateUserConfig("preferences.packageTemplates", next, userId);
    setUserPreferences({ ...(userPreferences ?? {}), packageTemplates: next });
    packageTemplates.set(next);
  }

  function makeTemplateFrom(r: Row, name: string): PackageTemplate {
    const now = new Date().toISOString();
    return {
      templateId: crypto.randomUUID(),
      userId,
      name,
      type: r.type,
      length: r.length,
      width: r.width,
      height: r.height,
      weight: r.weight,
      carrier: undefined,
      originCountry: undefined,
      hsCode: undefined,
      stackable: r.stackable ?? false,
      dangerousGoods: r.flags?.includes?.("DG") ?? false,
      bioGoods: r.flags?.includes?.("BIO") ?? false,
      vehicle: undefined,
      createdAt: now,
      updatedAt: now,
      // New profiles surface as a pill right away.
      isFavorited: true,
    };
  }

  function applyTemplate(t: PackageTemplate) {
    const id = get(selectedRowId);
    if (!id) return;
    patchRow(id, {
      type: t.type as PkgType,
      length: t.length,
      width: t.width,
      height: t.height,
      weight: t.weight,
      stackable: t.stackable ?? false,
      flags: [
        ...(t.dangerousGoods ? (["DG"] as const) : []),
        ...(t.bioGoods ? (["BIO"] as const) : []),
      ] as Flag[],
    });
    focusRowId = id;
    focusSeq += 1;
  }

  async function setFavorite(id: string, value: boolean) {
    const list = get(packageTemplates);
    const i = list.findIndex((t) => t.templateId === id);
    if (i === -1) return;
    const next = [...list];
    next[i] = {
      ...next[i],
      isFavorited: value,
      updatedAt: new Date().toISOString(),
    };
    await persistTemplates(next);
  }
  async function deleteTemplate(id: string) {
    await persistTemplates(
      get(packageTemplates).filter((t) => t.templateId !== id),
    );
  }
  async function renameTemplate(id: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    const list = get(packageTemplates);
    const i = list.findIndex((t) => t.templateId === id);
    if (i === -1) return;
    const next = [...list];
    next[i] = { ...next[i], name: trimmed, updatedAt: new Date().toISOString() };
    await persistTemplates(next);
  }
  async function reorderFavorites(idsInOrder: string[]) {
    const pos = new Map(idsInOrder.map((id, i) => [id, i]));
    const next = get(packageTemplates).map((t) =>
      pos.has(t.templateId) ? { ...t, sortOrder: pos.get(t.templateId) } : t,
    );
    await persistTemplates(next);
  }

  // ---------- mount: rebuild rows from shipment.packages ----------
  function sig(p: any) {
    return [
      p.type ?? "package",
      p.length ?? 0,
      p.width ?? 0,
      p.height ?? 0,
      p.weight ?? 0,
      p.dangerousGoods ? 1 : 0,
      p.bioGoods ? 1 : 0,
      p.stackable ? 1 : 0,
    ].join("|");
  }

  onMount(async () => {
    const current = get(shipment);
    const src = current.packages ?? [];

    if (src.length > 0) {
      // Group identical colli into a single row with qty = count.
      const bySig = new Map<string, Row>();
      const orderKeys: string[] = [];
      for (const p of src) {
        const key = sig(p);
        const existing = bySig.get(key);
        if (existing) {
          existing.qty += 1;
          continue;
        }
        orderKeys.push(key);
        bySig.set(key, {
          id: newId(),
          label: "",
          type: (p.type as PkgType) ?? "package",
          length: p.length ?? 0,
          width: p.width ?? 0,
          height: p.height ?? 0,
          weight: p.weight ?? 0,
          stackable: p.stackable ?? false,
          flags: [
            ...(p.dangerousGoods ? (["DG"] as const) : []),
            ...(p.bioGoods ? (["BIO"] as const) : []),
          ] as Flag[],
          qty: 1,
        });
      }
      const restored = orderKeys.map((k) => bySig.get(k)!);
      restored.forEach((r) => registerValidity(r.id));
      rows.set(restored);
      selectedRowId.set(restored[0].id);
      // Zelfde gedrag als addRow(): het lengte-veld van rij 1 krijgt focus met
      // geselecteerde waarde, zodat de operator meteen kan typen — óók wanneer
      // de stap opent met bestaande pakketten (order-import, draft-restore,
      // queue-bounce met startStep of de headless "extra info"-route).
      focusRowId = restored[0].id;
      focusSeq += 1;
    } else {
      addRow();
    }

    // Refresh templates from server.
    try {
      const res = await fetch(`${apiBaseUrl}/api/config/get`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (!res.ok) throw new Error("Failed to fetch config");
      const cfg = await res.json();
      const tpl = (cfg.preferences?.packageTemplates || []) as PackageTemplate[];
      packageTemplates.set(tpl);
      setUserPreferences({ ...(userPreferences ?? {}), packageTemplates: tpl });
    } catch (err) {
      console.error("❌ Failed to load package templates:", err);
    }
  });

  const TYPE_OPTS: { value: PkgType; key: "packageLabel" | "palletLabel" | "documentLabel" }[] = [
    { value: "package", key: "packageLabel" },
    { value: "pallet", key: "palletLabel" },
    { value: "document", key: "documentLabel" },
  ];
  const FLAGS: Flag[] = ["DG", "BIO"];
</script>

<div class="w-full text-sm text-gray-800">
  <StepSection
    label={m.shipmentWizard.packageStep.packagesSectionLabel ?? "Verpakkingen"}
  >
    <svelte:fragment slot="actions">
      <span class="text-xs text-gray-400"
        >{totalColli}
        {m.shipmentWizard.packageStep.colliLabel ?? "colli"}</span
      >
      <button
        type="button"
        class="text-xs text-gray-500 hover:text-gray-800 underline decoration-dotted"
        on:click={addRow}
        >+ {m.shipmentWizard.packageStep.addRowLabel ??
          "Regel toevoegen"}</button
      >
    </svelte:fragment>

    <!-- Table — bewust géén omkaderde card: de rest van de wizard is vlak met
         haarlijnen, dus de tabel ook. Eerste/laatste kolom zonder zijpadding
         zodat de inhoud uitlijnt met de sectiekop erboven. -->
    <div class="overflow-x-auto">
      <table class="w-full text-xs">
        <thead>
          <tr
            class="text-[11px] font-semibold uppercase tracking-wide text-gray-400 border-b border-gray-100"
          >
            <th class="text-left font-semibold pl-0 pr-3 py-2 w-6">#</th>
            <th class="text-left font-semibold px-3 py-2"
              >{m.shipmentWizard.packageStep.typeLabel ?? "Type"}</th
            >
            <th class="text-left font-semibold px-3 py-2"
              >{m.shipmentWizard.packageStep.dimensionsLabel ??
                "Afmetingen (cm)"}</th
            >
            <th class="text-left font-semibold px-3 py-2 w-24">
              {m.shipmentWizard.packageStep.weightLabel}
            </th>
            <th class="text-left font-semibold px-3 py-2 w-28"
              >{m.shipmentWizard.packageStep.numberOfArticles ?? "Aantal"}</th
            >
            <th class="text-left font-semibold px-3 py-2"
              >{m.shipmentWizard.packageStep.optionsLabel ?? "Opties"}</th
            >
            <th class="pl-3 pr-0 py-2 w-14"></th>
          </tr>
        </thead>
        <tbody>
          {#each $rows as row, i (row.id)}
            <tr
              class={`border-b border-gray-100 last:border-0 align-middle cursor-pointer ${
                $selectedRowId === row.id ? "bg-gray-50" : "hover:bg-gray-50"
              }`}
              on:click={() => selectedRowId.set(row.id)}
            >
              <td class="pl-0 pr-3 py-2 text-gray-400">{i + 1}</td>

              <!-- Type -->
              <td class="px-3 py-2">
                <div
                  class="seg"
                  role="group"
                  aria-label={m.shipmentWizard.packageStep.typeLabel ?? "Type"}
                >
                  {#each TYPE_OPTS as opt}
                    <button
                      type="button"
                      tabindex="-1"
                      class:on={row.type === opt.value}
                      on:click|stopPropagation={() => setType(row.id, opt.value)}
                      >{m.shipmentWizard.packageStep[opt.key]}</button
                    >
                  {/each}
                </div>
              </td>

              <!-- Dimensions: L × B × H -->
              <td class="px-3 py-2">
                <div class="flex items-center gap-1.5 text-gray-400">
                  <div class="w-20">
                    <ValidatedInput
                      type="number"
                      name={`packages_${row.id}_length`}
                      bind:value={row.length}
                      shipmentTemplate={$shipment}
                      validator={{
                        dependsOn: () => ({ val: undefined }),
                        validate: () => validatePackageLength(row as any),
                      }}
                      compactValidation={true}
                      inputClass={"py-1.5 px-2 text-[13px] text-center leading-tight"}
                      shouldAutofocus={focusRowId === row.id}
                      focusToken={focusRowId === row.id ? focusSeq : 0}
                    />
                  </div>
                  <span>×</span>
                  <div class="w-20">
                    <ValidatedInput
                      type="number"
                      name={`packages_${row.id}_width`}
                      bind:value={row.width}
                      shipmentTemplate={$shipment}
                      validator={{
                        dependsOn: () => ({ val: undefined }),
                        validate: () => validatePackageWidth(row as any),
                      }}
                      compactValidation={true}
                      inputClass={"py-1.5 px-2 text-[13px] text-center leading-tight"}
                    />
                  </div>
                  <span>×</span>
                  <div class="w-20">
                    <ValidatedInput
                      type="number"
                      name={`packages_${row.id}_height`}
                      bind:value={row.height}
                      shipmentTemplate={$shipment}
                      validator={{
                        dependsOn: () => ({ val: undefined }),
                        validate: () => validatePackageHeight(row as any),
                      }}
                      compactValidation={true}
                      inputClass={"py-1.5 px-2 text-[13px] text-center leading-tight"}
                    />
                  </div>
                </div>
              </td>

              <!-- Weight -->
              <td class="px-3 py-2">
                <div class="w-20">
                  <ValidatedInput
                    type="number"
                    name={`packages_${row.id}_weight`}
                    bind:value={row.weight}
                    shipmentTemplate={$shipment}
                    validator={{
                      dependsOn: () => ({ val: undefined }),
                      validate: () => validatePackageWeight(row as any),
                    }}
                    compactValidation={true}
                    inputClass={"py-1.5 px-2 text-[13px] text-center leading-tight"}
                  />
                </div>
              </td>

              <!-- Quantity -->
              <td class="px-3 py-2">
                <div
                  class="inline-flex items-center border border-gray-200 rounded-lg bg-white overflow-hidden"
                >
                  <button
                    type="button"
                    tabindex="-1"
                    class="text-gray-500 px-2 py-1 hover:bg-gray-50 disabled:opacity-30"
                    on:click|stopPropagation={() => setQty(row.id, row.qty - 1)}
                    disabled={row.qty <= 1}>−</button
                  >
                  <input
                    type="number"
                    min="1"
                    class="qty-input w-10 text-center bg-transparent border-none focus:outline-none text-[13px]"
                    bind:value={row.qty}
                    on:click|stopPropagation
                    on:blur={() => setQty(row.id, row.qty)}
                  />
                  <button
                    type="button"
                    tabindex="-1"
                    class="text-gray-600 px-2 py-1 hover:bg-gray-50"
                    on:click|stopPropagation={() => setQty(row.id, row.qty + 1)}
                    >+</button
                  >
                </div>
              </td>

              <!-- Options: DG / BIO (+ Stapelbaar for pallets) -->
              <td class="px-3 py-2">
                <div class="flex items-center gap-1.5 flex-wrap">
                  {#each FLAGS as flag}
                    <button
                      type="button"
                      tabindex="-1"
                      class={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition ${
                        row.flags.includes(flag)
                          ? "border-blue-300 bg-blue-50 text-blue-700"
                          : "border-gray-200 text-gray-500 hover:border-gray-300 hover:bg-gray-50"
                      }`}
                      on:click|stopPropagation={() => toggleFlag(row.id, flag)}
                      >{flag}</button
                    >
                  {/each}
                  {#if row.type === "pallet"}
                    <button
                      type="button"
                      tabindex="-1"
                      class={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition ${
                        row.stackable
                          ? "border-blue-300 bg-blue-50 text-blue-700"
                          : "border-gray-200 text-gray-500 hover:border-gray-300 hover:bg-gray-50"
                      }`}
                      on:click|stopPropagation={() =>
                        patchRow(row.id, { stackable: !row.stackable })}
                      >{m.shipmentWizard.packageStep.stackablePill ??
                        "Stapelbaar"}</button
                    >
                  {/if}
                </div>
              </td>

              <!-- Actions -->
              <td class="pl-3 pr-0 py-2">
                <div class="flex items-center gap-2 justify-end text-gray-400">
                  <button
                    type="button"
                    tabindex="-1"
                    class="hover:text-gray-700 transition"
                    title={m.shipmentWizard.packageStep.duplicateRowTitle ??
                      "Kopie maken"}
                    on:click|stopPropagation={() => duplicateRow(row.id)}
                  >
                    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
                      <path
                        fill="currentColor"
                        d="M16 1H4a2 2 0 0 0-2 2v12h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z"
                      />
                    </svg>
                  </button>
                  <button
                    type="button"
                    tabindex="-1"
                    class="hover:text-red-500 transition disabled:opacity-30"
                    title={m.shipmentWizard.packageStep.removeRowTitle ??
                      "Verwijderen"}
                    disabled={$rows.length <= 1}
                    on:click|stopPropagation={() => removeRow(row.id)}
                  >
                    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
                      <path
                        fill="currentColor"
                        d="M9 3h6a1 1 0 0 1 1 1v2h4v2h-1v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V8H4V6h4V4a1 1 0 0 1 1-1zm2 3h2V5h-2v1zM7 8v11h10V8H7z"
                      />
                    </svg>
                  </button>
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <!-- Template bar: één combobox — zoeken past toe op de geselecteerde rij,
         de bovenste dropdown-rij bewaart de rij als (favoriet) profiel -->
    <PackageTemplateBar
      {m}
      templates={$packageTemplates}
      suggestedName={selectedRow ? suggestNameFrom(selectedRow) : ""}
      canSaveCurrent={canSaveSelectedRow}
      onApply={(t) => applyTemplate(t)}
      onSaveCurrent={async (name, overwriteId) => {
        const cur = currentRow();
        if (!cur) return;
        const list = $packageTemplates;
        if (overwriteId) {
          const i = list.findIndex((t) => t.templateId === overwriteId);
          if (i !== -1) {
            const next = [...list];
            next[i] = {
              ...list[i],
              name,
              type: cur.type,
              length: cur.length,
              width: cur.width,
              height: cur.height,
              weight: cur.weight,
              stackable: cur.stackable ?? false,
              dangerousGoods: cur.flags.includes("DG"),
              bioGoods: cur.flags.includes("BIO"),
              isFavorited: true,
              updatedAt: new Date().toISOString(),
            };
            await persistTemplates(next);
            return;
          }
        }
        await persistTemplates([...list, makeTemplateFrom(cur, name)]);
      }}
      onToggleFavorite={setFavorite}
      onDeleteTemplate={deleteTemplate}
      onRenameTemplate={renameTemplate}
      onReorderFavorites={reorderFavorites}
    />

    {#if isNonEUDomestic}
      <p class="text-xs text-gray-400">
        {m.shipmentWizard.packageStep.customsNextStepHint ??
          "Douane- en productgegevens vul je in de volgende stap in."}
      </p>
    {/if}
  </StepSection>

  <!-- 🚚 Freight (truck) options — pallet freight only -->
  {#if hasPallet}
    <StepSection label={freightLabels.title}>
      <div class="flex flex-col gap-3">
        <div class="flex items-center gap-4">
          <span class="w-24 shrink-0 text-xs text-gray-500"
            >{freightLabels.tailLift}</span
          >
          <div class="seg" role="group" aria-label={freightLabels.tailLift}>
            {#each FREIGHT_MODES as mode}
              <button
                type="button"
                class:on={tailliftValue === mode}
                on:click={() => setTaillift(mode)}>{freightLabels[mode]}</button
              >
            {/each}
          </div>
        </div>
        <div class="flex items-center gap-4">
          <span class="w-24 shrink-0 text-xs text-gray-500"
            >{freightLabels.boxTruck}</span
          >
          <div class="seg" role="group" aria-label={freightLabels.boxTruck}>
            {#each FREIGHT_MODES as mode}
              <button
                type="button"
                class:on={boxTruckValue === mode}
                on:click={() => setBoxTruck(mode)}>{freightLabels[mode]}</button
              >
            {/each}
          </div>
        </div>
      </div>
    </StepSection>
  {/if}
</div>

<style>
  /* Segmented controls (pakket-type per rij + vrachtopties) — same pattern as
     ReceiverStepBlock's .seg, compacted for table rows. Scoped so the TFF host
     page CSS can't touch it. */
  .seg {
    display: inline-flex;
    background: #f3f4f6;
    border-radius: 9px;
    padding: 3px;
  }

  .seg button {
    border: 0;
    background: transparent;
    padding: 4px 10px;
    border-radius: 7px;
    font-family: inherit;
    font-size: 12px;
    font-weight: 500;
    color: #6b7280;
    white-space: nowrap;
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

  @media (prefers-reduced-motion: reduce) {
    .seg button {
      transition: none;
    }
  }

  /* Hide the native number-input spinner so only our −/+ steppers show;
     the value stays centered instead of being squeezed behind the arrows. */
  .qty-input::-webkit-outer-spin-button,
  .qty-input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  .qty-input {
    -moz-appearance: textfield;
    appearance: textfield;
  }
</style>
