// i18n / message-store (widget-extractie stap 3). v1 had NL-teksten verspreid in de
// componenten (badges, "Overslaan", DDP-"€43,-", session-banner) + window.__WIDGET_MESSAGES__.
// Hier: een gedeelde base-catalogus per taal + per-tenant overrides, achter één m()-resolver.
// Zo verhuizen de hardcoded teksten uit de componenten en kan een tenant vertalen/branden.

import { readFileSync, existsSync } from "node:fs";

export type Messages = Record<string, string>;

// Gedeelde base-catalogus (default NL). Componenten gebruiken m(key), nooit een letterlijke string.
const BASE: Record<string, Messages> = {
  nl: {
    "step.sender": "Verzender",
    "step.receiver": "Ontvanger",
    "step.packages": "Verpakkingen",
    "step.customs": "Douane",
    "step.ship": "Verzenden",
    "badge.needsProductDetails": "Vereist productdetails",
    "badge.needsInvoice": "Vereist handelsfactuur",
    "action.skip": "Overslaan",
    "notice.loggedOut": "Je bent uitgelogd",
  },
  en: {
    "step.sender": "Sender",
    "step.receiver": "Recipient",
    "step.packages": "Packages",
    "step.customs": "Customs",
    "step.ship": "Ship",
    "badge.needsProductDetails": "Product details required",
    "badge.needsInvoice": "Commercial invoice required",
    "action.skip": "Skip",
    "notice.loggedOut": "You have been logged out",
  },
};

/** Bouwt de m()-resolver voor een tenant+taal: tenant-override > base > de sleutel zelf. */
export function resolveMessages(tenantId: string, lang = "nl"): (key: string) => string {
  const base = BASE[lang] ?? BASE.nl;
  let overrides: Messages = {};
  const path = `tenants/${tenantId}.messages.json`;
  if (existsSync(path)) {
    const all = JSON.parse(readFileSync(path, "utf8")) as Record<string, Messages>;
    overrides = all[lang] ?? {};
  }
  return (key: string) => overrides[key] ?? base[key] ?? key;
}
