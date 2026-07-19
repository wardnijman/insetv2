import {
  validateEmail,
  validatePhoneNumber,
  validateFirstName,
  validateLastName,
  validateCompany,
  validateInsuranceValue,
  validateRegistrationNumberRecipient,
  validateRegistrationNumberShipper,
  validateExportReason
} from "./validations"; // adjust path as needed

import type { ValidationResult, Validator } from "../types/config";
import { t } from "./translations/i18n"; // adjust path as needed

export const persistentFieldValidators: Record<string, Validator> = {
  "shipperAddress_email": {
    dependsOn: (template) => ({ shipperAddress_email: template.shipperAddress.email }),
    validate: ({ shipperAddress_email }) => validateEmail(shipperAddress_email)
  },
  "shipperAddress_phoneNumber": {
    dependsOn: (t) => ({ shipperAddress_phoneNumber: t.shipperAddress.phoneNumber }),
    validate: ({ shipperAddress_phoneNumber }) => validatePhoneNumber(shipperAddress_phoneNumber)
  },
  "shipperAddress_firstName": {
    dependsOn: (template) => ({ shipperAddress_firstName: template.shipperAddress.firstName }),
    validate: ({ shipperAddress_firstName }) => validateFirstName(shipperAddress_firstName)
  },
  "shipperAddress_lastName": {
    dependsOn: (template) => ({ shipperAddress_lastName: template.shipperAddress.lastName }),
    validate: ({ shipperAddress_lastName }) => validateLastName(shipperAddress_lastName)
  },
  "recipientAddress_email": {
    dependsOn: (template) => ({ recipientAddress_email: template.recipientAddress.email }),
    validate: ({ recipientAddress_email }) => validateEmail(recipientAddress_email)
  },
  "recipientAddress_phoneNumber": {
    dependsOn: (template) => ({ recipientAddress_phone: template.recipientAddress.phoneNumber }),
    validate: ({ recipientAddress_phone }) => validatePhoneNumber(recipientAddress_phone)
  },
  "recipientAddress_firstName": {
    dependsOn: (template) => ({ recipientAddress_firstName: template.recipientAddress.firstName }),
    validate: ({ recipientAddress_firstName }) => validateFirstName(recipientAddress_firstName)
  },
  "recipientAddress_lastName": {
    dependsOn: (template) => ({ recipientAddress_lastName: template.recipientAddress.lastName }),
    validate: ({ recipientAddress_lastName }) => validateLastName(recipientAddress_lastName)
  },
  "recipientAddress_company": {
    dependsOn: (template) => ({ recipientAddress_company: template.recipientAddress.company }),
    validate: ({ recipientAddress_company }) => validateCompany(recipientAddress_company)
  },
  "shipmentOptions_insuranceValue": {
    dependsOn: (template) => ({ insuranceValue: template.shipmentOptions.insuranceValue }),
    validate: ({ insuranceValue }) => validateInsuranceValue(insuranceValue)
  },
    "shipmentOptions_invoiceRef": {
    dependsOn: (template) => ({ invoiceRef: template.invoiceRef }),
    validate: ({ invoiceRef }) => ({valid: true})
  },
  "shipmentOptions_chosenRate": {
    dependsOn: (t) => ({ chosenRate: t.shipmentOptions.chosenRate }),
    validate: ({ chosenRate }) => {
      return chosenRate && chosenRate.carrier && chosenRate.carrier != ""
        ? { valid: true, message: "" }
        : { valid: false, message: t("shared.shipmentOptionRequired") }

    }

  },
  "shipmentOptions_deliveryInstructions": {
    dependsOn: (t) => ({ deliveryInstructions: t.shipmentOptions.deliveryInstructions }),
    validate: ({ deliveryInstructions }) => (
      deliveryInstructions.length > 15
        ? { valid: false, message: t("shared.deliveryInstructionsTooLong") }
        : { valid: true }
    )
  },
  "invoice": {
    dependsOn: (template: any) => ({
      invoice: template.invoice
    }),
    validate: ({ invoice }): ValidationResult => {
      return { valid: true };
    }
  },
  "customsDocuments": {
    dependsOn: (template: any) => ({
      customsDocuments: template.customsDocuments
    }),
    validate: ({ customsDocuments }): ValidationResult => {
      return { valid: true };
    }
  },
  "factuuraanwezig": {
    dependsOn: (template: any) => ({
      factuurAanwezig: template.shipmentOptions?.factuurAanwezig
    }),
    validate: ({ factuurAanwezig }): ValidationResult => {
      return { valid: true };
    }
  },
  "shipmentOptions_exportReason": {
    dependsOn: (template: any) => ({ shipmentOptions_exportReason: template.shipmentOptions.exportReason }),
    validate: ({ shipmentOptions_exportReason }) => validateExportReason(shipmentOptions_exportReason)
  },
  "shipmentOptions_registrationNumberRecipient": {
    dependsOn: (template: any) => ({
      registrationNumberRecipient: template.shipmentOptions.registrationNumberRecipient,
      recipientCompany: template.recipientAddress?.company,
      recipientIsPrivateIndividual: template.recipientAddress?.isPrivateIndividual,
    }),
    validate: ({ registrationNumberRecipient, recipientCompany, recipientIsPrivateIndividual }) =>
      validateRegistrationNumberRecipient(registrationNumberRecipient, recipientCompany, recipientIsPrivateIndividual)
  },
  "shipmentOptions_registrationNumberShipper": {
    dependsOn: (template: any) => ({ registrationNumberShipper: template.shipmentOptions.registrationNumberShipper }),
    validate: ({ registrationNumberShipper }) => validateRegistrationNumberShipper(registrationNumberShipper)
  },
  "shipmentOptions_description": {
    dependsOn: (t) => ({ description: t.shipmentOptions.description }),
    validate: ({ description }) => {
      if (!description || description == "" || description.length < 1) return { valid: false, message: t("shared.descriptionRequired") };
      if (description.length > 35) return { valid: false, message: t("shared.descriptionTooLong") };
      return { valid: true };
    }
  },
  "shipmentOptions_totalShipmentValue": {
    dependsOn: (t) => ({ totalShipmentValue: t.shipmentOptions.totalShipmentValue }),
    validate: ({ totalShipmentValue }) => (
      !totalShipmentValue || totalShipmentValue == 0
        ? { valid: false, message: t("shared.shipmentValueRequired") }
        : { valid: true }
    )
  },
  "shipmentOptions_shipmentOriginCountry": {
    dependsOn: (template: any) => ({
      shipmentOriginCountry: template.shipmentOptions.shipmentOriginCountry,
    }),
    validate: ({ shipmentOriginCountry }): ValidationResult => {
      return { valid: true }
    }
  },
    "shipmentOptions_signatureRequired": {
    dependsOn: (template: any) => ({
      signatureRequired: template.shipmentOptions.signatureRequired,
    }),
    validate: ({ signatureRequired }): ValidationResult => {
      return { valid: true }
    }
  },
  "recipientAddress_region": {
    dependsOn: (t) => ({ recipientAddress_region: t.recipientAddress.region }),
    validate: ({ recipientAddress_region }) =>
      recipientAddress_region
        ? { valid: true }
        : { valid: false, message: t("shared.regionRequired") }
  },  
  "shipmentOptions_carrierAccountNumber": {
    dependsOn: (template: any) => ({
      carrierAccountNumber: template.shipmentOptions.carrierAccountNumber,
    }),
    validate: ({ carrierAccountNumber }): ValidationResult => {
      return { valid: true }
    }
  },
    "shipmentOptions_carrierAccountNumber_carrierAccountNumberCountry": {
    dependsOn: (template: any) => ({
      carrierAccountNumberCountry: template.shipmentOptions.carrierAccountNumberCountry,
    }),
    validate: ({ carrierAccountNumberCountry }): ValidationResult => {
      return { valid: true }
    }
  },
    "shipmentOptions_carrierAccountNumber_carrierAccountNumberPostalCode": {
    dependsOn: (template: any) => ({
      carrierAccountNumberPostalCode: template.shipmentOptions.carrierAccountNumberPostalCode,
    }),
    validate: ({ carrierAccountNumberPostalCode }): ValidationResult => {
      return { valid: true }
    }
  },
    "shipmentOptions_chosenRate_accessPoints": {
    dependsOn: (template: any) => ({
      accessPoints: template.shipmentOptions.chosenRate.accessPoints,
    }),
    validate: ({ accessPoints }): ValidationResult => {
      return { valid: true }
    }
  }
};
