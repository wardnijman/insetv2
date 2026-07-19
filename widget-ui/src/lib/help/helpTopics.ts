// Geport uit v1 src/lib/help/helpTopics.ts. Wijzigingen: geen.

// Verbatim copy of plugship-client-app/src/lib/docs/helpTopics.ts (the canonical
// file) — same duplication convention as config.d.ts. Each topic is a section
// anchor on the manual page at {apiBaseUrl}/docs/widget#<topic>. When adding a
// topic, add the docs section in the app first, then mirror the slug here.

export const HELP_TOPICS = [
  "introduction",
  "quickstart",
  "order-overview",
  "wizard-sender",
  "wizard-receiver",
  "wizard-packages",
  "package-templates",
  "wizard-customs",
  "customs-invoice",
  "rate-choice",
  "label-basket",
  "settings-general",
  "settings-sync",
  "settings-shipping-profile",
  "settings-tff-account",
  "automation",
  "autopilot",
  "troubleshooting",
] as const;

export type HelpTopic = (typeof HELP_TOPICS)[number];

/** Wizard step id → manual section. The ship step and the standalone
 *  "Kies een verzendservice" dialog are the same UI (ShipStepBlock), so both
 *  point at "rate-choice". */
export const WIZARD_STEP_TOPICS: Record<string, HelpTopic> = {
  sender: "wizard-sender",
  receiver: "wizard-receiver",
  packages: "wizard-packages",
  products: "wizard-customs",
  ship: "rate-choice",
};
