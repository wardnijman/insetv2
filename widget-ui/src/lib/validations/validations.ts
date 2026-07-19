import type { ValidationResult } from "../types/config";
import { t } from "./translations/i18n"; // Adjust import path if needed

export function validateEmail(email: string): ValidationResult {
  if (!email || email == "") return { valid: true };

  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!regex.test(email)) return { valid: false, message: t("shared.emailInvalid") };

  return { valid: true, message: "" };
}

export function validatePhoneNumber(input: string): ValidationResult {
  if (!input || !input.trim()) {
    return { valid: false, message: t("shared.phoneRequired") };
  }

  const digitsOnly = input.replace(/\D/g, "");

  if (digitsOnly.length < 6) {
    return { valid: false, message: t("shared.phoneTooShort") };
  }

  if (digitsOnly.length > 20) {
    return { valid: false, message: t("shared.phoneTooLong") };
  }

  return { valid: true, message: "" };
}

export function validateCompany(name: string): ValidationResult {
  if (name && name.length > 35) {
    return { valid: false, message: t("shared.maxLength35") };
  }
  return { valid: true, message: "" };
}

export function validateFirstName(name: string): ValidationResult {
  if (!name) return { valid: false, message: t("shared.firstNameRequired") };
  if (name.length > 35) return { valid: false, message: t("shared.maxLength35") };
  return { valid: true, message: "" };
}

export function validateLastName(name: string): ValidationResult {
  if (!name) return { valid: false, message: t("shared.lastNameRequired") };
  if (name.length > 35) return { valid: false, message: t("shared.maxLength35") };
  return { valid: true, message: "" };
}

export function validateInsuranceValue(value: number): ValidationResult {
  if (value < 0) {
      console.log("Returning false")

    return { valid: false, message: t("shared.insuranceValueTooLow") };
  }
  return { valid: true, message: "" };
}

export function validateExportReason(reason: string): ValidationResult {
  if (reason && reason.length > 50) {
    return { valid: false, message: t("shared.exportReasonTooLong") };
  }
  return { valid: true, message: "" };
}

// EORI / tax-ID numbers are up to 17 chars (e.g. a NL EORI like "NL821071841B02" is 14).
// The old cap of 9 wrongly rejected every real EORI.
const REGISTRATION_NUMBER_MAX = 17;

export function validateRegistrationNumberRecipient(number: string, recipientCompany?: string, isPrivateIndividual?: boolean): ValidationResult {
  // Private recipients have no EORI / Free Trade Zone ID, and TFF hides the recipient
  // registration field for them — so an empty number is valid in that case. The explicit
  // receiver-step radio (recipientAddress.isPrivateIndividual) wins; without it we fall
  // back to deducing from the company field, matching recipientToIsPrivateIndividual.
  const recipientIsPrivate =
    typeof isPrivateIndividual === "boolean"
      ? isPrivateIndividual
      : !recipientCompany || String(recipientCompany).trim() === "";
  if (recipientIsPrivate) {
    return { valid: true, message: "" };
  }

  if (!number || number === "") {
    return { valid: false, message: t("shared.registrationRequired") };
  }

  if (number.length > REGISTRATION_NUMBER_MAX) {
    return { valid: false, message: t("shared.registrationTooLong") };
  }

  return { valid: true, message: "" };
}

export function validateRegistrationNumberShipper(number: string): ValidationResult {
  if (!number || number === "") {
    return { valid: false, message: t("shared.registrationRequired") };
  }

  if (number.length > REGISTRATION_NUMBER_MAX) {
    return { valid: false, message: t("shared.registrationTooLong") };
  }

  return { valid: true, message: "" };
}
