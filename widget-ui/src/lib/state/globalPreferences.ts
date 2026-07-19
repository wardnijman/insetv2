// Geport uit v1 src/lib/state/globalPreferences.ts. Wijzigingen: geen.
// Module-level singleton, gezet bij boot (zelfde patroon als userPreferences).
// Consument: rateFetcher.applyRateExclusions (serviceAvailability.exclusions).

export let globalPreferences: any;

export function setGlobalPreferences(prefs: any) {
    globalPreferences = prefs
}
