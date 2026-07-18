// Test van de tenant-generieke injectie (stap 2). Bewijs met een MOCK host-DOM dat
// dezelfde loader een forwarder embedt in het host-portaal (.stap1) én een verlader
// standalone in een eigen container mount — puur op tenant-config.

import { mountWidget } from "./loader.ts";
import type { HostElement, HostEnv } from "./host-adapter.ts";

class El implements HostElement {
  id = "";
  children: El[] = [];
  setAttribute(name: string, value: string): void { if (name === "id") this.id = value; }
  append(child: HostElement): void { this.children.push(child as El); }
}
class MockEnv implements HostEnv {
  body = new El();
  preset = new Map<string, El>();
  constructor(selectors: string[] = []) { for (const s of selectors) this.preset.set(s, new El()); }
  querySelector(sel: string): HostElement | null { return this.preset.get(sel) ?? null; }
  createElement(_tag: string): HostElement { return new El(); }
}

let fail = 0;
function check(n: string, ok: boolean): void { console.log(`  ${ok ? "✓" : "✗"} ${n}`); if (!ok) fail++; }

// 1. Forwarder, EMBEDDED — mount in het bestaande host-element (.stap1), niets nieuws
const envTff = new MockEnv([".stap1"]);
const tff = mountWidget("tff-forwarder", envTff);
check("forwarder: embedded mount in host-.stap1 (geen eigen container aangemaakt)",
  tff.mode === "embedded" && envTff.body.children.length === 0 && tff.element === envTff.preset.get(".stap1"));
check("forwarder: provider + endpoint uit tenant-config", tff.providers[0] === "tff" && tff.endpoints.api === "https://tffxpress.com");

// 2. Verlader, STANDALONE — eigen container aangemaakt en aan de body gehangen
const envAcme = new MockEnv([]);
const acme = mountWidget("acme-standalone", envAcme);
check("verlader: standalone maakt eigen container in de body",
  acme.mode === "standalone" && envAcme.body.children.length === 1 && acme.element.id === "inset-widget");
check("verlader: andere provider + endpoint, zelfde loader", acme.providers[0] === "transheroes" && acme.endpoints.api.includes("transheroes"));

// 3. Fail-closed — embedded zonder mount-doel in de host
let threw = false;
try { mountWidget("tff-forwarder", new MockEnv([])); } catch { threw = true; }
check("embedded zonder mount-doel -> faalt gesloten", threw);

console.log(fail ? `\nFAIL — ${fail} check(s) fout` : "\nOK — injectie tenant-generiek: forwarder-embedded (.stap1) én verlader-standalone (eigen container) via dezelfde loader");
process.exit(fail ? 1 : 0);
