<script lang="ts">
  // Geport uit v1 PasteAddressBox.svelte. Wijziging (widget-extractie): de
  // adres-validatie na een parse komt uit de provider-PARAMETER (aggregaat-validator
  // "recipientAddress") i.p.v. de hardcoded generated import (B_getRates_0.validations).
  //
  // Inline quick-fill field for the recipient step: paste an unstructured
  // address / e-mail and the form fields get filled via the AI parse endpoint.
  // Re-parsing identical text is fine: the server caches parse results by
  // content hash, so repeats never hit the model. Errors surface as toasts.
  import type { Writable } from "svelte/store";
  import type { Address, ShipmentTemplate } from "../types/config";
  import {
    parseAddressText,
    type ParsedAddressFields,
  } from "../api/aiParseAddress";
  import { canonicalShippingCountry } from "../utils/countries";
  import type { WidgetProviderLayer } from "../providers/types";
  import { m } from "../state/messageStore";
  import { toast } from "./toast/toast";

  export let shipment: Writable<ShipmentTemplate>;
  export let provider: WidgetProviderLayer;
  export let userId: string = "";

  let text = "";
  let parsing = false;

  const ERRORS: Record<string, string> = {
    not_found: "Geen adres gevonden in de geplakte tekst.",
    rate_limited: "Even te veel verzoeken — probeer het zo opnieuw.",
    ai_not_configured: "Automatisch invullen is niet beschikbaar.",
    parse_failed: "Invullen is mislukt. Probeer het opnieuw.",
  };

  function handlePaste() {
    // Fire once per paste, after the input value has been updated.
    window.setTimeout(() => {
      void runParse();
    }, 0);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === "Enter") {
      // preventDefault also tells the wizard's Enter-to-next-field handler
      // (which skips defaultPrevented events) to leave this one alone.
      event.preventDefault();
      void runParse();
    }
  }

  async function runParse() {
    const value = text.trim();
    if (!value || parsing) return;

    parsing = true;

    try {
      const result = await parseAddressText(userId, value);

      if (!result.ok) {
        toast.error(ERRORS[result.error] ?? ERRORS.parse_failed);
        return;
      }

      await applyParsedAddress(result.address);
      text = "";
    } finally {
      parsing = false;
    }
  }

  async function applyParsedAddress(parsed: ParsedAddressFields) {
    const previous: Address =
      $shipment.recipientAddress ??
      ({
        company: "",
        firstName: "",
        lastName: "",
        email: "",
        phoneNumber: "",
        street: ["", ""],
        city: "",
        region: "",
        postalCode: "",
        country: "",
      } as Address);

    // Parsed values win; anything the parser left empty keeps the user's input.
    const postalCode = parsed.postalCode || previous.postalCode || "";
    const country = canonicalShippingCountry(
      parsed.country || previous.country,
      postalCode,
    );

    const next: Address = {
      company: parsed.company || previous.company || "",
      firstName: parsed.firstName || previous.firstName || "",
      lastName: parsed.lastName || previous.lastName || "",
      email: parsed.email || previous.email || "",
      phoneNumber: parsed.phoneNumber || previous.phoneNumber || "",
      street: [
        parsed.street || previous.street?.[0] || "",
        parsed.streetAddition || previous.street?.[1] || "",
      ],
      city: parsed.city || previous.city || "",
      region: parsed.region || previous.region || "",
      postalCode,
      country: country || "",
      isPrivateIndividual: previous.isPrivateIndividual,
    };

    shipment.update((current) => ({
      ...current,
      recipientAddress: next,
    }));

    // Same validators as the form fields; the failing field is highlighted by
    // its ValidatedInput anyway, this just tells the user to look.
    const aggregate = provider.fieldValidators["recipientAddress"];
    const validation = await aggregate.validate(
      aggregate.dependsOn({ recipientAddress: next }),
    );

    if (validation.valid) {
      toast.success("Adres ingevuld.");
    } else {
      toast.error(
        `Adres ingevuld — controleer: ${validation.message ?? "nog niet alle velden zijn geldig"}`,
      );
    }
  }
</script>

<div class="paste-line" class:busy={parsing}>
  {#if parsing}
    <svg class="icon spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle class="spin-track" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
      <path
        class="spin-head"
        fill="currentColor"
        d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4Z"
      />
    </svg>
  {:else}
    <svg
      class="icon"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      stroke-width="1.7"
    >
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3a2.25 2.25 0 0 0-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75h-6a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184"
      />
    </svg>
  {/if}

  <input
    bind:value={text}
    placeholder={parsing
      ? "Bezig met invullen…"
      : (m.shipmentWizard?.receiverStep?.pasteAddressPlaceholder ??
        "Plak hier een ongestructureerd adres of e-mail…")}
    disabled={parsing}
    on:paste={handlePaste}
    on:keydown={handleKeydown}
  />

  {#if !parsing && text.trim()}
    <button type="button" on:click={() => void runParse()}>
      {m.shipmentWizard?.receiverStep?.pasteAddressAction ?? "Invullen"}
    </button>
  {/if}
</div>

<style>
  .paste-line {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 42px;
    padding: 0 8px 0 12px;
    border: 1px solid #e5e7eb;
    border-radius: 10px;
    background: #fafafa;
    transition: border-color 0.15s ease;
  }

  .paste-line:focus-within {
    border-color: #93b4f5;
    background: #ffffff;
  }

  .icon {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
    color: #9ca3af;
  }

  .spin {
    animation: paste-spin 0.8s linear infinite;
    color: #2563eb;
  }

  .spin-track {
    opacity: 0.25;
  }

  .spin-head {
    opacity: 0.75;
  }

  @keyframes paste-spin {
    to {
      transform: rotate(360deg);
    }
  }

  input {
    flex: 1;
    min-width: 0;
    border: 0;
    background: transparent;
    outline: none;
    font: inherit;
    font-size: 14px;
    color: #374151;
  }

  input::placeholder {
    color: #9ca3af;
  }

  input:disabled {
    opacity: 0.7;
  }

  button {
    flex-shrink: 0;
    border: 0;
    border-radius: 7px;
    background: #1f2937;
    color: #ffffff;
    font-family: inherit;
    font-size: 12px;
    font-weight: 500;
    padding: 6px 12px;
    cursor: pointer;
  }

  button:hover {
    background: #374151;
  }

  @media (prefers-reduced-motion: reduce) {
    .spin {
      animation: none;
    }
  }
</style>
