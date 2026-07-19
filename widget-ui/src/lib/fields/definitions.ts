// Geport uit v1 src/lib/fields/definitions.ts. Wijzigingen (widget-extractie):
// - `import domain from "../steps/domain.json"` (generated) → PARAMETER: de aanroeper
//   geeft provider.domain mee (fabriek-emit). Daarom is de module-export vervangen
//   door een factory `makeFieldDefinitions(domain)`; v1 las m/domain op import-tijd,
//   de factory leest ze pas bij aanroep (ShipStepBlock roept 'm in onMount aan —
//   zelfde lazy-timing als v1's dynamische `import("../fields/definitions")`).
// - Keys, labels, bindPaths en fallback-strings verbatim v1. m-keys die in de
//   v2-catalogus (nog) ontbreken (invoicePresentQuestion, yes/no,
//   invoicePresentExplanation, exportDocumentExplanation) dragen op v1's fallbacks.

import { currentLang } from "../state/messageStore";
import { getCountryOptions } from "../utils/countries";
import { m } from "../state/messageStore";
import { translateOptions } from "../utils/optionLabels";

export type WidgetFieldDefinition = {
  label: string;
  inputType: "text" | "select" | "textarea" | "checkbox" | "date" | "file" | "number" | "blob" | "blobs" | "radio" | "carrierAccountNumber" | "accessPoints";
  options?: { label: string, value: string }[];
  description?: string; // optional helper/explanation text shown under the field
  bindPath: string; // where to read/write in shipment
};

export function makeFieldDefinitions(domain: any): Record<string, WidgetFieldDefinition> {
  return {
    "shipmentOptions_deliveryInstructions": {
      label: m.serviceSettingComponents.shipmentInstructions,
      inputType: "textarea",
      bindPath: "shipmentOptions.deliveryInstructions"
    },
    "shipmentOptions_incotermsGroupD": {
      label: m.serviceSettingComponents.deliveryCondition,
      inputType: "select",
      options: domain.incotermsGroupD
        ||
        [{ "label": "DAP (delivered at place)", "value": "DAP" },
        { "label": "DDP (delivery duty paid)", "value": "DDP" }],
      bindPath: "shipmentOptions.incotermsGroupD"
    },
    "shipmentOptions_bellenVoorAflevering": {
      label: m.serviceSettingComponents.callBeforeDelivery,
      inputType: "checkbox",
      bindPath: "truckShipmentInfo.callBeforeDelivery"
    },
    "shipmentOptions_insuranceValue": {
      // Kort label; de eigen-risico-uitleg staat als description ónder het veld —
      // als label liet hij de kolom drievoudig wrappen.
      label: m.serviceSettingComponents.insuredAmountLabel ?? "Verzekerd bedrag (€)",
      description: m.serviceSettingComponents.defaultInsurance,
      inputType: "number",
      bindPath: "shipmentOptions.insuranceValue"
    },
    "factuuraanwezig": {
      label: m.serviceSettingComponents?.invoicePresentQuestion ?? "Zit er een papieren handelsfactuur bij de zending?",
      inputType: "radio",
      options: [
        { label: m.serviceSettingComponents?.yes ?? "Ja", value: "ja" },
        { label: m.serviceSettingComponents?.no ?? "Nee", value: "nee" },
      ],
      description: m.serviceSettingComponents?.invoicePresentExplanation
        ?? "Gaat alleen over een papieren factuur die fysiek in of op het pakket zit (los van de digitale upload of Paperless Trade). Kies 'Nee' als er geen papieren factuur bij de zending zit.",
      bindPath: "shipmentOptions.factuurAanwezig"
    },
    "invoice": {
      label: m.serviceSettingComponents.invoiceWithShipment,
      inputType: "blob",
      bindPath: "invoice"
    },
    "customsDocuments": {
      label: m.serviceSettingComponents?.exportDocument ?? "Uitvoer- of transitdocumenten",
      inputType: "blobs",
      description: m.serviceSettingComponents?.exportDocumentExplanation
        ?? "Upload hier eventuele uitvoer- of transitdocumenten (bijv. T1, EUR.1). Dit staat los van de handelsfactuur.",
      bindPath: "customsDocuments"
    },
    shipmentOptions_exportReason: {
      label: m.serviceSettingComponents.exportReason,
      inputType: "select",
      options: translateOptions(domain.exportReasonOptions, m.options?.exportReason),
      bindPath: "shipmentOptions.exportReason",
    },
    "shipmentOptions_description": {
      label: m.serviceSettingComponents.descriptionShipment,
      inputType: "textarea",
      bindPath: "shipmentOptions.description"
    },
    "shipmentOptions_shipmentOriginCountry": {
      label: m.serviceSettingComponents.shipmentOriginCountry,
      inputType: "select",
      options: getCountryOptions(domain.countries, currentLang?.toLowerCase() || "en"),
      bindPath: "shipmentOptions.shipmentOriginCountry"
    },
    "shipmentOptions_totalShipmentValue": {
      label: m.serviceSettingComponents.shipmentValue,
      inputType: "number",
      bindPath: "shipmentOptions.totalShipmentValue"
    },
    "shipmentOptions_registrationNumberShipper": {
      label: m.serviceSettingComponents.registrationNumberEORI,
      inputType: "text",
      bindPath: "shipmentOptions.registrationNumberShipper"
    },
    "shipmentOptions_registrationNumberRecipient": {
      label: m.serviceSettingComponents.registrationNumberEIN,
      inputType: "text",
      bindPath: "shipmentOptions.registrationNumberRecipient"
    },
    "shipmentOptions_signatureRequired": {
      label: m.serviceSettingComponents.insuranceRequirement,
      inputType: "select",
      options: translateOptions(domain.signatureOptions, m.options?.signature),
      bindPath: "shipmentOptions.signatureRequired",
    },
    "shipmentOptions_invoiceRef": {
      label: m.serviceSettingComponents.invoiceRef,
      inputType: "text",
      bindPath: "shipmentOptions.invoiceRef"
    },
    "shipmentOptions_carrierAccountNumber": {
      label: m.serviceSettingComponents.carrierAccountNumber,
      inputType: "carrierAccountNumber",
      bindPath: "shipmentOptions.carrierAccountNumber"
    },
    "shipmentOptions_chosenRate_accessPoints": {
      label: m.serviceSettingComponents.chooseAccessPoint,
      inputType: "accessPoints",
      bindPath: "shipmentOptions.chosenRate.accessPoints"
    }
  };
}
