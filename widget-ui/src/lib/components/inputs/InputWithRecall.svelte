<script lang="ts">
  // Geport uit v1 inputs/InputWithRecall.svelte (verbatim; importpaden identiek).
  // Eén v2-afwijking, gemarkeerd in onMount: v1 kreeg userPreferences bij widget-boot
  // host-geïnjecteerd; in v2 is de verzenderstap de eerste render en is de singleton
  // dan nog leeg. Daarom worden de presets op mount van de proxy ververst
  // (zelfde patroon als PackageTableStepBlock: POST /api/config/get → cfg.preferences).
  import { onMount } from "svelte";
  import Save from "../icons/Save.svelte";
  import Plus from "../icons/Plus.svelte";
  import Star from "../icons/Star.svelte";
  import { onClickOutside } from "../../utils/onClickOutside";
  import { toast } from "../toast/toast";
  import { fieldValidity } from "../../state/formValidation";
  import { m } from "../../state/messageStore";
  import {
    userPreferences,
    setUserPreferences,
  } from "../../state/userPreferences";
  import { updateUserConfig } from "../../api/updateUserConfig";
  import { apiBaseUrl } from "../../api/global";

  export let label: string;
  export let typeKey: string;
  export let userId: string;
  export let name: string;
  export let bindValue: string;
  export let bindObject: any;
  export let onReset: () => void = () => {};
  export let emptyTemplate: any;

  // Optional generic labels, so this component is not tied to "company"
  export let saveLabel: string = m.shipmentWizard.senderStep.companySave;
  export let newLabel: string = m.shipmentWizard.senderStep.companyNew;
  export let defaultLabel: string = m.shipmentWizard.senderStep.companyStandard;

  type RecallConfig = {
    templates: Record<string, any>;
    defaults: string[];
  };

  let open = false;
  let activeIndex = -1;
  let inputEl: HTMLInputElement;
  let hasInteracted = false;

  let recallConfig: RecallConfig = {
    templates: {},
    defaults: [],
  };

  $: templates = recallConfig.templates ?? {};
  $: options = Object.keys(templates);
  $: defaultKey = recallConfig.defaults?.[0] ?? "";
  $: isDefault = defaultKey === bindValue?.trim();

  $: fieldValidity.update((v) => {
    const valid = bindValue !== "" && bindValue !== undefined;
    if (v[name] === valid) return v;

    return {
      ...v,
      [name]: valid,
    };
  });

  function getInputRecallRoot(): Record<string, RecallConfig> {
    return userPreferences?.inputRecall ?? {};
  }

  function getRecallConfig(): RecallConfig {
    const raw = getInputRecallRoot()[typeKey];

    return {
      templates: raw?.templates ?? {},
      defaults: Array.isArray(raw?.defaults) ? raw.defaults : [],
    };
  }

  function clone<T>(value: T): T {
    if (value === null || value === undefined) return value;
    return JSON.parse(JSON.stringify(value));
  }

  function isDeepEmpty(obj: any): boolean {
    if (Array.isArray(obj)) {
      return obj.every(isDeepEmpty);
    }

    if (obj && typeof obj === "object") {
      return Object.values(obj).every(isDeepEmpty);
    }

    return obj === "" || obj === null || obj === undefined;
  }

  function assignRecallValue(target: any, source: any, fallback: any = {}) {
    if (!target || typeof target !== "object") return;

    for (const key in target) {
      const targetVal = target[key];
      const sourceVal = source?.[key];
      const fallbackVal = fallback?.[key];

      if (Array.isArray(targetVal)) {
        target[key] = targetVal.map((_, i) => {
          if (Array.isArray(sourceVal) && sourceVal[i] !== undefined) {
            return clone(sourceVal[i]);
          }

          if (Array.isArray(fallbackVal) && fallbackVal[i] !== undefined) {
            return clone(fallbackVal[i]);
          }

          return "";
        });

        continue;
      }

      if (targetVal && typeof targetVal === "object") {
        assignRecallValue(targetVal, sourceVal ?? {}, fallbackVal ?? {});
        continue;
      }

      target[key] =
        source && key in source ? clone(sourceVal) : clone(fallbackVal ?? "");
    }
  }

  async function persistRecallConfig(nextConfig: RecallConfig) {
    const currentInputRecall = getInputRecallRoot();

    const nextInputRecall = {
      ...currentInputRecall,
      [typeKey]: {
        templates: nextConfig.templates ?? {},
        defaults: nextConfig.defaults ?? [],
      },
    };

    recallConfig = nextInputRecall[typeKey];

    setUserPreferences({
      ...(userPreferences ?? {}),
      inputRecall: nextInputRecall,
    });

    /**
     * Important:
     * Write the whole inputRecall object.
     *
     * Do NOT write:
     * preferences.inputRecall.${typeKey}.templates.${key}
     *
     * because keys like "B.V." would be interpreted as nested paths.
     */
    await updateUserConfig("preferences.inputRecall", nextInputRecall, userId);
  }

  onMount(() => {
    // v2-afwijking t.o.v. v1: presets eerst van de proxy verversen — de
    // verzenderstap is de eerste render, dus niets heeft de userPreferences-
    // singleton al geseed (v1 deed dat bij widget-boot via host-injectie).
    // Fail-soft: zonder server blijven presets gewoon leeg.
    void (async () => {
      try {
        const res = await fetch(`${apiBaseUrl}/api/config/get`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId }),
        });
        if (res.ok) {
          const cfg = await res.json();
          const inputRecall = cfg.preferences?.inputRecall;
          if (inputRecall) {
            setUserPreferences({
              ...(userPreferences ?? {}),
              inputRecall,
            });
          }
        }
      } catch (err) {
        console.error("❌ Failed to load input recall presets:", err);
      }

      // Vanaf hier: v1's onMount, verbatim.
      recallConfig = getRecallConfig();

      const key = recallConfig.defaults?.[0];
      const recallValue = key ? recallConfig.templates?.[key] : null;

      if (isDeepEmpty(bindObject) && key && recallValue) {
        assignRecallValue(bindObject, recallValue, emptyTemplate);
        bindValue = key;
      }
    })();
  });

  function selectOption(opt: string) {
    const recallValue = templates?.[opt];

    if (recallValue) {
      assignRecallValue(bindObject, recallValue, emptyTemplate);
      bindValue = opt;
    }

    open = false;
    hasInteracted = false;
    activeIndex = -1;
  }

  async function saveRecallValue() {
    const key = bindValue?.trim();
    if (!key) return;

    const current = {
      ...clone(bindObject),
      templateId: key,
      updatedAt: new Date().toISOString(),
    };

    const isFirstTemplate = Object.keys(templates).length === 0;

    await persistRecallConfig({
      templates: {
        ...templates,
        [key]: current,
      },
      defaults: isFirstTemplate ? [key] : recallConfig.defaults ?? [],
    });

    toast.success(`✅ ${key}`);
  }

  async function setDefaultRecallValue() {
    const key = bindValue?.trim();
    if (!key) return;

    const current = {
      ...clone(bindObject),
      templateId: key,
      updatedAt: new Date().toISOString(),
    };

    await persistRecallConfig({
      templates: {
        ...templates,
        [key]: current,
      },
      defaults: [key],
    });

    toast.success(`✅ ${key} ingesteld als standaard`);
  }

  async function deleteRecallValue(key: string) {
    const updatedTemplates = { ...templates };
    delete updatedTemplates[key];

    const updatedDefaults = (recallConfig.defaults ?? []).filter(
      (d) => d !== key,
    );

    await persistRecallConfig({
      templates: updatedTemplates,
      defaults: updatedDefaults,
    });

    if (bindValue?.trim() === key) {
      bindValue = "";
    }

    toast.success(`🗑️ ${key}`);
  }

  function resetFields() {
    onReset();
    bindValue = "";
  }

  function onUserInput() {
    hasInteracted = true;
    open = true;
    activeIndex = 0;
  }

  function visibleOptions() {
    return options.filter((opt) => {
      if (!hasInteracted) return true;

      return (
        bindValue?.trim() === "" ||
        opt.toLowerCase().includes((bindValue ?? "").toLowerCase())
      );
    });
  }

  function handleKeydown(e: KeyboardEvent) {
    const opts = visibleOptions();

    if (e.key === "Escape" || e.key === "Tab") {
      open = false;
      hasInteracted = false;
      activeIndex = -1;
      return;
    }

    if (!opts.length) return;

    if (e.key === "ArrowDown") {
      activeIndex = (activeIndex + 1) % opts.length;
      e.preventDefault();
    } else if (e.key === "ArrowUp") {
      activeIndex = (activeIndex - 1 + opts.length) % opts.length;
      e.preventDefault();
    } else if (e.key === "Enter" && activeIndex >= 0) {
      selectOption(opts[activeIndex]);
      e.preventDefault();
    }
  }
