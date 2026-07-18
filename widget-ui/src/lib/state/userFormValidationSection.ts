import { derived } from "svelte/store";
import { fieldValidity } from "../state/formValidation";

export function useFormValidationSection(prefix: string) {
  return derived(fieldValidity, ($v) => {
    const filtered = Object.entries($v).filter(([k]) =>
      k.startsWith(prefix + "_")
    );

    const result = filtered.every(([_, isValid]) => isValid);
    return result;
  });
}

export function useFieldValidity(fieldName: string) {
  return derived(fieldValidity, ($v) => $v[fieldName] === true);
}