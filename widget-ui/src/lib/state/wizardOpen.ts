// Geport uit v1 src/lib/state/wizardOpen.ts. Wijzigingen: geen.

import { writable } from "svelte/store";

/** True zolang de ship-wizard inline open staat. Widget.svelte verbergt dan zijn
 *  eigen topbar ("Verbergen"-regel) zodat de wizardheader de enige chrome-regel
 *  boven het formulier is — geen stapeling van losse balkjes. */
export const shipWizardOpen = writable(false);