</script>

<div
  class="-mb-[2px] relative"
  use:onClickOutside={() => (
    (open = false), (hasInteracted = false), (activeIndex = -1)
  )}
>
  <label class="block text-sm text-[#6B7280] mb-1 flex items-center gap-1">
    {label}
  </label>

  <div class="relative z-10">
    <input
      bind:this={inputEl}
      bind:value={bindValue}
      class="w-full px-3 py-2 text-sm border border-gray-300 rounded-[4px] bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 h-[2.35rem] pr-8"
      on:focus={() => ((open = true), (hasInteracted = false))}
      on:input={onUserInput}
      on:keydown={handleKeydown}
      autocomplete="off"
    />

    <div
      class="pointer-events-none absolute top-1/2 right-3 transform -translate-y-1/2 text-gray-400"
    >
      <svg
        class="w-4 h-4 text-gray-400"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        viewBox="0 0 24 24"
      >
        <path d="M6 9l6 6 6-6" />
      </svg>
    </div>

    {#if options.length > 0 && open}
      <ul
        class="absolute top-full left-0 w-full mt-1 bg-white border border-t-0 border-gray-300 rounded-b-[4px] text-xs max-h-75 overflow-y-auto list-none p-0"
      >
        {#each visibleOptions() as opt, i}
          <li
            class="px-3 py-2 flex items-center gap-2 hover:bg-gray-100 cursor-pointer group"
            class:selected={i === activeIndex}
            on:click={() => selectOption(opt)}
          >
            <span class="flex-1 truncate text-left">{opt}</span>

            {#if opt === defaultKey}
              <span class="shrink-0">
                <Star class="w-3 h-3 text-blue-400" />
              </span>
            {/if}

            <span
              class="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
              on:click|stopPropagation={() => deleteRecallValue(opt)}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="w-3.5 h-3.5 text-gray-400 hover:text-red-500"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fill-rule="evenodd"
                  d="M6 8a1 1 0 012 0v5a1 1 0 11-2 0V8zm4-1a1 1 0 011 1v5a1 1 0 11-2 0V8a1 1 0 011-1z"
                  clip-rule="evenodd"
                />
                <path
                  fill-rule="evenodd"
                  d="M4 4a1 1 0 011-1h10a1 1 0 011 1v1H4V4zm2 2h8l-.867 10.142A2 2 0 0111.142 18H8.858a2 2 0 01-1.991-1.858L6 6z"
                  clip-rule="evenodd"
                />
              </svg>
            </span>
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  <div
    class="flex justify-end gap-2 mt-1 text-xs text-gray-500 w-[60%] ml-auto"
  >
    <button
      type="button"
      class="flex items-center gap-1 px-2 py-1 hover:text-gray-700 transition text-center"
      on:click={saveRecallValue}
      tabindex="-1"
    >
      <Save class="w-3.5 h-3.5" />
      {saveLabel}
    </button>

    <button
      type="button"
      class="flex items-center gap-1 px-2 py-1 hover:text-gray-700 transition text-center"
      on:click={resetFields}
      tabindex="-1"
    >
      <Plus class="w-3.5 h-3.5" />
      {newLabel}
    </button>

    <button
      type="button"
      class="flex items-center gap-1 px-2 py-1 transition text-center text-gray-500 hover:text-gray-700"
      on:click={setDefaultRecallValue}
      tabindex="-1"
    >
      <Star
        class="w-3.5 h-3.5"
        style="stroke: {isDefault
          ? '#60a5fa'
          : 'currentColor'}; fill: {isDefault
          ? 'rgba(96, 165, 250, 0.25)'
          : 'none'}"
      />
      {defaultLabel}
    </button>
  </div>
</div>

<style>
  li.selected {
    background-color: #f3f4f6;
  }

  ul {
    padding-inline-start: 0 !important;
    padding-left: 0 !important;
  }
</style>
