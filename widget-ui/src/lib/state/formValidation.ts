import { writable, derived } from "svelte/store";

export const fieldValidity = writable<Record<string, boolean>>({});

// Visual gating only: fields are validity-TRACKED from mount (submit gating via
// fieldValidity is unchanged), but error styling shows per field after blur —
// or everywhere at once when the user tries to continue on an invalid step.
// Reset on step change so the next step opens clean.
export const showAllErrors = writable(false);

// Per-veld foutonthulling (geport uit v1): naast blur/showAllErrors kan een veld
// gericht "onthuld" worden (bv. een net geautofocust veld dat al ongeldig is, of het
// eerste foute veld waar de wizard naartoe scrollt). Reset bij stapwissel.
export const revealedFields = writable<Set<string>>(new Set());

export function revealField(name: string) {
  revealedFields.update((s) => (s.has(name) ? s : new Set(s).add(name)));
}

export function resetRevealedFields() {
  revealedFields.set(new Set());
}

export function resetFieldValidity() {
  fieldValidity.set({});
}

export function clearFieldValidityKey(key: string) {
  fieldValidity.update((state) => {
    if (!(key in state)) return state;
    const next = { ...state };
    delete next[key];
    return next;
  });
}

export function clearFieldValidityPrefix(prefix: string) {
  fieldValidity.update((state) => {
    const next = { ...state };
    for (const key of Object.keys(next)) {
      if (key.startsWith(prefix)) delete next[key];
    }
    return next;
  });
}

export const formIsValid = derived(fieldValidity, ($fieldValidity) =>
  Object.values($fieldValidity).every((v) => v === true),
);