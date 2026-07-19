// Geport uit v1 src/lib/help/helpDrawer.ts. Wijzigingen: manual-basis
// (/docs/widget) geëxtraheerd naar module-constante WIDGET_MANUAL_PATH met
// TODO(tenant-config); verder geen.

// Shared state + content loader for the in-widget help drawer.
//
// The drawer renders the SAME manual content as {apiBaseUrl}/docs/widget: it
// lazily fetches /docs/widget/content.json (served from content.ts in the app),
// so help text updates ship with an app deploy — no widget rebuild — and the
// drawer can never disagree with the manual page.
import { writable } from "svelte/store";
import { apiBaseUrl } from "../api/global";
import type { HelpTopic } from "./helpTopics";

// TODO(tenant-config): het manual-pad op de client-app; per tenant
// configureerbaar maken zodra v2 een eigen manual host. Basis-URL blijft
// apiBaseUrl (tenant-config), alleen dit pad is vast.
export const WIDGET_MANUAL_PATH = "/docs/widget";

export type HelpBlock =
  | { kind: "p"; html: string }
  | { kind: "h2"; text: string }
  | { kind: "steps"; items: string[] }
  | { kind: "image"; src: string; alt: string; caption?: string }
  | { kind: "callout"; tone: "info" | "warn"; html: string }
  | { kind: "table"; headers: string[]; rows: string[][] };

export type HelpSection = {
  topic: string;
  title: string;
  group: string;
  lead: string;
  blocks: HelpBlock[];
};

export const helpDrawer = writable<{ open: boolean; topic: HelpTopic }>({
  open: false,
  topic: "introduction",
});

export function openHelp(topic: HelpTopic) {
  helpDrawer.set({ open: true, topic });
}

export function closeHelp() {
  helpDrawer.update((s) => ({ ...s, open: false }));
}

let sectionsCache: HelpSection[] | null = null;
let inflight: Promise<HelpSection[]> | null = null;

export function loadHelpSections(): Promise<HelpSection[]> {
  if (sectionsCache) return Promise.resolve(sectionsCache);
  if (inflight) return inflight;
  inflight = fetch(`${apiBaseUrl}${WIDGET_MANUAL_PATH}/content.json`)
    .then(async (res) => {
      if (!res.ok) throw new Error(`help content: ${res.status}`);
      const data = await res.json();
      sectionsCache = (data?.sections ?? []) as HelpSection[];
      return sectionsCache;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
